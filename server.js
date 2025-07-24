// telegram-file-manager-df63cbcbc7a99b98d3f81cc263302592a9f7d5ed/server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const { sendFile, loadMessages, getFileLink, renameFileInDb, deleteMessages, createShareLink, getSharedFile } = require('./bot.js');

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
            const originalNameBuffer = Buffer.from(file.originalname, 'latin1');
            file.originalname = originalNameBuffer.toString('utf8');
        });
    }
    next();
};

function requireLogin(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/login');
}

// --- 管理员路由 ---
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views/login.html')));
app.post('/login', (req, res) => {
  if (req.body.username === process.env.ADMIN_USER && req.body.password === process.env.ADMIN_PASS) {
    req.session.loggedIn = true;
    res.redirect('/');
  } else {
    res.status(401).send('Invalid credentials');
  }
});
app.get('/', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/manager.html')));
app.get('/upload-page', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views/dashboard.html')));

// --- API 接口 (需要登录) ---
app.post('/upload', requireLogin, upload.array('files'), fixFileNameEncoding, async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: '沒有選擇文件' });
    }
    const results = [];
    for (const file of req.files) {
        const result = await sendFile(file.buffer, file.originalname, file.mimetype, req.body.caption || '');
        results.push(result);
    }
    res.json({ success: true, results });
});

app.get('/files', requireLogin, (req, res) => res.json(loadMessages()));

app.get('/thumbnail/:message_id', requireLogin, async (req, res) => {
    const messageId = parseInt(req.params.message_id, 10);
    const messages = loadMessages();
    const fileInfo = messages.find(m => m.message_id === messageId);

    if (fileInfo && fileInfo.thumb_file_id) {
        const link = await getFileLink(fileInfo.thumb_file_id);
        if (link) {
            return res.redirect(link);
        }
    }
    const placeholder = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': placeholder.length });
    res.end(placeholder);
});

app.get('/download/proxy/:message_id', requireLogin, async (req, res) => {
    const messageId = parseInt(req.params.message_id, 10);
    const messages = loadMessages();
    const fileInfo = messages.find(m => m.message_id === messageId);
    if (fileInfo && fileInfo.file_id) {
        const link = await getFileLink(fileInfo.file_id);
        if (link) {
            try {
                res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.fileName)}`);
                const response = await axios({ method: 'get', url: link, responseType: 'stream' });
                response.data.pipe(res);
            } catch (error) { res.status(500).send('從 Telegram 獲取文件失敗'); }
        } else { res.status(404).send('無法獲取文件鏈接'); }
    } else { res.status(404).send('文件信息未找到'); }
});

app.get('/file/content/:message_id', requireLogin, async (req, res) => {
    const messageId = parseInt(req.params.message_id, 10);
    const messages = loadMessages();
    const fileInfo = messages.find(m => m.message_id === messageId);
    if (fileInfo && fileInfo.file_id) {
        const link = await getFileLink(fileInfo.file_id);
        if (link) {
            try {
                const response = await axios.get(link, { responseType: 'text' });
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.send(response.data);
            } catch (error) { res.status(500).json({ success: false, message: '無法獲取文件內容。' }); }
        } else { res.status(404).json({ success: false, message: '無法獲取文件鏈接。' }); }
    } else { res.status(404).json({ success: false, message: '文件未找到。' }); }
});

app.post('/rename', requireLogin, async (req, res) => {
    const { messageId, newFileName } = req.body;
    if (!messageId || !newFileName) return res.status(400).json({ success: false, message: '缺少必要參數。'});
    const result = await renameFileInDb(parseInt(messageId, 10), newFileName);
    res.json(result);
});

app.post('/delete-multiple', requireLogin, async (req, res) => {
    const { messageIds } = req.body;
    if (!messageIds || !Array.isArray(messageIds)) return res.status(400).json({ success: false, message: '無效的 messageIds。' });
    const result = await deleteMessages(messageIds);
    res.json(result);
});

// --- 分享 API (需要登录) ---
app.post('/share', requireLogin, async (req, res) => {
    const { messageId, expiresIn } = req.body;
    if (!messageId || !expiresIn) {
        return res.status(400).json({ success: false, message: '缺少必要参数。' });
    }
    const result = await createShareLink(parseInt(messageId, 10), expiresIn);
    if (result.success) {
        const shareUrl = `${req.protocol}://${req.get('host')}/share/view/${result.token}`;
        res.json({ success: true, url: shareUrl });
    } else {
        res.status(500).json(result);
    }
});


// --- 公共分享路由 (无需登录) ---

// 分享文件查看页面
app.get('/share/view/:token', async (req, res) => {
    const token = req.params.token;
    const fileInfo = await getSharedFile(token);
    if (fileInfo) {
        res.render('share-view', { file: fileInfo, downloadUrl: `/share/download/${token}` });
    } else {
        res.status(404).send('<h1>404 Not Found</h1><p>此分享鏈接無效或已過期。</p>');
    }
});

// 分享文件下载路由
app.get('/share/download/:token', async (req, res) => {
    const token = req.params.token;
    const fileInfo = await getSharedFile(token);
    if (fileInfo && fileInfo.file_id) {
        const link = await getFileLink(fileInfo.file_id);
        if (link) {
            try {
                res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.fileName)}`);
                const response = await axios({ method: 'get', url: link, responseType: 'stream' });
                response.data.pipe(res);
            } catch (error) {
                res.status(500).send('從 Telegram 獲取文件失敗');
            }
        } else {
            res.status(404).send('無法獲取文件鏈接');
        }
    } else {
        res.status(404).send('文件信息未找到或分享鏈接已過期');
    }
});


app.listen(PORT, () => console.log(`✅ 服務器運行在 http://localhost:${PORT}`));
