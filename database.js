const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'file-manager.db');

// 连接到 SQLite 数据库，如果文件不存在则创建它
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('无法连接到数据库:', err.message);
    } else {
        console.log('✅ 成功连接到 SQLite 数据库。');
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
