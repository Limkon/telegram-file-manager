require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const bcrypt = require('bcrypt');
const fs = require('fs');
const db = require('./database.js'); 

const data = require('./data.js');
const storageManager = require('./storage'); 

const app = express();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 1000 * 1024 * 1024 } });
const PORT = process.env.PORT || 8100;

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-strong-random-secret-here-please-change',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 天
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- 中介軟體 ---
const fixFileNameEncoding = (req, res, next) => {
    if (req.files) {
        req.files.forEach(file => {
            file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        });
    }
    next();
};

function requireLogin(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
    if (req.session.loggedIn && req.session.isAdmin) {
        return next();
    }
    res.status(403).send('權限不足');
}

// --- 路由 ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views/register.html')));
app.get('/editor', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/editor.html')));

app.post('/login', async (req, res) => {
    try {
        const user = await data.findUserByName(req.body.username);
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            req.session.loggedIn = true;
            req.session.userId = user.id;
            req.session.isAdmin = !!user.is_admin;
            res.redirect('/');
        } else {
            res.status(401).send('帳號或密碼錯誤');
        }
    } catch(error) {
        res.status(500).send('登入時發生錯誤');
    }
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('請提供使用者名稱和密碼');
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = await data.createUser(username, hashedPassword); 
        await data.createFolder('/', null, newUser.id); 
        res.redirect('/login');
    } catch (error) {
        res.status(500).send('註冊失敗，使用者名稱可能已被使用。');
    }
});

app.get('/', requireLogin, (req, res) => {
    db.get("SELECT id FROM folders WHERE user_id = ? AND parent_id IS NULL", [req.session.userId], (err, rootFolder) => {
        if (err || !rootFolder) {
            return res.status(500).send("找不到您的根目錄");
        }
        res.redirect(`/folder/${rootFolder.id}`);
    });
});
app.get('/folder/:id', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/manager.html')));
app.get('/shares-page', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/shares.html')));
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'views/admin.html')));

app.get('/local-files/:userId/:fileId', requireLogin, (req, res) => {
    if (String(req.params.userId) !== String(req.session.userId) && !req.session.isAdmin) {
        return res.status(403).send("權限不足");
    }
    const filePath = path.join(__dirname, 'data', 'uploads', req.params.userId, req.params.fileId);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send("檔案不存在");
    }
});


// --- API 接口 ---
app.get('/api/admin/storage-mode', requireAdmin, (req, res) => {
    res.json({ mode: storageManager.readConfig().storageMode });
});

app.post('/api/admin/storage-mode', requireAdmin, (req, res) => {
    const { mode } = req.body;
    if (storageManager.setStorageMode(mode)) {
        res.json({ success: true, message: '設定已儲存。' });
    } else {
        res.status(400).json({ success: false, message: '無效的模式' });
    }
});

app.post('/upload', requireLogin, upload.array('files'), fixFileNameEncoding, async (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: '沒有選擇文件' });
    
    const folderId = req.body.folderId ? parseInt(req.body.folderId, 10) : 1;
    const userId = req.session.userId;
    const storage = storageManager.getStorage();

    const overwriteInfo = req.body.overwrite ? JSON.parse(req.body.overwrite) : [];
    if (overwriteInfo.length > 0) {
        const filesToDelete = await data.getFilesByIds(overwriteInfo.map(f => f.messageId), userId);
        if (filesToDelete.length > 0) {
            await storage.remove(filesToDelete, userId);
        }
    }
    
    const results = [];
    for (const file of req.files) {
        const result = await storage.upload(file.buffer, file.originalname, file.mimetype, userId, folderId, req.body.caption || '');
        results.push(result);
    }
    res.json({ success: true, results });
});

