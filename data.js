const db = require('./database.js');
const crypto = require('crypto');

// --- 資料夾操作 ---

/**
 * 獲取指定資料夾的內容 (包含子資料夾和檔案)
 * @param {number | null} folderId - 資料夾 ID，如果是根目錄則為 1
 */
function getFolderContents(folderId = 1) {
    return new Promise((resolve, reject) => {
        const sqlFolders = `SELECT id, name, parent_id, 'folder' as type FROM folders WHERE parent_id = ? ORDER BY name ASC`;
        const sqlFiles = `SELECT message_id as id, fileName as name, mimetype, date, 'file' as type FROM files WHERE folder_id = ? ORDER BY name ASC`;

        let contents = { folders: [], files: [] };

        db.all(sqlFolders, [folderId], (err, folders) => {
            if (err) return reject(err);
            contents.folders = folders;
            
            db.all(sqlFiles, [folderId], (err, files) => {
                if (err) return reject(err);
                contents.files = files.map(f => ({ ...f, message_id: f.id })); // 保持 message_id
                resolve(contents);
            });
        });
    });
}

/**
 * 獲取資料夾的路徑 (麵包屑導航)
 * @param {number} folderId - 目前資料夾的 ID
 */
function getFolderPath(folderId) {
    let path = [];
    return new Promise((resolve, reject) => {
        function findParent(id) {
            if (!id) {
                return resolve(path.reverse());
            }
            const sql = "SELECT id, name, parent_id FROM folders WHERE id = ?";
            db.get(sql, [id], (err, folder) => {
                if (err) return reject(err);
                if (folder) {
                    path.push({ id: folder.id, name: folder.name });
                    findParent(folder.parent_id);
                } else {
                    resolve(path.reverse());
                }
            });
        }
        findParent(folderId);
    });
}


/**
 * 建立一個新資料夾
 * @param {string} name - 資料夾名稱
 * @param {number} parentId - 父資料夾 ID
 */
function createFolder(name, parentId = 1) {
    const sql = `INSERT INTO folders (name, parent_id) VALUES (?, ?)`;
    return new Promise((resolve, reject) => {
        db.run(sql, [name, parentId], function (err) {
            if (err) {
                // 'UNIQUE constraint failed' 錯誤通常是因為同名
                if (err.message.includes('UNIQUE')) {
                    return reject(new Error('同目錄下已存在同名資料夾。'));
                }
                return reject(err);
            }
            resolve({ success: true, id: this.lastID });
        });
    });
}


// --- 檔案操作 (已更新以支援資料夾) ---

/**
 * 新增一個檔案到指定資料夾
 * @param {object} fileData - 檔案資料
 * @param {number} folderId - 目標資料夾 ID
 */
function addFile(fileData, folderId = 1) {
    const { message_id, fileName, mimetype, file_id, thumb_file_id, date } = fileData;
    const sql = `INSERT INTO files (message_id, fileName, mimetype, file_id, thumb_file_id, date, folder_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    return new Promise((resolve, reject) => {
        db.run(sql, [message_id, fileName, mimetype, file_id, thumb_file_id, date, folderId], function(err) {
            if (err) reject(err);
            else resolve({ success: true, id: this.lastID });
        });
    });
}

// ... (其他檔案操作函式，如 getFilesByIds, getFileByShareToken, renameFile, createShareLink, deleteFilesByIds, getActiveSharedFiles, cancelShare 等保持不變，但請確認它們仍然在此檔案中)

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

function getFileByShareToken(token) {
     return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM files WHERE share_token = ?";
        db.get(sql, [token], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            if (row.share_expires_at && Date.now() > row.share_expires_at) {
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
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '文件未找到。' });
            else resolve({ success: true });
        });
    });
}

function createShareLink(messageId, expiresIn) {
    const token = crypto.randomBytes(16).toString('hex');
    let expiresAt = null;
    const now = Date.now();
    const hours = (h) => h * 60 * 60 * 1000;
    const days = (d) => d * 24 * hours(1);

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
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '文件未找到。' });
            else resolve({ success: true, token });
        });
    });
}

function deleteFilesByIds(messageIds) {
    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `DELETE FROM files WHERE message_id IN (${placeholders})`;
    return new Promise((resolve, reject) => {
        db.run(sql, messageIds, function(err) {
            if (err) reject(err);
            else resolve({ success: true, changes: this.changes });
        });
    });
}

function getActiveSharedFiles() {
    const sql = "SELECT * FROM files WHERE share_token IS NOT NULL AND (share_expires_at IS NULL OR share_expires_at > ?)";
    return new Promise((resolve, reject) => {
        db.all(sql, [Date.now()], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function cancelShare(messageId) {
    const sql = `UPDATE files SET share_token = NULL, share_expires_at = NULL WHERE message_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [messageId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '文件未找到或無需取消' });
            else resolve({ success: true });
        });
    });
}


module.exports = {
    // 資料夾
    getFolderContents,
    getFolderPath,
    createFolder,
    // 檔案
    addFile,
    getFilesByIds,
    // 分享
    getFileByShareToken,
    createShareLink,
    getActiveSharedFiles,
    cancelShare,
    // 其他
    renameFile,
    deleteFilesByIds,
};
