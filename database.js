const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// 預設在專案根目錄下使用 'data' 資料夾
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'file-manager.db');

console.log(`ℹ️  資料庫路徑已設定為: ${DB_FILE}`);

// 步驟 1: 檢查並創建資料夾
// 這是解決問題的關鍵步驟
try {
    if (!fs.existsSync(DATA_DIR)) {
        console.log(`[檢查] 'data' 資料夾不存在，正在嘗試創建...`);
        fs.mkdirSync(DATA_DIR);
        console.log(`✅ [成功] 'data' 資料夾已成功創建於: ${DATA_DIR}`);
    } else {
        console.log(`[檢查] 'data' 資料夾已存在。`);
    }
} catch (error) {
    console.error(`❌ [致命錯誤] 無法創建資料夾: ${DATA_DIR}`);
    console.error(`錯誤詳情: ${error.message}`);
    console.error('這個錯誤表示應用程式沒有權限在目前位置寫入檔案。請聯繫您的主機平台客服並提供此錯誤訊息。');
    process.exit(1); // 退出程式，因為後續步驟必定會失敗
}

// 步驟 2: 連接到資料庫
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('❌ [致命錯誤] 无法连接到数据库:', err.message);
        console.error('如果資料夾已成功創建但這裡出錯，可能是檔案鎖定或權限問題。');
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
            }
        });
    }
});

module.exports = db;
