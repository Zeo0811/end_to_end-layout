require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const db      = require('./db');
const crawler = require('./parsers/crawler');
const { formatToWechat } = require('./formatter');
const { createClient }   = require('./wechat-api');

const app  = express();
const PORT = process.env.PORT || 3000;

db.seedAccountsFromEnv();
db.ensureAdmin();

// token → user 映射
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// wechat client 缓存
const clientCache = new Map();

function getWechatClient(accountName) {
  if (clientCache.has(accountName)) return clientCache.get(accountName);
  const account = db.getAccountByName(accountName);
  if (!account) throw new Error(`未找到公众号账号: ${accountName}`);
  const client = createClient(account.app_id, account.app_secret);
  clientCache.set(accountName, client);
  return client;
}

// ── 中间件 ──

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 认证中间件
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = sessions.get(token);
  if (!user) return res.status(401).json({ error: '请先登录' });
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

// ── 登录 ──

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.authenticate(username, password);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  const token = generateToken();
  sessions.set(token, user);
  res.json({ ok: true, token, user: { username: user.username, role: user.role } });
});

app.post('/api/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.user });
});

// ── 用户管理（管理员）──

app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json({ users: db.getUsers() });
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
    db.addUser(username, password, role || 'user');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/users/:username', auth, adminOnly, (req, res) => {
  try {
    db.removeUser(req.params.username);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 账号管理（管理员）──

app.get('/api/accounts', auth, (req, res) => {
  res.json({ accounts: db.getAccounts() });
});

app.post('/api/accounts', auth, adminOnly, (req, res) => {
  try {
    const { name, appId, appSecret } = req.body;
    if (!name || !appId || !appSecret) return res.status(400).json({ error: '所有字段必填' });
    db.addAccount(name, appId, appSecret);
    clientCache.delete(name);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/accounts/:name', auth, adminOnly, (req, res) => {
  try {
    db.removeAccount(req.params.name);
    clientCache.delete(req.params.name);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 发布 ──

app.post('/api/publish', auth, async (req, res) => {
  const { url, accountName, author, digest } = req.body;
  const operator = req.user.username;

  if (!url) return res.status(400).json({ error: '缺少链接' });
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });

  // SSE 实时进度
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sendProgress(step, percent, msg) {
    res.write(`data: ${JSON.stringify({ type: 'progress', step, percent, msg })}\n\n`);
  }

  let title = '';
  try {
    sendProgress(1, 10, '正在打开页面...');
    const parsed = await crawler.crawl(url);
    title = parsed.title || '未命名文章';
    sendProgress(2, 35, `已解析「${title}」${parsed.blocks?.length || 0} 个内容块`);

    sendProgress(3, 45, '正在排版格式化...');
    const html = formatToWechat(parsed);
    sendProgress(3, 55, '排版完成，开始上传...');

    const client = getWechatClient(accountName);
    sendProgress(4, 60, '正在上传图片到微信...');

    const result = await client.publishArticle({
      title,
      author: author || '',
      html,
      digest: digest || '',
    });
    sendProgress(5, 100, '发布成功！');

    db.addLog({ operator, url, title, accountName, mediaId: result.media_id, status: 'success', errorMsg: '' });
    res.write(`data: ${JSON.stringify({ type: 'done', ok: true, title, media_id: result.media_id })}\n\n`);
    res.end();
  } catch (e) {
    console.error('[Publish] 失败:', e.message);
    db.addLog({ operator, url, title, accountName, mediaId: '', status: 'error', errorMsg: e.message });
    res.write(`data: ${JSON.stringify({ type: 'done', ok: false, error: e.message, title })}\n\n`);
    res.end();
  }
});

// ── 删除草稿 ──

app.post('/api/delete-draft', auth, async (req, res) => {
  const { logId, accountName, mediaId } = req.body;
  if (!mediaId || !accountName) return res.status(400).json({ error: '缺少参数' });

  try {
    const client = getWechatClient(accountName);
    await client.deleteDraft(mediaId);
    if (logId) db.updateLogStatus(logId, 'deleted', '');
    res.json({ ok: true });
  } catch (e) {
    console.error('[DeleteDraft] 失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 日志 ──

app.get('/api/logs', auth, (req, res) => {
  const page     = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  res.json(db.getLogs(page, pageSize));
});

// ── 启动 ──

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Accounts: ${db.getAccounts().length} 个公众号已配置`);
});

process.on('SIGTERM', async () => {
  await crawler.closeBrowser();
  process.exit(0);
});
