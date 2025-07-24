const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs'); // Import the file system module

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'file-manager.db');

// *** FIX: Ensure the data directory exists before connecting ***
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR);
        console.log(`✅ 'data' directory created at: ${DATA_DIR}`);
    } catch (err) {
        console.error("无法创建 'data' 目录:", err);
        // If we can't create the directory, exit the process to avoid further errors.
        process.exit(1); 
    }
}

// Connect to the SQLite database
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
