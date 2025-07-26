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

function findUserById(id) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function changeUserPassword(userId, newHashedPassword) {
    return new Promise((resolve, reject) => {
        const sql = `UPDATE users SET password = ? WHERE id = ?`;
        db.run(sql, [newHashedPassword, userId], function(err) {
            if (err) return reject(err);
            resolve({ success: true, changes: this.changes });
        });
    });
}

// --- 档案搜寻 ---
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

// --- 资料夹与档案操作 ---
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

// --- *** 关键修正: 递归获取档案 *** ---
async function getFilesRecursive(folderId, userId, currentPath = '') {
    let allFiles = [];
    const sqlFiles = "SELECT fileName FROM files WHERE folder_id = ? AND user_id = ?";
    const files = await new Promise((res, rej) => db.all(sqlFiles, [folderId, userId], (err, rows) => err ? rej(err) : res(rows)));
    for (const file of files) {
        allFiles.push(path.join(currentPath, file.fileName));
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
                if (err.message.includes('UNIQUE')) return reject(new Error('同目录下已存在同名资料夹。'));
                return reject(err);
            }
            resolve({ success: true, id: this.lastID });
        });
    });
}

function findFolderByName(name, parentId, userId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT id, name FROM folders WHERE name = ? AND parent_id = ? AND user_id = ?`;
        db.get(sql, [name, parentId, userId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
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

// --- *** 关键修正: 重写移动逻辑以处理合并 *** ---
async function moveItems(itemIds, targetFolderId, userId, overwriteList = []) {
    db.serialize(async () => {
        const filesToMove = [];
        const foldersToMove = [];
        const allItems = await new Promise((res, rej) => {
            const placeholders = itemIds.map(() => '?').join(',');
            const sql = `
                SELECT id, name, 'folder' as type FROM folders WHERE id IN (${placeholders}) AND user_id = ?
                UNION ALL
                SELECT message_id as id, fileName as name, 'file' as type FROM files WHERE message_id IN (${placeholders}) AND user_id = ?
            `;
            db.all(sql, [...itemIds, userId, ...itemIds, userId], (err, rows) => err ? rej(err) : res(rows));
        });

        for(const item of allItems) {
            if (item.type === 'file') {
                filesToMove.push({ id: item.id, name: item.name });
            } else {
                foldersToMove.push({ id: item.id, name: item.name });
            }
        }

        // 1. 移动独立档案
        const filesToUpdate = filesToMove.map(f => f.id);
        if (filesToUpdate.length > 0) {
            const placeholders = filesToUpdate.map(() => '?').join(',');
            const moveFilesSql = `UPDATE files SET folder_id = ? WHERE message_id IN (${placeholders}) AND user_id = ?`;
            await new Promise((res, rej) => db.run(moveFilesSql, [targetFolderId, ...filesToUpdate, userId], err => err ? rej(err) : res()));
        }

        // 2. 移动资料夹
        for (const folder of foldersToMove) {
            const existingFolder = await findFolderByName(folder.name, targetFolderId, userId);
            // 如果目标位置存在同名资料夹，则进行合并
            if (existingFolder) {
                await mergeFolderContents(folder.id, existingFolder.id, userId, overwriteList);
                // 删除已被合并的来源资料夹
                await new Promise((res, rej) => db.run('DELETE FROM folders WHERE id = ?', [folder.id], err => err ? rej(err) : res()));
            } else {
                // 否则直接移动
                const moveFolderSql = `UPDATE folders SET parent_id = ? WHERE id = ? AND user_id = ?`;
                await new Promise((res, rej) => db.run(moveFolderSql, [targetFolderId, folder.id, userId], err => err ? rej(err) : res()));
            }
        }
    });
    return { success: true };
}

async function mergeFolderContents(sourceFolderId, targetFolderId, userId, overwriteList) {
    // 移动子资料夹和档案
    const subFoldersSql = `SELECT id FROM folders WHERE parent_id = ? AND user_id = ?`;
    const subFolders = await new Promise((res, rej) => db.all(subFoldersSql, [sourceFolderId, userId], (err, r) => err ? rej(err) : res(r)));
    await moveItems(subFolders.map(f => f.id), targetFolderId, userId, overwriteList);

    const subFilesSql = `SELECT message_id, fileName FROM files WHERE folder_id = ? AND user_id = ?`;
    const subFiles = await new Promise((res, rej) => db.all(subFilesSql, [sourceFolderId, userId], (err, r) => err ? rej(err) : res(r)));
    
    for(const file of subFiles) {
        const targetFile = await findFileInFolder(file.fileName, targetFolderId, userId);
        if (targetFile) {
            // 如果在允许覆盖列表中，则删除旧的，移动新的
            if(overwriteList.includes(file.fileName)){
                await deleteFilesByIds([targetFile.message_id], userId);
                await new Promise((res, rej) => db.run('UPDATE files SET folder_id = ? WHERE message_id = ?', [targetFolderId, file.message_id], err => err ? rej(err) : res()));
            }
            // 如果不在覆盖列表中，则此档案不动（保留在原资料夹，最终会被删除）
        } else {
            // 没有同名档案，直接移动
            await new Promise((res, rej) => db.run('UPDATE files SET folder_id = ? WHERE message_id = ?', [targetFolderId, file.message_id], err => err ? rej(err) : res()));
        }
    }
}


function addFile(fileData, folderId = 1, userId, storageType) {
    const { message_id, fileName, mimetype, file_id, thumb_file_id, date, size } = fileData;
    const sql = `INSERT OR IGNORE INTO files (message_id, fileName, mimetype, file_id, thumb_file_id, date, size, folder_id, user_id, storage_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return new Promise((resolve, reject) => {
        db.run(sql, [message_id, fileName, mimetype, file_id, thumb_file_id, date, size, folderId, userId, storageType], function(err) {
            if (err) reject(err);
            else resolve({ success: true, id: this.lastID, fileId: this.lastID });
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

function getFolderByShareToken(token) {
     return new Promise((resolve, reject) => {
        const sql = "SELECT * FROM folders WHERE share_token = ?";
        db.get(sql, [token], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            if (row.share_expires_at && Date.now() > row.share_expires_at) {
                const updateSql = "UPDATE folders SET share_token = NULL, share_expires_at = NULL WHERE id = ?";
                db.run(updateSql, [row.id]);
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
            else if (this.changes === 0) resolve({ success: false, message: '资料夹未找到。' });
            else resolve({ success: true });
        });
    });
}

function createShareLink(itemId, itemType, expiresIn, userId) {
    const token = crypto.randomBytes(16).toString('hex');
    let expiresAt = null;
    if(expiresIn !== '0'){
       expiresAt = Date.now() + (parseInt(expiresIn.slice(0, -1)) * (expiresIn.endsWith('h') ? 3600000 : 86400000));
    }

    const table = itemType === 'folder' ? 'folders' : 'files';
    const idColumn = itemType === 'folder' ? 'id' : 'message_id';

    const sql = `UPDATE ${table} SET share_token = ?, share_expires_at = ? WHERE ${idColumn} = ? AND user_id = ?`;

    return new Promise((resolve, reject) => {
        db.run(sql, [token, expiresAt, itemId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '项目未找到。' });
            else resolve({ success: true, token });
        });
    });
}

function deleteFilesByIds(messageIds, userId) {
    if(!messageIds || messageIds.length === 0) return Promise.resolve({ success: true, changes: 0 });
    const placeholders = messageIds.map(() => '?').join(',');
    const sql = `DELETE FROM files WHERE message_id IN (${placeholders}) AND user_id = ?`;
    return new Promise((resolve, reject) => {
        db.run(sql, [...messageIds, userId], function(err) {
            if (err) reject(err);
            else resolve({ success: true, changes: this.changes });
        });
    });
}

function getActiveShares(userId) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        const sqlFiles = `SELECT message_id as id, fileName as name, 'file' as type, share_token, share_expires_at FROM files WHERE share_token IS NOT NULL AND (share_expires_at IS NULL OR share_expires_at > ?) AND user_id = ?`;
        const sqlFolders = `SELECT id, name, 'folder' as type, share_token, share_expires_at FROM folders WHERE share_token IS NOT NULL AND (share_expires_at IS NULL OR share_expires_at > ?) AND user_id = ?`;

        let shares = [];
        db.all(sqlFiles, [now, userId], (err, files) => {
            if (err) return reject(err);
            shares = shares.concat(files);
            db.all(sqlFolders, [now, userId], (err, folders) => {
                if (err) return reject(err);
                shares = shares.concat(folders);
                resolve(shares);
            });
        });
    });
}

function cancelShare(itemId, itemType, userId) {
    const table = itemType === 'folder' ? 'folders' : 'files';
    const idColumn = itemType === 'folder' ? 'id' : 'message_id';
    const sql = `UPDATE ${table} SET share_token = NULL, share_expires_at = NULL WHERE ${idColumn} = ? AND user_id = ?`;

    return new Promise((resolve, reject) => {
        db.run(sql, [itemId, userId], function(err) {
            if (err) reject(err);
            else if (this.changes === 0) resolve({ success: false, message: '项目未找到或无需取消' });
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
        const filesSql = `SELECT fileName as name FROM files WHERE fileName IN (${placeholders}) AND folder_id = ? AND user_id = ?`;
        const foldersSql = `SELECT name FROM folders WHERE name IN (${placeholders}) AND parent_id = ? AND user_id = ?`;

        let conflicts = [];
        db.all(filesSql, [...itemNames, targetFolderId, userId], (err, rows) => {
            if (err) return reject(err);
            conflicts.push(...rows.map(r => r.name));
            db.all(foldersSql, [...itemNames, targetFolderId, userId], (err, rows) => {
                 if (err) return reject(err);
                 conflicts.push(...rows.map(r => r.name));
                 resolve(conflicts);
            });
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
    searchFiles,
    getFolderContents,
    getFilesRecursive, // 导出新函式
    getFolderPath,
    createFolder,
    findFolderByName,
    getAllFolders,
    moveItems,
    addFile,
    getFileByShareToken,
    getFolderByShareToken,
    createShareLink,
    getActiveShares,
    cancelShare,
    renameFile,
    renameFolder,
    deleteFilesByIds,
    findFileInFolder,
    checkNameConflict
};
