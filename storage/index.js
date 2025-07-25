// storage/index.js
const telegramStorage = require('./telegram');
const localStorage = require('./local');
const fs = require('fs');
const path = require('path');

// --- 新增：設定檔管理 ---
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const rawData = fs.readFileSync(CONFIG_FILE);
            return JSON.parse(rawData);
        }
    } catch (error) {
        console.error("讀取設定檔失敗:", error);
    }
    return { storageMode: 'telegram' }; // 預設值
}

function writeConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error("寫入設定檔失敗:", error);
        return false;
    }
}
// --- 結束 ---

let config = readConfig();
let storage;

function getStorage() {
    if (config.storageMode === 'local') {
        return localStorage;
    }
    return telegramStorage;
}

function setStorageMode(mode) {
    if (mode === 'local' || mode === 'telegram') {
        config.storageMode = mode;
        return writeConfig(config);
    }
    return false;
}

storage = getStorage();
console.log(`✅ 使用 ${storage.type} 儲存模式`);

module.exports = {
    getStorage,
    setStorageMode,
    readConfig
};
