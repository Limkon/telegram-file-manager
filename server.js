require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const axios = require('axios');

// 引用新的模組
const db = require('./database.js'); 
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

// --- 路由 ---
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

// --- API 接口 ---
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

app.get('/files', requireLogin, async (req, res) => {
    try {
        const files = await data.getAllFiles();
        res.json(files);
    } catch (error) {
        res.status(500).json({ success: false, message: '讀取文件列表失敗。' });
    }
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

    } catch (error) {
        res.status(500).send('獲取縮圖失敗');
    }
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
    } catch (error) {
        res.status(500).send('下載代理失敗');
    }
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
    } catch (error) {
        res.status(500).json({ success: false, message: '無法獲取文件內容。' });
    }
});

app.post('/rename', requireLogin, async (req, res) => {
    try {
        const { messageId, newFileName } = req.body;
        if (!messageId || !newFileName) return res.status(400).json({ success: false, message: '缺少必要參數。'});
        const result = await data.renameFile(parseInt(messageId, 10), newFileName);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: '重命名失敗' });
    }
});

app.post('/delete-multiple', requireLogin, async (req, res) => {
    try {
        const { messageIds } = req.body;
        if (!messageIds || !Array.isArray(messageIds)) return res.status(400).json({ success: false, message: '無效的 messageIds。' });
        const result = await deleteMessages(messageIds); // This function now also handles DB deletion
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: '刪除失敗' });
    }
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
    } catch (error) {
        res.status(500).json({ success: false, message: '創建分享鏈接失敗' });
    }
});

// --- 公共分享路由 (无需登录) ---
app.get('/share/view/:token', async (req, res) => {
    try {
        const token = req.params.token;
        const fileInfo = await data.getFileByShareToken(token);
        if (fileInfo) {
            res.render('share-view', { file: fileInfo, downloadUrl: `/share/download/${token}` });
        } else {
            res.status(404).send('<h1>404 Not Found</h1><p>此分享鏈接無效或已過期。</p>');
        }
    } catch (error) {
        res.status(500).send('<h1>伺服器錯誤</h1><p>處理分享請求時發生錯誤。</p>');
    }
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
    } catch (error) {
        res.status(500).send('下載失敗');
    }
});


app.listen(PORT, () => console.log(`✅ 服務器運行在 http://localhost:${PORT}`));
