require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');

const data = require('./data.js');
const { sendFile, deleteMessages, getFileLink } = require('./bot.js');

const app = express();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 1000 * 1024 * 1024 } });
const PORT = process.env.PORT || 8100;

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-strong-random-secret-here-please-change',
  resave: false,
  saveUninitialized: false,
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

// --- 主要頁面路由 ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views/login.html')));
app.post('/login', (req, res) => {
  if (req.body.username === process.env.ADMIN_USER && req.body.password === process.env.ADMIN_PASS) {
    req.session.loggedIn = true;
    res.redirect('/');
  } else {
    res.status(401).send('Invalid credentials');
  }
});
app.get('/', requireLogin, (req, res) => res.redirect('/folder/1'));
app.get('/folder/:id', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/manager.html')));
app.get('/shares-page', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/shares.html')));


// --- API 接口 ---
app.post('/api/download-archive', requireLogin, async (req, res) => {
    try {
        const { messageIds = [], folderIds = [] } = req.body;
        if (messageIds.length === 0 && folderIds.length === 0) {
            return res.status(400).send('未提供任何項目 ID');
        }
        let filesToArchive = [];
        if (messageIds.length > 0) {
            const directFiles = await data.getFilesByIds(messageIds);
            filesToArchive.push(...directFiles.map(f => ({ ...f, path: f.fileName })));
        }
        for (const folderId of folderIds) {
            const folderInfo = (await data.getFolderPath(folderId)).pop();
            const folderName = folderInfo ? folderInfo.name : 'folder';
            const nestedFiles = await data.getFilesRecursive(folderId, folderName);
            filesToArchive.push(...nestedFiles);
        }
        if (filesToArchive.length === 0) {
            return res.status(404).send('找不到任何可下載的檔案');
        }
        const archive = archiver('zip', { zlib: { level: 9 } });
        res.attachment('download.zip');
        archive.pipe(res);
        for (const file of filesToArchive) {
            const link = await getFileLink(file.file_id);
            if (link) {
                const response = await axios({ url: link, method: 'GET', responseType: 'stream' });
                archive.append(response.data, { name: file.path });
            }
        }
        await archive.finalize();
    } catch (error) {
        res.status(500).send('壓縮檔案時發生錯誤');
    }
});

app.get('/api/search', requireLogin, async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ success: false, message: '需要提供搜尋關鍵字。' });
        const contents = await data.searchFiles(query);
        const path = [{ id: null, name: `搜尋結果: "${query}"` }];
        res.json({ contents, path });
    } catch (error) { res.status(500).json({ success: false, message: '搜尋失敗。' }); }
});

app.post('/upload', requireLogin, upload.array('files'), fixFileNameEncoding, async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: '沒有選擇文件' });
    }

    const folderId = req.body.folderId ? parseInt(req.body.folderId, 10) : 1;
    const overwriteInfo = req.body.overwrite ? JSON.parse(req.body.overwrite) : [];
    
    if (overwriteInfo.length > 0) {
        const messageIdsToDelete = overwriteInfo.map(f => f.messageId);
        await deleteMessages(messageIdsToDelete);
    }
    
    const results = [];
    for (const file of req.files) {
        const result = await sendFile(file.buffer, file.originalname, file.mimetype, req.body.caption || '', folderId);
        results.push(result);
    }
    res.json({ success: true, results });
});

app.post('/api/check-existence', requireLogin, async (req, res) => {
    try {
        const { fileNames, folderId } = req.body;
        if (!fileNames || !Array.isArray(fileNames) || !folderId) {
            return res.status(400).json({ success: false, message: '無效的請求參數。' });
        }

        const existenceChecks = await Promise.all(
            fileNames.map(async (name) => {
                const existingFile = await data.findFileInFolder(name, folderId);
                return {
                    name,
                    exists: !!existingFile,
                    messageId: existingFile ? existingFile.message_id : null,
                };
            })
        );

        res.json({ success: true, files: existenceChecks });
    } catch (error) {
        res.status(500).json({ success: false, message: '檢查檔案存在時發生錯誤。' });
    }
});

