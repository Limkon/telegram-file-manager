const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

console.log('--- [database.js] 腳本開始執行 ---');

// 預設在專案根目錄下使用 'data' 資料夾
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'file-manager.db');

console.log(`[日誌] 資料庫路徑已設定為: ${DB_FILE}`);

// 步驟 1: 檢查並創建資料夾
try {
    console.log(`[日誌] 即將檢查路徑是否存在: ${DATA_DIR}`);
    if (!fs.existsSync(DATA_DIR)) {
        // 如果資料夾不存在
        console.log(`[日誌] 檢查結果：'data' 資料夾不存在。`);
        console.log(`[動作] 即將執行 fs.mkdirSync('${DATA_DIR}')...`);
        fs.mkdirSync(DATA_DIR); // 嘗試創建資料夾
        console.log(`✅ [成功] 'data' 資料夾已成功創建！`);
    } else {
        // 如果資料夾已存在
        console.log(`[日誌] 檢查結果：'data' 資料夾已存在，無需創建。`);
    }
} catch (error) {
    // 如果在 try 區塊中發生任何錯誤 (最可能是 mkdirSync 失敗)
    console.error(`❌ [致命錯誤] 在創建資料夾的過程中發生錯誤！`);
    console.error(`   路徑: ${DATA_DIR}`);
    console.error(`   錯誤詳情: ${error.message}`);
    console.error('   這個錯誤明確表示應用程式沒有權限在指定位置創建資料夾。');
    process.exit(1); // 退出程式，因為後續步驟必定會失敗
}

// 步驟 2: 連接到資料庫
console.log(`[日誌] 即將連接到 SQLite 資料庫...`);
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('❌ [致命錯誤] 无法连接到数据库:', err.message);
    } else {
        console.log('✅ 成功连接到 SQLite 数据库。');
        // 步驟 3: 創建資料表
        db.run(`CREATE TABLE IF NOT EXISTS files (
            message_id INTEGER PRIMARY KEY,
            fileName TEXT NOT NULL,
            mimetype TEXT,
            file_id TEXT NOT NULL UNIQUE,
            thumb_file_id TEXT,
            date INTEGER NOT NULL,
            share_token TEXT,
            share_expires_at INTEGER
        )`, (err) => {
            if (err) {
                console.error("❌ 创建 'files' 表失败:", err.message);
            } else {
                console.log("✅ 'files' 資料表已準備就緒。");
                console.log('--- [database.js] 腳本執行完畢 ---');
            }
        });
    }
});

module.exports = db;