app.post('/api/text-file', requireLogin, async (req, res) => {
    const { mode, fileId, folderId, fileName, content } = req.body;
    const userId = req.session.userId;
    const storage = storageManager.getStorage();

    if (!fileName || !fileName.endsWith('.txt')) {
        return res.status(400).json({ success: false, message: '檔名無效或不是 .txt 檔案' });
    }

    try {
        const contentBuffer = Buffer.from(content, 'utf8');

        if (mode === 'edit' && fileId) {
            const filesToDelete = await data.getFilesByIds([fileId], userId);
            if (filesToDelete.length > 0) {
                await storage.remove(filesToDelete, userId);
                const result = await storage.upload(contentBuffer, fileName, 'text/plain', userId, filesToDelete[0].folder_id);
                res.json(result);
            } else {
                res.status(404).json({ success: false, message: '找不到要編輯的原始檔案' });
            }
        } else if (mode === 'create' && folderId) {
            const result = await storage.upload(contentBuffer, fileName, 'text/plain', userId, folderId);
            res.json(result);
        } else {
            res.status(400).json({ success: false, message: '請求參數無效' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: '伺服器內部錯誤' });
    }
});

app.get('/api/file-info/:id', requireLogin, async (req, res) => {
    try {
        const fileId = parseInt(req.params.id, 10);
        const [fileInfo] = await data.getFilesByIds([fileId], req.session.userId);
        if (fileInfo) {
            res.json(fileInfo);
        } else {
            res.status(404).json({ success: false, message: '找不到檔案資訊' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: '獲取檔案資訊失敗' });
    }
});

app.post('/api/check-existence', requireLogin, async (req, res) => {
    const { fileNames, folderId } = req.body;
    const userId = req.session.userId;
    if (!fileNames || !Array.isArray(fileNames) || !folderId) {
        return res.status(400).json({ success: false, message: '無效的請求參數。' });
    }
    const existenceChecks = await Promise.all(
        fileNames.map(async (name) => {
            const existingFile = await data.findFileInFolder(name, folderId, userId);
            return { name, exists: !!existingFile, messageId: existingFile ? existingFile.message_id : null };
        })
    );
    res.json({ success: true, files: existenceChecks });
});

app.post('/api/check-move-conflict', requireLogin, async (req, res) => {
    try {
        const { itemIds, targetFolderId } = req.body;
        const userId = req.session.userId;
        if (!itemIds || !Array.isArray(itemIds) || !targetFolderId) {
            return res.status(400).json({ success: false, message: '無效的請求參數。' });
        }

        const filesToMove = await data.getFilesByIds(itemIds, userId);
        const fileNamesToMove = filesToMove.map(f => f.fileName);

        const conflictingFiles = await data.checkNameConflict(fileNamesToMove, targetFolderId, userId);

        res.json({ success: true, conflicts: conflictingFiles });
    } catch (error) {
        res.status(500).json({ success: false, message: '檢查名稱衝突時出錯。' });
    }
});

// --- *** 修改部分 開始 *** ---
app.get('/api/search', requireLogin, async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ success: false, message: '需要提供搜尋關鍵字。' });
        
        // 修正：將 userId 從 session 傳遞給 searchFiles 函式
        const contents = await data.searchFiles(query, req.session.userId); 
        
        const path = [{ id: null, name: `搜尋結果: "${query}"` }];
        res.json({ contents, path });
    } catch (error) { 
        res.status(500).json({ success: false, message: '搜尋失敗。' }); 
    }
});
// --- *** 修改部分 結束 *** ---

app.get('/api/folder/:id', requireLogin, async (req, res) => {
    try {
        const folderId = parseInt(req.params.id, 10);
        const contents = await data.getFolderContents(folderId, req.session.userId);
        const path = await data.getFolderPath(folderId, req.session.userId);
        res.json({ contents, path });
    } catch (error) { res.status(500).json({ success: false, message: '讀取資料夾內容失敗。' }); }
});

app.post('/api/folder', requireLogin, async (req, res) => {
    const { name, parentId } = req.body;
    if (!name || !parentId) return res.status(400).json({ success: false, message: '缺少資料夾名稱或父 ID。' });
    const result = await data.createFolder(name, parentId, req.session.userId);
    res.json(result);
});

app.get('/api/folders', requireLogin, async (req, res) => {
    const folders = await data.getAllFolders(req.session.userId);
    res.json(folders);
});

app.post('/api/move', requireLogin, async (req, res) => {
    try {
        const { itemIds, targetFolderId, overwrite } = req.body;
        const userId = req.session.userId;
        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0 || !targetFolderId) {
            return res.status(400).json({ success: false, message: '無效的請求參數。' });
        }
        
        if (overwrite) {
            const filesToMove = await data.getFilesByIds(itemIds, userId);
            const fileNamesToMove = filesToMove.map(f => f.fileName);
            const storage = storageManager.getStorage();

            const existingFilesData = await Promise.all(
                fileNamesToMove.map(name => data.findFileInFolder(name, targetFolderId, userId))
            );
            const messageIdsToDelete = existingFilesData.filter(f => f).map(f => f.message_id);

            if (messageIdsToDelete.length > 0) {
                const filesToDeleteDetails = await data.getFilesByIds(messageIdsToDelete, userId);
                await storage.remove(filesToDeleteDetails, userId);
            }
        }

        await data.moveItems(itemIds, targetFolderId, userId);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: '移動失敗' }); }
});