app.post('/api/check-move-conflict', requireLogin, async (req, res) => {
    try {
        const { itemIds, targetFolderId } = req.body;
        if (!itemIds || !Array.isArray(itemIds) || !targetFolderId) {
            return res.status(400).json({ success: false, message: '無效的請求參數。' });
        }

        const filesToMove = await data.getFilesByIds(itemIds);
        const fileNamesToMove = filesToMove.map(f => f.fileName);

        const conflictingFiles = await data.checkNameConflict(fileNamesToMove, targetFolderId);

        res.json({ success: true, conflicts: conflictingFiles });
    } catch (error) {
        res.status(500).json({ success: false, message: '檢查名稱衝突時出錯。' });
    }
});

app.get('/api/folder/:id', requireLogin, async (req, res) => {
    try {
        const folderId = parseInt(req.params.id, 10);
        const contents = await data.getFolderContents(folderId);
        const path = await data.getFolderPath(folderId);
        res.json({ contents, path });
    } catch (error) { res.status(500).json({ success: false, message: '讀取資料夾內容失敗。' }); }
});
app.post('/api/folder', requireLogin, async (req, res) => {
    try {
        const { name, parentId } = req.body;
        if (!name || !parentId) return res.status(400).json({ success: false, message: '缺少資料夾名稱或父 ID。' });
        const result = await data.createFolder(name, parentId);
        res.json(result);
    } catch (error) { res.status(500).json({ success: false, message: error.message || '建立資料夾失敗。' }); }
});
app.get('/api/folders', requireLogin, async (req, res) => {
    try {
        const folders = await data.getAllFolders();
        res.json(folders);
    } catch (error) { res.status(500).json({ success: false, message: '獲取資料夾列表失敗' }); }
});
app.post('/api/move', requireLogin, async (req, res) => {
    try {
        const { itemIds, targetFolderId, overwrite } = req.body;
        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0 || !targetFolderId) {
            return res.status(400).json({ success: false, message: '無效的請求參數。' });
        }
        
        if (overwrite) {
            const filesToMove = await data.getFilesByIds(itemIds);
            const fileNamesToMove = filesToMove.map(f => f.fileName);
            
            const existingFiles = await Promise.all(
                fileNamesToMove.map(name => data.findFileInFolder(name, targetFolderId))
            );
            const messageIdsToDelete = existingFiles.filter(f => f).map(f => f.message_id);

            if (messageIdsToDelete.length > 0) {
                await deleteMessages(messageIdsToDelete);
            }
        }

        await data.moveItems(itemIds, targetFolderId);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: '移動失敗' }); }
});
app.post('/api/folder/delete', requireLogin, async (req, res) => {
    try {
        const { folderId } = req.body;
        if (!folderId || folderId === 1) return res.status(400).json({ success: false, message: '無效的資料夾 ID 或試圖刪除根目錄。' });
        const messageIdsToDelete = await data.deleteFolderRecursive(folderId);
        if (messageIdsToDelete.length > 0) await deleteMessages(messageIdsToDelete);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: '刪除資料夾失敗' }); }
});
app.get('/thumbnail/:message_id', requireLogin, async (req, res) => {
    try {
        const messageId = parseInt(req.params.message_id, 10);
        const [fileInfo] = await data.getFilesByIds([messageId]);
        if (fileInfo && fileInfo.thumb_file_id) {
            const link = await getFileLink(fileInfo.thumb_file_id);
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
        const [fileInfo] = await data.getFilesByIds([messageId]);
        if (fileInfo && fileInfo.file_id) {
            const link = await getFileLink(fileInfo.file_id);
            if (link) {
                res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.fileName)}`);
                const response = await axios({ method: 'get', url: link, responseType: 'stream' });
                response.data.pipe(res);
            } else { res.status(404).send('無法獲取文件鏈接'); }
        } else { res.status(404).send('文件信息未找到'); }
    } catch (error) { res.status(500).send('下載代理失敗'); }
});
app.get('/file/content/:message_id', requireLogin, async (req, res) => {
    try {
        const messageId = parseInt(req.params.message_id, 10);
        const [fileInfo] = await data.getFilesByIds([messageId]);
        if (fileInfo && fileInfo.file_id) {
            const link = await getFileLink(fileInfo.file_id);
            if (link) {
                const response = await axios.get(link, { responseType: 'text' });
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.send(response.data);
            } else { res.status(404).json({ success: false, message: '無法獲取文件鏈接。' }); }
        } else { res.status(404).json({ success: false, message: '文件未找到。' }); }
    } catch (error) { res.status(500).json({ success: false, message: '無法獲取文件內容。' }); }
});
app.post('/rename', requireLogin, async (req, res) => {
    try {
        const { messageId, newFileName } = req.body;
        if (!messageId || !newFileName) return res.status(400).json({ success: false, message: '缺少必要參數。'});
        const result = await data.renameFile(parseInt(messageId, 10), newFileName);
        res.json(result);
    } catch (error) { res.status(500).json({ success: false, message: '重命名失敗' }); }
});
app.post('/delete-multiple', requireLogin, async (req, res) => {
    try {
        const { messageIds } = req.body;
        if (!messageIds || !Array.isArray(messageIds)) return res.status(400).json({ success: false, message: '無效的 messageIds。' });
        const result = await deleteMessages(messageIds);
        res.json(result);
    } catch (error) { res.status(500).json({ success: false, message: '刪除失敗' }); }
});
app.post('/share', requireLogin, async (req, res) => {
    try {
        const { messageId, expiresIn } = req.body;
        if (!messageId || !expiresIn) return res.status(400).json({ success: false, message: '缺少必要参数。' });
        const result = await data.createShareLink(parseInt(messageId, 10), expiresIn);
        if (result.success) {
            const shareUrl = `${req.protocol}://${req.get('host')}/share/view/${result.token}`;
            res.json({ success: true, url: shareUrl });
        } else {
            res.status(500).json(result);
        }
    } catch (error) { res.status(500).json({ success: false, message: '創建分享鏈接失敗' }); }
});
app.get('/api/shared-files', requireLogin, async (req, res) => {
    try {
        const files = await data.getActiveSharedFiles();
        const fullUrlFiles = files.map(file => ({
            ...file,
            share_url: `${req.protocol}://${req.get('host')}/share/view/${file.share_token}`
        }));
        res.json(fullUrlFiles);
    } catch (error) { res.status(500).json({ success: false, message: '獲取分享列表失敗' }); }
});
app.post('/api/cancel-share', requireLogin, async (req, res) => {
    try {
        const { messageId } = req.body;
        if (!messageId) return res.status(400).json({ success: false, message: '缺少 messageId' });
        const result = await data.cancelShare(parseInt(messageId, 10));
        res.json(result);
    } catch (error) { res.status(500).json({ success: false, message: '取消分享失敗' }); }
});
app.get('/share/view/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const fileInfo = await data.getFileByShareToken(token);
        if (fileInfo) {
            const downloadUrl = `/share/download/${token}`;
            let textContent = null;
            if (fileInfo.mimetype && fileInfo.mimetype.startsWith('text/')) {
                const link = await getFileLink(fileInfo.file_id);
                if (link) {
                    const response = await axios.get(link, { responseType: 'text' });
                    textContent = response.data;
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
            const link = await getFileLink(fileInfo.file_id);
            if (link) {
                res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.fileName)}`);
                const response = await axios({ method: 'get', url: link, responseType: 'stream' });
                response.data.pipe(res);
            } else { res.status(404).send('無法獲取文件鏈接'); }
        } else { res.status(404).send('文件信息未找到或分享鏈接已過期'); }
    } catch (error) { res.status(500).send('下載失敗'); }
});

app.listen(PORT, () => console.log(`✅ 服務器運行在 http://localhost:${PORT}`));
