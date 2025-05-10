document.addEventListener('DOMContentLoaded', function() {
  //Получаем элементы
  const amountInput = document.getElementById('amount');
  const resultInput = document.getElementById('result');
  const fromCurrency = document.getElementById('from-currency');
  const toCurrency = document.getElementById('to-currency');
  const swapIcon = document.querySelector('.swap-icon');
  const rateInfo = document.getElementById('rate-info');

  //Загружаем валюты
  function loadCurrencies() {
    window.api.getCurrencies().then(function(currencies) {
      currencies.forEach(function(currency) {
        fromCurrency.innerHTML += '<option value="' + currency + '">' + currency + '</option>';
        toCurrency.innerHTML += '<option value="' + currency + '">' + currency + '</option>';
      });
      
      // USD -> RUB по умолчанию
      fromCurrency.value = 'USD';
      toCurrency.value = 'RUB';
      
      
      convertCurrency();
    });
  }

  //Конвертация валют
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
        resultInput.value = result;
        rateInfo.textContent = `1 ${from} = ${rate.toFixed(4)} ${to}`;
      } else {
        resultInput.value = '';
        rateInfo.textContent = 'Курс не доступен';
      }
    });
  }

  //Обмен валют местами
  function swapCurrencies() {
    const temp = fromCurrency.value;
    fromCurrency.value = toCurrency.value;
    toCurrency.value = temp;
    convertCurrency();
  }

  //Обработчики событий
  amountInput.addEventListener('input', convertCurrency);
  fromCurrency.addEventListener('change', convertCurrency);
  toCurrency.addEventListener('change', convertCurrency);
  swapIcon.addEventListener('click', swapCurrencies);

  //Загрузка валют
  loadCurrencies();
});