const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'file-manager.db');

// 確保 data 資料夾存在
try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
    }
} catch (error) {
    console.error(`[致命錯誤] 無法創建資料夾: ${DATA_DIR}。錯誤: ${error.message}`);
    process.exit(1); 
}

// 連接到資料庫
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('无法连接到数据库:', err.message);
    } else {
        // 成功連接後，靜默創建資料表
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
                console.error("创建 'files' 表失败:", err.message);
            }
        });
    }
});

module.exports = db;
