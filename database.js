const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

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
            db.run("PRAGMA foreign_keys = ON;");

            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                is_admin BOOLEAN NOT NULL DEFAULT 0
            )`);
            
            // --- *** 修改部分 開始 *** ---
            // 為 folders 資料表新增 share_token 和 share_expires_at 欄位
            db.run(`CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                parent_id INTEGER,
                user_id INTEGER NOT NULL,
                share_token TEXT,
                share_expires_at INTEGER,
                FOREIGN KEY (parent_id) REFERENCES folders (id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )`);
            // --- *** 修改部分 結束 *** ---
            
            db.run(`CREATE TABLE IF NOT EXISTS files (
                message_id INTEGER PRIMARY KEY,
                fileName TEXT NOT NULL,
                mimetype TEXT,
                file_id TEXT NOT NULL,
                thumb_file_id TEXT,
                date INTEGER NOT NULL,
                share_token TEXT,
                share_expires_at INTEGER,
                folder_id INTEGER NOT NULL DEFAULT 1,
                user_id INTEGER NOT NULL,
                storage_type TEXT NOT NULL DEFAULT 'telegram',
                UNIQUE(fileName, folder_id, user_id),
                FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`);

            db.get("SELECT * FROM users WHERE is_admin = 1", (err, admin) => {
                if (!admin) {
                    const adminUser = process.env.ADMIN_USER || 'admin';
                    const adminPass = process.env.ADMIN_PASS || 'admin';
                    const salt = bcrypt.genSaltSync(10);
                    const hashedPassword = bcrypt.hashSync(adminPass, salt);

                    db.run("INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)", [adminUser, hashedPassword], function(err) {
                        if (err) return console.error("建立管理員帳號失敗", err);
                        const adminId = this.lastID;
                        db.get("SELECT * FROM folders WHERE user_id = ? AND parent_id IS NULL", [adminId], (err, root) => {
                            if (!root) {
                                db.run("INSERT INTO folders (name, parent_id, user_id) VALUES (?, NULL, ?)", ['/', adminId]);
                            }
                        });
                    });
                }
            });
        });
    }
});

module.exports = db;
