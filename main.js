const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const os = require('os');

const configPath = path.join(app.getPath('userData'), 'config.json');
let config = {
  apiBaseUrl: 'http://localhost:3000', // Базовый URL API
  windowState: { width: 800, height: 600 } // Сохраняем размеры окна
};
try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } else {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
} catch (err) {
  console.error('Ошибка работы с конфигурационным файлом:', err);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: config.windowState.width,
    height: config.windowState.height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // прелоад скрипт
      nodeIntegration: false, 
      contextIsolation: true 
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds();
    config.windowState = { width: bounds.width, height: bounds.height };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// обработчики событий приложения
app.on('ready', createWindow);

app.on('window-all-closed', () => {
  // на macOS приложение остается активным пока не закрыто
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // на macOS воссоздаем окно если иконка в доке нажата
  if (mainWindow === null) {
    createWindow();
  }
});

// вспомогательная функция для API запросов
async function makeApiRequest(endpoint, params = {}) {
  try {
    const response = await axios.get(`${config.apiBaseUrl}${endpoint}`, { 
      params,
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    console.error(`Ошибка запроса к ${endpoint}:`, error);

    if (mainWindow) {
      dialog.showErrorBox(
        'Ошибка соединения', 
        `Не удалось подключиться к серверу по адресу ${config.apiBaseUrl}`
      );
    }
    
    throw error;
  }
}


// получение курса валюты
ipcMain.handle('get-exchange-rate', async (_, from, to) => {
  try {
    // обработка одинаковых валют
    if (from === to) return 1;

    const response = await axios.get(`http://localhost:3000/api/convert`, {
      params: { from, to, amount: 1 },
      timeout: 5000
    });
    
    return response.data.rate;
  } catch (error) {
    console.error('Error getting rate:', error.response?.data || error.message);
    
    //фиксированные курсы
    const fallbackRates = {
      'USD_EUR': 0.93,
      'USD_RUB': 92.5,
      'EUR_USD': 1.08,
      'EUR_RUB': 99.5,
      'RUB_USD': 0.011,
      'RUB_EUR': 0.010
    };
    
    return fallbackRates[`${from}_${to}`] || null;
  }
});

// получение списка
ipcMain.handle('get-currencies', async () => {
  try {
    const data = await makeApiRequest('/api/currencies');
    return data.map(c => c.code);
  } catch {
    return [];
  }
});

ipcMain.handle('get-api-url', () => config.apiBaseUrl);

// установка новый URL API
ipcMain.handle('set-api-url', async (_, newUrl) => {
  try {
    // проверка новый URL
    await axios.get(`${newUrl}/api/currencies`, { timeout: 5000 });
    config.apiBaseUrl = newUrl;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('Не удалось установить новый URL API:', error);
    return false;
  }
});

// получение информации о системе
ipcMain.handle('get-system-info', () => {
  return {
    platform: os.platform(), // ОС
    arch: os.arch(), // архитектура
    version: os.version(), // версия ОС
    memory: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB' // память
  };
});