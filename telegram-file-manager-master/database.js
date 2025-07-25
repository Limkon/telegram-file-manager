const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'file-manager.db');

try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
    }
} catch (error) {
    console.error(`[致命錯誤] 無法創建資料夾: ${DATA_DIR}。錯誤: ${error.message}`);
    process.exit(1); 
}

const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('无法连接到数据库:', err.message);
    } else {
        db.serialize(() => {
            // 步驟 1: 建立 folders 資料表
            db.run(`CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                parent_id INTEGER,
                FOREIGN KEY (parent_id) REFERENCES folders (id) ON DELETE CASCADE
            )`, (err) => {
                if (err) {
                    console.error("创建 'folders' 表失败:", err.message);
                } else {
                    // 確保根目錄 (parent_id is NULL) 存在
                    db.get("SELECT * FROM folders WHERE parent_id IS NULL", (err, row) => {
                        if (!row) {
                            db.run("INSERT INTO folders (name, parent_id) VALUES (?, ?)", ['/', null]);
                        }
                    });
                }
            });

            // 步驟 2: 修改 files 資料表，加入 folder_id
            db.run("PRAGMA foreign_keys = ON;");
            db.all("PRAGMA table_info(files)", (err, columns) => {
                if (columns && !columns.find(c => c.name === 'folder_id')) {
                    console.log("正在為 'files' 表新增 'folder_id' 欄位...");
                    db.run(`ALTER TABLE files ADD COLUMN folder_id INTEGER NOT NULL DEFAULT 1 REFERENCES folders(id) ON DELETE CASCADE`, (err) => {
                         if (err) console.error("新增 'folder_id' 欄位失敗:", err.message);
                    });
                }
            });

            // 步驟 3: 維持原有的 files 資料表結構
            db.run(`CREATE TABLE IF NOT EXISTS files (
                message_id INTEGER PRIMARY KEY,
                fileName TEXT NOT NULL,
                mimetype TEXT,
                file_id TEXT NOT NULL UNIQUE,
                thumb_file_id TEXT,
                date INTEGER NOT NULL,
                share_token TEXT,
                share_expires_at INTEGER
            )`);
        });
    }
});

module.exports = db;
