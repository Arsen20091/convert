document.addEventListener('DOMContentLoaded', function() {
  const amountInput = document.getElementById('amount');
  const resultInput = document.getElementById('result');
  const fromCurrency = document.getElementById('from-currency');
  const toCurrency = document.getElementById('to-currency');
  const swapIcon = document.querySelector('.swap-icon');
  const rateInfo = document.getElementById('rate-info');
  function loadCurrencies() {
    window.api.getCurrencies().then(function(currencies) {
      currencies.forEach(function(currency) {
        fromCurrency.innerHTML += '<option value="' + currency + '">' + currency + '</option>';
        toCurrency.innerHTML += '<option value="' + currency + '">' + currency + '</option>';
      });
      fromCurrency.value = 'USD';
      toCurrency.value = 'RUB';
      
      convertCurrency();
    });
  }

function convertCurrency() {
  const amount = parseFloat(amountInput.value);
  const from = fromCurrency.value;
  const to = toCurrency.value;

  if (isNaN(amount) || amount < 0) {
    resultInput.value = '';
    rateInfo.textContent = 'Введите сумму больше нуля';
    return;
  }

  window.api.getExchangeRate(from, to).then(function(rate) {
    if (rate) {
      const result = (amount * rate).toFixed(2);
      console.log(`Конвертация: ${amount} ${from} → ${to}, rate=${rate}, result=${result} ${to}`);
      resultInput.value = `${result} ${to}`;
      rateInfo.textContent = `1 ${from} = ${rate.toFixed(4)} ${to}`;
    } else {
      resultInput.value = '';
      rateInfo.textContent = 'Курс не доступен';
    }
  });
}

  function swapCurrencies() {
    const temp = fromCurrency.value;
    fromCurrency.value = toCurrency.value;
    toCurrency.value = temp;
    convertCurrency();
  }

  amountInput.addEventListener('input', convertCurrency);
  fromCurrency.addEventListener('change', convertCurrency);
  toCurrency.addEventListener('change', convertCurrency);
  swapIcon.addEventListener('click', swapCurrencies);

  loadCurrencies();
});
