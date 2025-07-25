const db = require('./database.js');
const crypto = require('crypto');
const path = require('path');

// --- 使用者管理 ---
function createUser(username, hashedPassword) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO users (username, password, is_admin) VALUES (?, ?, 0)`;
        db.run(sql, [username, hashedPassword], function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, username });
        });
    });
}

function findUserByName(username) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

// --- *** 新增部分 開始 *** ---
function findUserById(id) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}
// --- *** 新增部分 結束 *** ---

function changeUserPassword(userId, newHashedPassword) {
    return new Promise((resolve, reject) => {
        const sql = `UPDATE users SET password = ? WHERE id = ?`;
        db.run(sql, [newHashedPassword, userId], function(err) {
            if (err) return reject(err);
            resolve({ success: true, changes: this.changes });
        });
    });
}

function listNormalUsers() {
    return new Promise((resolve, reject) => {
        const sql = `SELECT id, username FROM users WHERE is_admin = 0 ORDER BY username ASC`;
        db.all(sql, [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function deleteUser(userId) {
    return new Promise((resolve, reject) => {
        // DB schema 'ON DELETE CASCADE' 會自動刪除關聯的 files 和 folders
        const sql = `DELETE FROM users WHERE id = ? AND is_admin = 0`; 
        db.run(sql, [userId], function(err) {
            if (err) return reject(err);
            resolve({ success: true, changes: this.changes });
        });
    });
}


// --- 檔案搜尋 ---
function searchFiles(query, userId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT *, message_id as id, fileName as name, 'file' as type 
                     FROM files 
                     WHERE fileName LIKE ? AND user_id = ?
                     ORDER BY date DESC`;
        const searchQuery = `%${query}%`;
        db.all(sql, [searchQuery, userId], (err, files) => {
            if (err) return reject(err);
            resolve({ folders: [], files: files.map(f => ({ ...f, message_id: f.id })) });
        });
    });
}

// --- 資料夾操作 ---
function getFolderContents(folderId, userId) {
    return new Promise((resolve, reject) => {
        const sqlFolders = `SELECT id, name, parent_id, 'folder' as type FROM folders WHERE parent_id = ? AND user_id = ? ORDER BY name ASC`;
        const sqlFiles = `SELECT *, message_id as id, fileName as name, 'file' as type FROM files WHERE folder_id = ? AND user_id = ? ORDER BY name ASC`;
        let contents = { folders: [], files: [] };
        db.all(sqlFolders, [folderId, userId], (err, folders) => {
            if (err) return reject(err);
            contents.folders = folders;
            db.all(sqlFiles, [folderId, userId], (err, files) => {
                if (err) return reject(err);
                contents.files = files.map(f => ({ ...f, message_id: f.id }));
                resolve(contents);
            });
        });
    });
}

async function getFilesRecursive(folderId, userId, currentPath = '') {
    let allFiles = [];
    const sqlFiles = "SELECT * FROM files WHERE folder_id = ? AND user_id = ?";
    const files = await new Promise((res, rej) => db.all(sqlFiles, [folderId, userId], (err, rows) => err ? rej(err) : res(rows)));
    for (const file of files) {
        allFiles.push({ ...file, path: path.join(currentPath, file.fileName) });
    }

    const sqlFolders = "SELECT id, name FROM folders WHERE parent_id = ? AND user_id = ?";
    const subFolders = await new Promise((res, rej) => db.all(sqlFolders, [folderId, userId], (err, rows) => err ? rej(err) : res(rows)));
    for (const subFolder of subFolders) {
        const nestedFiles = await getFilesRecursive(subFolder.id, userId, path.join(currentPath, subFolder.name));
        allFiles.push(...nestedFiles);
    }
    return allFiles;
}

function getFolderPath(folderId, userId) {
    let pathArr = [];
    return new Promise((resolve, reject) => {
        function findParent(id) {
            if (!id) return resolve(pathArr.reverse());
            db.get("SELECT id, name, parent_id FROM folders WHERE id = ? AND user_id = ?", [id, userId], (err, folder) => {
                if (err) return reject(err);
                if (folder) {
                    pathArr.push({ id: folder.id, name: folder.name });
                    findParent(folder.parent_id);
                } else {
                    resolve(pathArr.reverse());
                }
            });
        }
        findParent(folderId);
    });
}

function createFolder(name, parentId, userId) {
    const sql = `INSERT INTO folders (name, parent_id, user_id) VALUES (?, ?, ?)`;
    return new Promise((resolve, reject) => {
        db.run(sql, [name, parentId, userId], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return reject(new Error('同目錄下已存在同名資料夾。'));
                return reject(err);
            }
            resolve({ success: true, id: this.lastID });
        });
    });
}

function getAllFolders(userId) {
    return new Promise((resolve, reject) => {
        const sql = "SELECT id, name, parent_id FROM folders WHERE user_id = ? ORDER BY parent_id, name ASC";
        db.all(sql, [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function moveItems(itemIds, targetFolderId, userId) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            const placeholders = itemIds.map(() => '?').join(',');
            const moveFilesSql = `UPDATE files SET folder_id = ? WHERE message_id IN (${placeholders}) AND user_id = ?`;
            db.run(moveFilesSql, [targetFolderId, ...itemIds, userId]);
            const moveFoldersSql = `UPDATE folders SET parent_id = ? WHERE id IN (${placeholders}) AND user_id = ?`;
            db.run(moveFoldersSql, [targetFolderId, ...itemIds, userId]);
            resolve({ success: true });
        });
    });
}