app.post('/api/folder/delete', requireLogin, async (req, res) => {
    const { folderId } = req.body;
    const userId = req.session.userId;
    const storage = storageManager.getStorage();
    if (!folderId) return res.status(400).json({ success: false, message: '無效的資料夾 ID。' });
    
    const folderInfo = await data.getFolderPath(folderId, userId);
    if (!folderInfo || folderInfo.length === 0) {
        return res.status(404).json({ success: false, message: '找不到指定的資料夾。' });
    }
    if (folderInfo.length === 1 && folderInfo[0].id === folderId) {
        return res.status(400).json({ success: false, message: '無法刪除根目錄。' });
    }

    const filesToDelete = await data.deleteFolderRecursive(folderId, userId);
    if (filesToDelete.length > 0) {
        await storage.remove(filesToDelete, userId);
    }
    res.json({ success: true });
});

app.post('/rename', requireLogin, async (req, res) => {
    try {
        const { id, newName, type } = req.body;
        const userId = req.session.userId;
        if (!id || !newName || !type) {
            return res.status(400).json({ success: false, message: '缺少必要參數。'});
        }

        let result;
        if (type === 'file') {
            result = await data.renameFile(parseInt(id, 10), newName, userId);
        } else if (type === 'folder') {
            result = await data.renameFolder(parseInt(id, 10), newName, userId);
        } else {
            return res.status(400).json({ success: false, message: '無效的項目類型。'});
        }
        res.json(result);
    } catch (error) { 
        res.status(500).json({ success: false, message: '重命名失敗' }); 
    }
});

app.post('/delete-multiple', requireLogin, async (req, res) => {
    const { messageIds } = req.body;
    const userId = req.session.userId;
    const storage = storageManager.getStorage();
    if (!messageIds || !Array.isArray(messageIds)) return res.status(400).json({ success: false, message: '無效的 messageIds。' });

    const filesToDelete = await data.getFilesByIds(messageIds, userId);
    const result = await storage.remove(filesToDelete, userId);

    res.json(result);
});

app.get('/thumbnail/:message_id', requireLogin, async (req, res) => {
    try {
        const messageId = parseInt(req.params.message_id, 10);
        const [fileInfo] = await data.getFilesByIds([messageId], req.session.userId);

        if (fileInfo && fileInfo.storage_type === 'telegram' && fileInfo.thumb_file_id) {
            const storage = storageManager.getStorage();
            const link = await storage.getUrl(fileInfo.thumb_file_id);
            if (link) return res.redirect(link);
        }
        
        const placeholder = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': placeholder.length });
        res.end(placeholder);

    } catch (error) { res.status(500).send('獲取縮圖失敗'); }
});

