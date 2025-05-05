const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getExchangeRate: (from, to) => ipcRenderer.invoke('get-exchange-rate', from, to),
    getCurrencies: () => ipcRenderer.invoke('get-currencies'),
});