async function deleteFolderRecursive(folderId, userId) {
    let filesToDelete = [];
    let foldersToDelete = [folderId];
    async function findContents(currentFolderId) {
        const sqlFiles = `SELECT message_id, file_id, storage_type FROM files WHERE folder_id = ? AND user_id = ?`;
        const files = await new Promise((res, rej) => db.all(sqlFiles, [currentFolderId, userId], (err, rows) => err ? rej(err) : res(rows)));
        filesToDelete.push(...files);
        const sqlFolders = `SELECT id FROM folders WHERE parent_id = ? AND user_id = ?`;
        const subFolders = await new Promise((res, rej) => db.all(sqlFolders, [currentFolderId, userId], (err, rows) => err ? rej(err) : res(rows)));
        for (const subFolder of subFolders) {
            foldersToDelete.push(subFolder.id);
            await findContents(subFolder.id);
        }
    }
    await findContents(folderId);
    const folderPlaceholders = foldersToDelete.map(() => '?').join(',');
    const deleteFoldersSql = `DELETE FROM folders WHERE id IN (${folderPlaceholders}) AND user_id = ?`;
    await new Promise((res, rej) => db.run(deleteFoldersSql, [...foldersToDelete, userId], (err) => err ? rej(err) : res()));
    return filesToDelete;
}

function addFile(fileData, folderId = 1, userId, storageType) {
    const { message_id, fileName, mimetype, file_id, thumb_file_id, date } = fileData;
    const sql = `INSERT INTO files (message_id, fileName, mimetype, file_id, thumb_file_id, date, folder_id, user_id, storage_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return new Promise((resolve, reject) => {
        db.run(sql, [message_id, fileName, mimetype, file_id, thumb_file_id, date, folderId, userId, storageType], function(err) {
            if (err) return reject(err);
            else resolve({ success: true, id: this.lastID, fileId: this.lastID });
        });
    });
}

function getFilesByIds(messageIds, userId) {
    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `SELECT * FROM files WHERE message_id IN (${placeholders}) AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.all(sql, [...messageIds, userId], (err, rows) => {
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

function renameFile(messageId, newFileName, userId) {
    const sql = `UPDATE files SET fileName = ? WHERE message_id = ? AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [newFileName, messageId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '文件未找到。' });
            else resolve({ success: true });
        });
    });
}

function renameFolder(folderId, newFolderName, userId) {
    const sql = `UPDATE folders SET name = ? WHERE id = ? AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [newFolderName, folderId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '資料夾未找到。' });
            else resolve({ success: true });
        });
    });
}

function createShareLink(messageId, expiresIn, userId) {
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
    const sql = `UPDATE files SET share_token = ?, share_expires_at = ? WHERE message_id = ? AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [token, expiresAt, messageId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '文件未找到。' });
            else resolve({ success: true, token });
        });
    });
}

function deleteFilesByIds(messageIds, userId) {
    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `DELETE FROM files WHERE message_id IN (${placeholders}) AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [...messageIds, userId], function(err) {
            if (err) reject(err);
            else resolve({ success: true, changes: this.changes });
        });
    });
}

function getActiveSharedFiles(userId) {
    const sql = "SELECT * FROM files WHERE share_token IS NOT NULL AND (share_expires_at IS NULL OR share_expires_at > ?) AND user_id = ?";
    return new Promise((resolve, reject) => {
        db.all(sql, [Date.now(), userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function cancelShare(messageId, userId) {
    const sql = `UPDATE files SET share_token = NULL, share_expires_at = NULL WHERE message_id = ? AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [messageId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '文件未找到或無需取消' });
            else resolve({ success: true });
        });
    });
}
function checkNameConflict(itemNames, targetFolderId, userId) {
    return new Promise((resolve, reject) => {
        if (!itemNames || itemNames.length === 0) {
            return resolve([]);
        }
        const placeholders = itemNames.map(() => '?').join(',');
        const sql = `SELECT fileName FROM files WHERE fileName IN (${placeholders}) AND folder_id = ? AND user_id = ?`;
        db.all(sql, [...itemNames, targetFolderId, userId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows.map(r => r.fileName));
        });
    });
}

function findFileInFolder(fileName, folderId, userId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT message_id FROM files WHERE fileName = ? AND folder_id = ? AND user_id = ?`;
        db.get(sql, [fileName, folderId, userId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

module.exports = { 
    createUser,
    findUserByName,
    findUserById,
    changeUserPassword,
    listNormalUsers,
    deleteUser,
    searchFiles, 
    getFolderContents, 
    getFilesRecursive, 
    getFolderPath, 
    createFolder, 
    getAllFolders, 
    deleteFolderRecursive, 
    addFile, 
    getFilesByIds, 
    moveItems, 
    getFileByShareToken, 
    createShareLink, 
    getActiveSharedFiles, 
    cancelShare, 
    renameFile, 
    renameFolder,
    deleteFilesByIds,
    findFileInFolder,
    checkNameConflict
};
