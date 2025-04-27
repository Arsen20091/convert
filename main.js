const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./db');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');
});

ipcMain.handle('get-exchange-rate', (_, from, to) => {
    return db.getRate(from, to);
  });
  
  ipcMain.handle('get-currencies', () => {
    return db.getCurrencies();
  });