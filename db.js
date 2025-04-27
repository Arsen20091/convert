const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'data.json');

function getCurrencies() {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const list = Object.keys(data.exchange_rates);
  const set = new Set();

  list.forEach((item) => {
    const parts = item.split('_');
    set.add(parts[0]);
    set.add(parts[1]);
  });

  return Array.from(set);
}

function getRate(from, to) {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const direct = data.exchange_rates[`${from}_${to}`];

  if (direct) return direct;

  const back = data.exchange_rates[`${to}_${from}`];
  if (back) return 1 / back;

  return null;
}

module.exports = { getCurrencies, getRate };