app.get('/download/proxy/:message_id', requireLogin, async (req, res) => {
    try {
        const messageId = parseInt(req.params.message_id, 10);
        const [fileInfo] = await data.getFilesByIds([messageId], req.session.userId);
        
        if (fileInfo && fileInfo.file_id) {
            const storage = storageManager.getStorage();
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.fileName)}`);

            if (fileInfo.storage_type === 'telegram') {
                const link = await storage.getUrl(fileInfo.file_id);
                if (link) {
                    const response = await axios({ method: 'get', url: link, responseType: 'stream' });
                    response.data.pipe(res);
                } else { res.status(404).send('無法獲取文件鏈接'); }
            } else {
                if (fs.existsSync(fileInfo.file_id)) {
                    res.download(fileInfo.file_id, fileInfo.fileName);
                } else {
                    res.status(404).send('本地檔案不存在');
                }
            }
        } else { res.status(404).send('文件信息未找到'); }
    } catch (error) { res.status(500).send('下載代理失敗'); }
});

app.get('/file/content/:message_id', requireLogin, async (req, res) => {
    try {
        const messageId = parseInt(req.params.message_id, 10);
        const [fileInfo] = await data.getFilesByIds([messageId], req.session.userId);

        if (fileInfo && fileInfo.file_id) {
            const storage = storageManager.getStorage();
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');

            if (fileInfo.storage_type === 'telegram') {
                const link = await storage.getUrl(fileInfo.file_id);
                if (link) {
                    const response = await axios.get(link, { responseType: 'text' });
                    res.send(response.data);
                } else { res.status(404).send('無法獲取文件鏈接'); }
            } else {
                if (fs.existsSync(fileInfo.file_id)) {
                    const content = await fs.promises.readFile(fileInfo.file_id, 'utf-8');
                    res.send(content);
                } else {
                    res.status(404).send('本地檔案不存在');
                }
            }
        } else { res.status(404).send('文件信息未找到'); }
    } catch (error) { res.status(500).send('無法獲取文件內容'); }
});

app.post('/api/download-archive', requireLogin, async (req, res) => {
    try {
        const { messageIds = [], folderIds = [] } = req.body;
        const userId = req.session.userId;
        const storage = storageManager.getStorage();

        if (messageIds.length === 0 && folderIds.length === 0) {
            return res.status(400).send('未提供任何項目 ID');
        }
        let filesToArchive = [];
        if (messageIds.length > 0) {
            const directFiles = await data.getFilesByIds(messageIds, userId);
            filesToArchive.push(...directFiles.map(f => ({ ...f, path: f.fileName })));
        }
        for (const folderId of folderIds) {
            const folderInfo = (await data.getFolderPath(folderId, userId)).pop();
            const folderName = folderInfo ? folderInfo.name : 'folder';
            const nestedFiles = await data.getFilesRecursive(folderId, userId, folderName);
            filesToArchive.push(...nestedFiles);
        }
        if (filesToArchive.length === 0) {
            return res.status(404).send('找不到任何可下載的檔案');
        }
        
        const archive = archiver('zip', { zlib: { level: 9 } });
        res.attachment('download.zip');
        archive.pipe(res);

        for (const file of filesToArchive) {
            if (file.storage_type === 'telegram') {
                const link = await storage.getUrl(file.file_id);
                if (link) {
                    const response = await axios({ url: link, method: 'GET', responseType: 'stream' });
                    archive.append(response.data, { name: file.path });
                }
            } else {
                if (fs.existsSync(file.file_id)) {
                    archive.file(file.file_id, { name: file.path });
                }
            }
        }
        await archive.finalize();
    } catch (error) {
        res.status(500).send('壓縮檔案時發生錯誤');
    }
});


app.post('/share', requireLogin, async (req, res) => {
    const { messageId, expiresIn } = req.body;
    const result = await data.createShareLink(parseInt(messageId, 10), expiresIn, req.session.userId);
    if (result.success) {
        const shareUrl = `${req.protocol}://${req.get('host')}/share/view/${result.token}`;
        res.json({ success: true, url: shareUrl });
    } else {
        res.status(500).json(result);
    }
});

app.get('/api/shared-files', requireLogin, async (req, res) => {
    const files = await data.getActiveSharedFiles(req.session.userId);
    const fullUrlFiles = files.map(file => ({
        ...file,
        share_url: `${req.protocol}://${req.get('host')}/share/view/${file.share_token}`
    }));
    res.json(fullUrlFiles);
});

app.post('/api/cancel-share', requireLogin, async (req, res) => {
    const { messageId } = req.body;
    const result = await data.cancelShare(parseInt(messageId, 10), req.session.userId);
    res.json(result);
});

app.get('/share/view/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const fileInfo = await data.getFileByShareToken(token);
        if (fileInfo) {
            const downloadUrl = `/share/download/${token}`;
            let textContent = null;
            if (fileInfo.mimetype && fileInfo.mimetype.startsWith('text/')) {
                const storage = storageManager.getStorage();
                if(fileInfo.storage_type === 'telegram') {
                    const link = await storage.getUrl(fileInfo.file_id);
                    if (link) {
                        const response = await axios.get(link, { responseType: 'text' });
                        textContent = response.data;
                    }
                } else {
                    textContent = await fs.promises.readFile(fileInfo.file_id, 'utf-8');
                }
            }
            res.render('share-view', { file: fileInfo, downloadUrl, textContent });
        } else {
            res.status(404).render('share-error', { message: '此分享連結無效或已過期。' });
        }
    } catch (error) { res.status(500).render('share-error', { message: '處理分享請求時發生錯誤。' }); }
});

app.get('/share/download/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const fileInfo = await data.getFileByShareToken(token);
        if (fileInfo && fileInfo.file_id) {
            const storage = storageManager.getStorage();
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.fileName)}`);
            if (fileInfo.storage_type === 'telegram') {
                const link = await storage.getUrl(fileInfo.file_id);
                if (link) {
                    const response = await axios({ method: 'get', url: link, responseType: 'stream' });
                    response.data.pipe(res);
                } else { res.status(404).send('無法獲取文件鏈接'); }
            } else {
                res.download(fileInfo.file_id, fileInfo.fileName);
            }
        } else { res.status(404).send('文件信息未找到或分享鏈接已過期'); }
    } catch (error) { res.status(500).send('下載失敗'); }
});


app.listen(PORT, () => console.log(`✅ 伺服器已在 http://localhost:${PORT} 上運行`));
