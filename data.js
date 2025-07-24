const db = require('./database.js');
const crypto = require('crypto');

function searchFiles(query) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT message_id as id, fileName as name, mimetype, date, 'file' as type 
                     FROM files 
                     WHERE name LIKE ? 
                     ORDER BY date DESC`;
        const searchQuery = `%${query}%`;
        db.all(sql, [searchQuery], (err, files) => {
            if (err) return reject(err);
            resolve({ folders: [], files: files.map(f => ({ ...f, message_id: f.id })) });
        });
    });
}

function getFolderContents(folderId = 1) {
    // --- 偵錯日誌 ---
    console.log(`[DEBUG - data.js] 執行 getFolderContents，請求的 folderId: ${folderId}`);
    return new Promise((resolve, reject) => {
        const sqlFolders = `SELECT id, name, parent_id, 'folder' as type FROM folders WHERE parent_id = ? ORDER BY name ASC`;
        const sqlFiles = `SELECT message_id as id, fileName as name, mimetype, date, 'file' as type FROM files WHERE folder_id = ? ORDER BY name ASC`;
        let contents = { folders: [], files: [] };
        db.all(sqlFolders, [folderId], (err, folders) => {
            if (err) {
                console.error('[DEBUG - data.js] 查詢資料夾時發生錯誤:', err);
                return reject(err);
            }
            console.log(`[DEBUG - data.js] 成功查詢到 ${folders.length} 個子資料夾。`);
            contents.folders = folders;
            db.all(sqlFiles, [folderId], (err, files) => {
                if (err) {
                    console.error('[DEBUG - data.js] 查詢檔案時發生錯誤:', err);
                    return reject(err);
                }
                console.log(`[DEBUG - data.js] 成功查詢到 ${files.length} 個檔案。`);
                contents.files = files.map(f => ({ ...f, message_id: f.id }));
                resolve(contents);
            });
        });
    });
}

// ... (檔案中所有其他函式保持不變) ...
function getFolderPath(folderId) {
    let path = [];
    return new Promise((resolve, reject) => {
        function findParent(id) {
            if (!id) return resolve(path.reverse());
            db.get("SELECT id, name, parent_id FROM folders WHERE id = ?", [id], (err, folder) => {
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
function createFolder(name, parentId = 1) {
    const sql = `INSERT INTO folders (name, parent_id) VALUES (?, ?)`;
    return new Promise((resolve, reject) => {
        db.run(sql, [name, parentId], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return reject(new Error('同目錄下已存在同名資料夾。'));
                return reject(err);
            }
            resolve({ success: true, id: this.lastID });
        });
    });
}
function getAllFolders() {
    return new Promise((resolve, reject) => {
        const sql = "SELECT id, name, parent_id FROM folders ORDER BY parent_id, name ASC";
        db.all(sql, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}
function moveItems(itemIds, targetFolderId) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            const placeholders = itemIds.map(() => '?').join(',');
            const moveFilesSql = `UPDATE files SET folder_id = ? WHERE message_id IN (${placeholders})`;
            db.run(moveFilesSql, [targetFolderId, ...itemIds], (err) => {
                if(err) return reject(err);
            });
            const moveFoldersSql = `UPDATE folders SET parent_id = ? WHERE id IN (${placeholders})`;
            db.run(moveFoldersSql, [targetFolderId, ...itemIds], (err) => {
                if(err) return reject(err);
            });
            resolve({ success: true });
        });
    });
}
async function deleteFolderRecursive(folderId) {
    let filesToDelete = [];
    let foldersToDelete = [folderId];
    async function findContents(currentFolderId) {
        const sqlFiles = `SELECT message_id FROM files WHERE folder_id = ?`;
        const files = await new Promise((res, rej) => db.all(sqlFiles, [currentFolderId], (err, rows) => err ? rej(err) : res(rows)));
        filesToDelete.push(...files.map(f => f.message_id));
        const sqlFolders = `SELECT id FROM folders WHERE parent_id = ?`;
        const subFolders = await new Promise((res, rej) => db.all(sqlFolders, [currentFolderId], (err, rows) => err ? rej(err) : res(rows)));
        for (const subFolder of subFolders) {
            foldersToDelete.push(subFolder.id);
            await findContents(subFolder.id);
        }
    }
    await findContents(folderId);
    const folderPlaceholders = foldersToDelete.map(() => '?').join(',');
    const deleteFoldersSql = `DELETE FROM folders WHERE id IN (${folderPlaceholders})`;
    await new Promise((res, rej) => db.run(deleteFoldersSql, foldersToDelete, (err) => err ? rej(err) : res()));
    return filesToDelete;
}
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
module.exports = { searchFiles, getFolderContents, getFolderPath, createFolder, getAllFolders, deleteFolderRecursive, addFile, getFilesByIds, moveItems, getFileByShareToken, createShareLink, getActiveSharedFiles, cancelShare, renameFile, deleteFilesByIds, };
