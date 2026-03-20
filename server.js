const express = require('express');
const path    = require('path');
const db      = require('./db');
const crawler = require('./parsers/crawler');
const { formatToWechat } = require('./formatter');
const { createClient }   = require('./wechat-api');

const app  = express();
const PORT = process.env.PORT || 3000;

// 从环境变量种子账号
db.seedAccountsFromEnv();

// 缓存 wechat client 实例（按账号名）
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
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 账号管理 ──

app.get('/api/accounts', (req, res) => {
  res.json({ accounts: db.getAccounts() });
});

app.post('/api/accounts', (req, res) => {
  try {
    const { name, appId, appSecret } = req.body;
    if (!name || !appId || !appSecret) {
      return res.status(400).json({ error: '缺少必要字段' });
    }
    db.addAccount(name, appId, appSecret);
    clientCache.delete(name); // 清缓存
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/accounts/:name', (req, res) => {
  try {
    db.removeAccount(req.params.name);
    clientCache.delete(req.params.name);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 核心：爬取 + 排版 + 发布 ──

app.post('/api/publish', async (req, res) => {
  const { url, accountName, operator, author, digest } = req.body;

  if (!url) return res.status(400).json({ error: '缺少链接' });
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });

  let title = '';
  try {
    // 1. Playwright 爬取
    console.log(`[Publish] 开始爬取: ${url}`);
    const parsed = await crawler.crawl(url);
    title = parsed.title || '未命名文章';

    // 2. 格式化为公众号 HTML
    console.log(`[Publish] 格式化: ${title}`);
    const html = formatToWechat(parsed);

    // 3. 发布到公众号草稿箱
    console.log(`[Publish] 发布到: ${accountName}`);
    const client = getWechatClient(accountName);
    const result = await client.publishArticle({
      title,
      author: author || '',
      html,
      digest: digest || '',
    });

    // 4. 记录日志
    db.addLog({
      operator,
      url,
      title,
      accountName,
      status: 'success',
      errorMsg: '',
    });

    res.json({ ok: true, title, media_id: result.media_id });
  } catch (e) {
    console.error('[Publish] 失败:', e.message);
    db.addLog({
      operator,
      url,
      title,
      accountName,
      status: 'error',
      errorMsg: e.message,
    });
    res.status(500).json({ error: e.message, title });
  }
});

// ── 仅爬取预览（不发布）──

app.post('/api/preview', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: '缺少链接' });

  try {
    const parsed = await crawler.crawl(url);
    const html = formatToWechat(parsed);
    res.json({ ok: true, title: parsed.title, html, blockCount: parsed.blocks?.length || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 日志 ──

app.get('/api/logs', (req, res) => {
  const page     = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  res.json(db.getLogs(page, pageSize));
});

// ── 启动 ──

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Accounts: ${db.getAccounts().length} 个公众号已配置`);
});

// 优雅退出
process.on('SIGTERM', async () => {
  await crawler.closeBrowser();
  process.exit(0);
});
