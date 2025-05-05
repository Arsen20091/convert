const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// postgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'currency_converter',
  //password: 'pass',
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
      
      // создание индекс
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS currency_timestamp_idx 
        ON exchange_rates (currency_code, timestamp_utc);
      `);
      
      console.log('База данных успешно инициализирована');
    } catch (err) {
      console.error('Ошибка при инициализации базы данных:', err);
      throw err;
    }
  }
  async function seedInitialData() {
    try {
      const check = await pool.query('SELECT COUNT(*) FROM exchange_rates');
      if (parseInt(check.rows[0].count) === 0) return;
      await pool.query(`
        INSERT INTO exchange_rates (currency_code, rate, timestamp_utc)
        VALUES 
          ('USD', 1.0, NOW()),
          ('EUR', 0.93, NOW()),
          ('RUB', 92.5, NOW()),
          ('GBP', 0.79, NOW()),
          ('JPY', 148.3, NOW())
        ON CONFLICT DO NOTHING;
      `);
      console.log('Начальные данные добавлены');
    } catch (err) {
      console.error('Ошибка при добавлении начальных данных:', err);
    }
  }
// обновление курса валюты
async function updateExchangeRates() {
  try {
    const response = await axios.get('https://api.exchangerate.host/latest?base=USD');
    
    if (response.data.success) {
      const rates = response.data.rates;
      const updateTime = new Date().toISOString();

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // USD как базовая валюту
        await client.query(
          `INSERT INTO exchange_rates (currency_code, rate, timestamp_utc)
           VALUES ($1, $2, $3)
           ON CONFLICT (currency_code, timestamp_utc) DO NOTHING`,
          ['USD', 1.0, updateTime]
        );

        // остальные валюты
        for (const [currency, rate] of Object.entries(rates)) {
          await client.query(
            `INSERT INTO exchange_rates (currency_code, rate, timestamp_utc)
             VALUES ($1, $2, $3)
             ON CONFLICT (currency_code, timestamp_utc) DO NOTHING`,
            [currency, rate, updateTime]
          );
        }

        await client.query('COMMIT');
        console.log(`Курсы обновлены: ${updateTime}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ошибка транзакции:', err);
        await addFallbackRates();
      } finally {
        client.release();
      }
    }
  } catch (error) {
    console.error('Ошибка API:', error.message);
    await addFallbackRates();
  }
}

// последние курсы валют
async function getLatestRates() {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (currency_code) currency_code, rate
      FROM exchange_rates
      ORDER BY currency_code, timestamp_utc DESC
    `);
    
    const rates = {};
    result.rows.forEach(row => {
      rates[row.currency_code] = row.rate;
    });
    
    return rates;
  } catch (err) {
    console.error('Ошибка при получении курсов:', err);
    return {};
  }
}

// каждый час обнова курса
initializeDatabase().then(async () => {
    await seedInitialData(); // Добавляем начальные данные
    await updateExchangeRates(); // Первое обновление
    setInterval(updateExchangeRates, 1 * 60 * 60 * 1000); // Периодическое обновление
  });
// полчение списка валют
app.get('/api/currencies', async (req, res) => {
    try {
      // Явно выбираем основные валюты, если таблица пуста
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
      console.error('Error in /api/currencies:', err);
      // Возвращаем базовый набор при ошибке
      res.json([
        { code: 'USD', name: 'Доллар США' },
        { code: 'EUR', name: 'Евро' },
        { code: 'RUB', name: 'Российский рубль' }
      ]);
    }
  });

// получение курса конкр валюты
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

// конверт
app.get('/api/convert', async (req, res) => {
  const { from, to, amount } = req.query;
  const amountNum = parseFloat(amount);

  // проверка одинаковых валют
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
    
    // если нет курсов - обновляем и проверяем снова
    if (!rates[from] || !rates[to]) {
      await updateExchangeRates();
      rates = await getLatestRates();
      
      if (!rates[from] || !rates[to]) {
        return res.status(400).json({ 
          error: `Курсы для ${from}/${to} недоступны` 
        });
      }
    }

    const result = (amountNum / rates[from]) * rates[to];
    const rate = rates[to] / rates[from];

    res.json({
      from,
      to,
      amount: amountNum,
      result: parseFloat(result.toFixed(4)),
      rate: parseFloat(rate.toFixed(6)),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Ошибка конвертации:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// хелп функция для получения названия валюты
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

// запуск сервака
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
console.log('Выполняем SQL:', `
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id SERIAL PRIMARY KEY,
      currency_code VARCHAR(3) NOT NULL,
      rate DECIMAL NOT NULL,
      timestamp_utc TIMESTAMP WITHOUT TIME ZONE NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (NOW() AT TIME ZONE 'utc')
    );
  `);