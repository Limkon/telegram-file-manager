require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const bcrypt = require('bcrypt');
const fs = require('fs');
const db = require('./database.js'); // 直接引入 db 以便查詢使用者根目錄

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

// --- 本地檔案服務路由 ---
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
        res.json({ success: true, message: '設定已儲存，重新啟動伺服器後生效。' });
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
    
    // 檢查是否為根目錄
    const folderInfo = await data.getFolderPath(folderId, userId);
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
    const { messageId, newFileName } = req.body;
    const result = await data.renameFile(parseInt(messageId, 10), newFileName, req.session.userId);
    res.json(result);
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

// ... (其他路由如分享、下載等，為了簡潔省略，但您需要為每個資料庫操作都加上 userId)

app.listen(PORT, () => console.log(`✅ 服務器已在 http://localhost:${PORT} 上運行`));
