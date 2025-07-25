require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const bcrypt = require('bcrypt');
const fs = require('fs');

const data = require('./data.js');
const storageManager = require('./storage'); // 使用新的儲存管理器

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

app.get('/', requireLogin, (req, res) => res.redirect('/folder/1'));
app.get('/folder/:id', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/manager.html')));
app.get('/shares-page', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/shares.html')));

// --- 管理員頁面 ---
app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views/admin.html'));
});

// --- API 接口 ---
app.get('/api/admin/storage-mode', requireAdmin, (req, res) => {
    res.json({ mode: storageManager.readConfig().storageMode });
});

app.post('/api/admin/storage-mode', requireAdmin, (req, res) => {
    const { mode } = req.body;
    if (storageManager.setStorageMode(mode)) {
        res.json({ success: true, message: '設定已儲存，請重啟伺服器使設定生效。' });
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
        await storage.remove(filesToDelete, userId);
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
    // ... (此路由邏輯不變) ...
});

app.post('/api/check-move-conflict', requireLogin, async (req, res) => {
    const { itemIds, targetFolderId } = req.body;
    const userId = req.session.userId;
    // ... (此路由邏輯不變，但 data.js 中對應的函式已修改) ...
});

// ... (修改所有 API 路由以傳入 userId) ...

app.listen(PORT, () => console.log(`✅ 伺服器運行在 http://localhost:${PORT}`));
