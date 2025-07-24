const db = require('./database.js');
const crypto = require('crypto');

// --- 資料庫操作函數 ---

function addFile({ message_id, fileName, mimetype, file_id, thumb_file_id, date }) {
    const sql = `INSERT INTO files (message_id, fileName, mimetype, file_id, thumb_file_id, date)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    return new Promise((resolve, reject) => {
        db.run(sql, [message_id, fileName, mimetype, file_id, thumb_file_id, date], function(err) {
            if (err) {
                console.error('資料庫寫入失敗:', err.message);
                reject(err);
            } else {
                resolve({ success: true, id: this.lastID });
            }
        });
    });
}

function getAllFiles() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM files ORDER BY date DESC", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getFileByShareToken(token) {
     return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM files WHERE share_token = ?";
        db.get(sql, [token], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);

            // 检查是否过期
            if (row.share_expires_at && Date.now() > row.share_expires_at) {
                // 清理掉过期的 token
                const updateSql = "UPDATE files SET share_token = NULL, share_expires_at = NULL WHERE message_id = ?";
                db.run(updateSql, [row.message_id]);
                resolve(null);
            } else {
                resolve(row);
            }
        });
    });
}

function renameFile(messageId, newFileName) {
    const sql = `UPDATE files SET fileName = ? WHERE message_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [newFileName, messageId], function(err) {
            if (err) {
                reject(err);
            } else if (this.changes === 0) {
                resolve({ success: false, message: '文件未找到。' });
            } else {
                resolve({ success: true });
            }
        });
    });
}

function createShareLink(messageId, expiresIn) {
    const token = crypto.randomBytes(16).toString('hex');
    let expiresAt = null;
    const now = Date.now();
    const hours = (h) => h * 60 * 60 * 1000;
    const days = (d) => d * 24 * 60 * 60 * 1000;

    switch (expiresIn) {
        case '1h': expiresAt = now + hours(1); break;
        case '3h': expiresAt = now + hours(3); break;
        case '5h': expiresAt = now + hours(5); break;
        case '7h': expiresAt = now + hours(7); break;
        case '24h': expiresAt = now + hours(24); break;
        case '7d': expiresAt = now + days(7); break;
        case '0': expiresAt = null; break;
        default: expiresAt = now + hours(24);
    }

    const sql = `UPDATE files SET share_token = ?, share_expires_at = ? WHERE message_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [token, expiresAt, messageId], function(err) {
            if (err) {
                reject(err);
            } else if (this.changes === 0) {
                 resolve({ success: false, message: '文件未找到。' });
            } else {
                resolve({ success: true, token });
            }
        });
    });
}

function deleteFilesByIds(messageIds) {
    // 使用 IN 子句和參數化查詢來一次刪除多個文件
    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `DELETE FROM files WHERE message_id IN (${placeholders})`;
    
    return new Promise((resolve, reject) => {
        db.run(sql, messageIds, function(err) {
            if (err) reject(err);
            else resolve({ success: true, changes: this.changes });
        });
    });
}

function getFilesByIds(messageIds) {
    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `SELECT * FROM files WHERE message_id IN (${placeholders})`;

    return new Promise((resolve, reject) => {
        db.all(sql, messageIds, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}


module.exports = {
    addFile,
    getAllFiles,
    getFileByShareToken,
    renameFile,
    createShareLink,
    deleteFilesByIds,
    getFilesByIds
};
