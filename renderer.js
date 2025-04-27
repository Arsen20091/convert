document.addEventListener('DOMContentLoaded', async () => {
  const amountInput = document.getElementById('amount');
  const fromCurrency = document.getElementById('from-currency');
  const toCurrency = document.getElementById('to-currency');
  const convertBtn = document.getElementById('convert-btn');
  const result = document.getElementById('result');

  const currencies = await window.api.getCurrencies();

  currencies.forEach((curr) => {
    fromCurrency.innerHTML += `<option value="${curr}">${curr}</option>`;
    toCurrency.innerHTML += `<option value="${curr}">${curr}</option>`;
  });

  convertBtn.addEventListener('click', async () => {
    const amount = parseFloat(amountInput.value);
    const from = fromCurrency.value;
    const to = toCurrency.value;

    if (!amount || amount <= 0) {
      result.textContent = 'Введите корректную сумму.';
      result.style.opacity = '1';
      return;
    }

    const rate = await window.api.getExchangeRate(from, to);

    if (rate) {
      result.textContent = `${amount} ${from} = ${(amount * rate).toFixed(2)} ${to}`;
    } else {
      result.textContent = 'Курс обмена недоступен.';
    }

    result.style.opacity = '1';
  });
});
