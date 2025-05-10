const express = require('express');
const axios = require('axios').default;
const cors = require('cors');
const { Pool } = require('pg');
const { parseStringPromise } = require('xml2js');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'currency_converter_new',
//password: 'ВАШ ПАРОЛЬ ОТ ХУЙНИ',
  port: 5432,
});

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id SERIAL PRIMARY KEY,
        currency_code VARCHAR(3) NOT NULL,
        rate DECIMAL NOT NULL,
        timestamp_utc TIMESTAMP WITHOUT TIME ZONE NOT NULL,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (NOW() AT TIME ZONE 'utc')
      );
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS currency_timestamp_idx 
      ON exchange_rates (currency_code, timestamp_utc);
    `);
    console.log('База данных успешно инициализирована');
  } catch (err) {
    console.error('Ошибка при инициализации базы данных:', err.message);
    throw err;
  }
}

async function fetchCBRRates() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Попытка ${attempt} запроса к API ЦБ РФ`);
      const response = await axios.get('http://www.cbr.ru/scripts/XML_daily.asp', { timeout: 5000 });
      console.log('API ЦБ РФ ответил успешно, данные получены');
      return response;
    } catch (error) {
      console.error(`Попытка ${attempt} не удалась: ${error.message}`);
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function updateExchangeRates() {
  console.log('Начало обновления курсов:', new Date().toISOString());
  try {
    const response = await fetchCBRRates();
    console.log('Парсинг XML-данных...');
    const parsedData = await parseStringPromise(response.data);
    const valCurs = parsedData.ValCurs?.Valute;

    if (!valCurs || !Array.isArray(valCurs)) {
      throw new Error('Неверный формат данных API: ValCurs или Valute отсутствует');
    }

    const updateTime = new Date().toISOString();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      console.log('Запись USD (базовая валюта)...');
      await client.query(
        `INSERT INTO exchange_rates (currency_code, rate, timestamp_utc)
         VALUES ($1, $2, $3)
         ON CONFLICT (currency_code, timestamp_utc) DO NOTHING`,
        ['USD', 1.0, updateTime]
      );

      const usdValute = valCurs.find((v) => v.CharCode[0] === 'USD');
      if (!usdValute) {
        throw new Error('Курс USD не найден в данных API');
      }

      const rubToUsdRate = parseFloat(usdValute.Value[0].replace(',', '.')) / parseFloat(usdValute.Nominal[0]);
      console.log(`RUB to USD rate: ${rubToUsdRate}`);

      console.log('Запись RUB...');
      await client.query(
        `INSERT INTO exchange_rates (currency_code, rate, timestamp_utc)
         VALUES ($1, $2, $3)
         ON CONFLICT (currency_code, timestamp_utc) DO NOTHING`,
        ['RUB', 1 / rubToUsdRate, updateTime]
      );
      console.log(`RUB: rateInUsd=${1 / rubToUsdRate}`);

      for (const currency of valCurs) {
        const code = currency.CharCode[0];
        const nominal = parseFloat(currency.Nominal[0]);
        const rateInRub = parseFloat(currency.Value[0].replace(',', '.'));
        const rateInUsd = (rateInRub / nominal) / rubToUsdRate;
        console.log(`${code}: rateInRub=${rateInRub}, nominal=${nominal}, rateInUsd=${rateInUsd}`);

        await client.query(
          `INSERT INTO exchange_rates (currency_code, rate, timestamp_utc)
           VALUES ($1, $2, $3)
           ON CONFLICT (currency_code, timestamp_utc) DO NOTHING`,
          [code, rateInUsd, updateTime]
        );
      }

      await client.query('COMMIT');
      console.log(`Курсы успешно обновлены: ${updateTime}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Ошибка транзакции:', err.message);
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Ошибка при обновлении курсов:', error.message);
  }
}
async function getLatestRates() {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (currency_code) currency_code, rate, timestamp_utc
      FROM exchange_rates
      ORDER BY currency_code, timestamp_utc DESC
    `);
    
    const rates = {};
    console.log('Последние курсы из базы данных:');
    result.rows.forEach(row => {
      rates[row.currency_code] = row.rate;
      console.log(`${row.currency_code}: rate=${row.rate}, timestamp=${row.timestamp_utc}`);
    });
    
    return rates;
  } catch (err) {
    console.error('Ошибка при получении курсов:', err.message);
    return {};
  }
}
initializeDatabase().then(async () => {
  await updateExchangeRates();
  cron.schedule('0 * * * *', updateExchangeRates);
});
app.get('/api/currencies', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT currency_code FROM exchange_rates
      UNION SELECT 'USD' WHERE NOT EXISTS (SELECT 1 FROM exchange_rates)
      UNION SELECT 'EUR' WHERE NOT EXISTS (SELECT 1 FROM exchange_rates)
      UNION SELECT 'RUB' WHERE NOT EXISTS (SELECT 1 FROM exchange_rates)
      ORDER BY currency_code
    `);
    
    const currencies = result.rows.map(row => ({
      code: row.currency_code,
      name: getCurrencyName(row.currency_code)
    }));
    
    res.json(currencies);
  } catch (err) {
    console.error('Ошибка в /api/currencies:', err.message);
    res.json([
      { code: 'USD', name: 'Доллар США' },
      { code: 'EUR', name: 'Евро' },
      { code: 'RUB', name: 'Российский рубль' }
    ]);
  }
});
app.get('/api/rate/:currency', async (req, res) => {
  const currency = req.params.currency.toUpperCase();
  
  try {
    const result = await pool.query(`
      SELECT rate, timestamp_utc 
      FROM exchange_rates 
      WHERE currency_code = $1
      ORDER BY timestamp_utc DESC
      LIMIT 1
    `, [currency]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Валюта не найдена' });
    } else {
      res.json({
        currency,
        rate: result.rows[0].rate,
        lastUpdated: result.rows[0].timestamp_utc
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/convert', async (req, res) => {
  const { from, to, amount } = req.query;
  const amountNum = parseFloat(amount);

  if (from === to) {
    return res.json({
      from,
      to,
      amount: amountNum,
      result: amountNum,
      rate: 1,
      timestamp: new Date().toISOString()
    });
  }

  if (!from || !to || isNaN(amountNum)) {
    return res.status(400).json({ error: 'Неверные параметры запроса' });
  }

  try {
    let rates = await getLatestRates();
    
    if (!rates[from] || !rates[to]) {
      console.log(`Курсы для ${from}/${to} отсутствуют, обновление...`);
      await updateExchangeRates();
      rates = await getLatestRates();
      
      if (!rates[from] || !rates[to]) {
        return res.status(400).json({ 
          error: `Курсы для ${from}/${to} недоступны. Попробуйте позже.` 
        });
      }
    }

    // Исправленный расчет курса
    const rate = rates[from] / rates[to];
    const result = amountNum * rate;
    console.log(`Конвертация: ${amountNum} ${from} → ${to}, rates[${from}]=${rates[from]}, rates[${to}]=${rates[to]}, rate=${rate}, result=${result}`);

    res.json({
      from,
      to,
      amount: amountNum,
      result: parseFloat(result.toFixed(4)),
      rate: parseFloat(rate.toFixed(6)),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Ошибка конвертации:', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

function getCurrencyName(code) {
  const names = {
    USD: 'Доллар США',
    EUR: 'Евро',
    GBP: 'Фунт стерлингов',
    JPY: 'Японская иена',
    AUD: 'Австралийский доллар',
    CAD: 'Канадский доллар',
    CHF: 'Швейцарский франк',
    CNY: 'Китайский юань',
    RUB: 'Российский рубль',
    UAH: 'Украинская гривна',
    KZT: 'Казахстанский тенге',
    BYN: 'Белорусский рубль'
  };
  return names[code] || code;
}
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});