require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const db      = require('./db');
const crawler = require('./parsers/crawler');
const { formatToWechat, buildRecommendBlock } = require('./formatter');
const { createClient }   = require('./wechat-api');
const { recommend, extractEntities } = require('./recommender');
const articleIndex = require('./article-index');
const mpArticle    = require('./mp-article');
const { renderCards } = require('./card-renderer');

const app  = express();
const PORT = process.env.PORT || 3000;

db.seedAccountsFromEnv();
db.ensureAdmin();

// token → { user, createdAt } 映射
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 小时

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 定期清理过期 session（每小时）
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[Session] 清理 ${cleaned} 个过期 session`);
}, 60 * 60 * 1000);

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

// ── prepare 缓存 ──
// 存 crawl 出来的 parsed，让 publish 阶段不必重爬。
// TTL 短是因为 Notion 图片是签名 URL，约 1 小时过期。
const prepares = new Map();
const PREPARE_TTL = 15 * 60 * 1000;
const PREPARE_MAX = 20;

function putPrepare(data) {
  // 超出上限时淘汰最老的一条
  while (prepares.size >= PREPARE_MAX) {
    const oldest = [...prepares.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) break;
    prepares.delete(oldest[0]);
  }
  const id = crypto.randomBytes(16).toString('hex');
  prepares.set(id, { ...data, createdAt: Date.now() });
  return id;
}

function takePrepare(id) {
  const p = prepares.get(id);
  if (!p) return null;
  if (Date.now() - p.createdAt > PREPARE_TTL) { prepares.delete(id); return null; }
  return p;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of prepares) if (now - p.createdAt > PREPARE_TTL) prepares.delete(id);
}, 5 * 60 * 1000);

// ── 中间件 ──

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 所有 JSON 响应统一带上 ok，按 HTTP 状态码判定。
// 失败时原先只返回 { error }，调用方要分两种形状解析；现在
// 成功一律 ok:true、失败一律 ok:false + error，且以后新加的接口自动生效。
// SSE 走 res.write，不经过这里，它们的 done 事件本来就带 ok。
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && !('ok' in body)) {
      return json({ ok: res.statusCode < 400, ...body });
    }
    return json(body);
  };
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 认证中间件
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: '请先登录' });
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  req.user = { id: session.id, username: session.username, role: session.role };
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
  sessions.set(token, { ...user, createdAt: Date.now() });
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

// ── 发布第一段：爬取 + 排版 + 算候选 ──

function openSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  return {
    progress(step, percent, msg) {
      res.write(`data: ${JSON.stringify({ type: 'progress', step, percent, msg })}\n\n`);
    },
    done(payload) {
      res.write(`data: ${JSON.stringify({ type: 'done', ...payload })}\n\n`);
      res.end();
    },
  };
}

// 把技术性错误翻译为用户能理解的提示
function translatePublishError(msg) {
  if (/Target crashed|target closed|Target closed/i.test(msg)) {
    return '页面内容过大或服务器内存不足，浏览器进程崩溃。建议：1) 检查页面是否已公开 2) 减少文章中的图片数量 3) 稍后重试';
  }
  if (/timeout|超时/i.test(msg))  return '页面加载超时，请检查链接是否可正常访问';
  if (/net::ERR_/i.test(msg))     return '无法访问该链接，请检查网络或链接是否正确';
  return msg;
}

function normalizeNotionUrl(url) {
  const u = (url || '').trim();
  return /^\/[0-9a-f]{32}/.test(u) ? 'https://www.notion.so' + u : u;
}

app.post('/api/prepare', auth, async (req, res) => {
  const url = normalizeNotionUrl(req.body.url);
  const { accountName } = req.body;
  if (!url)         return res.status(400).json({ error: '缺少链接' });
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });

  const sse = openSSE(res);
  try {
    // 索引超过 1 小时没同步就后台补一次，不 await，不拖慢本次准备。
    // 本次用的还是旧索引，下次就是新的。
    const last = db.getSyncMeta(accountName);
    if (!last || Date.now() - new Date(last).getTime() > 60 * 60 * 1000) {
      safeSync(accountName, '发布页触发').catch(() => {});
    }

    sse.progress(1, 15, '正在打开页面...');
    const parsed = await crawler.crawl(url);
    const title  = parsed.title || '未命名文章';
    sse.progress(2, 55, `已解析「${title}」${parsed.blocks?.length || 0} 个内容块`);

    sse.progress(3, 75, '正在查找相关的历史文章...');
    const bodyText = articleIndex.parsedToText(parsed);
    const current = {
      entities:    extractEntities(title, bodyText),
      summaryText: articleIndex.makeSummary(title, bodyText),
      url:         '',
      sourceUrl:   url,
      title,   // 重发旧文时靠标题排掉自己
    };
    const { docFreq, totalDocs } = db.getEntityDocFreq(accountName);
    const candidates = recommend({
      current,
      candidates: db.listPublishedArticles(accountName),
      docFreq, totalDocs, limit: 8,
    });

    const prepareId = putPrepare({ parsed, title, url, accountName });
    sse.progress(4, 100, candidates.length ? `找到 ${candidates.length} 篇相关文章` : '没有找到相关文章');
    sse.done({ ok: true, prepareId, title, candidates });
  } catch (e) {
    console.error('[Prepare] 失败:', e.message);
    sse.done({ ok: false, error: translatePublishError(e.message) });
  }
});

// ── 发布第二段：合图 + 追加 + 上传 + 建草稿 ──

app.post('/api/publish', auth, async (req, res) => {
  let { url, accountName, author, digest, prepareId, selectedIds } = req.body;
  const operator = req.user.username;
  url = normalizeNotionUrl(url);

  const cached = prepareId ? takePrepare(prepareId) : null;
  if (prepareId && !cached) {
    return res.status(410).json({ error: '本次准备结果已过期，请重新开始' });
  }
  if (cached) {
    url         = cached.url;
    accountName = cached.accountName;
  }

  if (!url)         return res.status(400).json({ error: '缺少链接' });
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });

  const sse = openSSE(res);
  let title = '';
  try {
    let parsed;
    if (cached) {
      parsed = cached.parsed;
      title  = cached.title;
      sse.progress(1, 30, `复用已解析的「${title}」`);
    } else {
      sse.progress(1, 10, '正在打开页面...');
      parsed = await crawler.crawl(url);
      title  = parsed.title || '未命名文章';
      sse.progress(2, 35, `已解析「${title}」${parsed.blocks?.length || 0} 个内容块`);
    }

    // 推荐阅读板块。每张卡片合成一张 JPEG —— 微信会改文字链接的结构和样式，
    // 一张图配一个 <a> 是唯一稳的形态。任何一步失败都不阻断发布。
    let appendHtml = '';
    const ids = Array.isArray(selectedIds) ? selectedIds : [];
    if (ids.length > 0) {
      sse.progress(3, 45, `正在合成 ${ids.length} 张推荐卡片...`);
      try {
        const pool   = db.listPublishedArticles(accountName);
        // 按用户勾选的顺序保留，pool 里找不到的（已删除）跳过
        const chosen = ids.map(id => pool.find(a => a.id === id)).filter(Boolean);
        const cards  = await renderCards(chosen.map(a => ({
          title: a.title,
          date:  String(a.publishedAt || '').slice(0, 10).replace(/-/g, '.'),
          coverUrl: a.thumbUrl,
        })).map((x, i) => ({ ...x, url: chosen[i].url })));
        appendHtml = buildRecommendBlock(cards);
        if (cards.length < chosen.length) {
          sse.progress(3, 50, `${chosen.length - cards.length} 篇因封面取不到被跳过`);
        }
      } catch (e) {
        console.error('[Publish] 推荐卡片合成失败，跳过该板块:', e.message);
        sse.progress(3, 50, '推荐卡片合成失败，已跳过');
      }
    }

    sse.progress(4, 55, '正在排版格式化...');
    const html = formatToWechat(parsed, { appendHtml });

    const client = getWechatClient(accountName);
    sse.progress(5, 65, '正在上传图片到微信...');

    const result = await client.publishArticle({ title, author: author || '', html, digest: digest || '' });
    sse.progress(6, 100, '发布成功！');

    // 写入文章库（pending，等群发后由同步任务回填 url）
    try {
      articleIndex.indexFromParsed({ accountName, title, mediaId: result.media_id, sourceUrl: url, parsed });
    } catch (e) {
      console.error('[Publish] 写入文章库失败（不影响发布）:', e.message);
    }

    db.addLog({ operator, url, title, accountName, mediaId: result.media_id, status: 'success', errorMsg: '' });
    sse.done({ ok: true, title, media_id: result.media_id });
  } catch (e) {
    console.error('[Publish] 失败:', e.message);
    db.addLog({ operator, url, title, accountName, mediaId: '', status: 'error', errorMsg: e.message });
    sse.done({ ok: false, error: translatePublishError(e.message), title });
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

// ── 文章库 ──

app.post('/api/sync-articles', auth, async (req, res) => {
  const { accountName } = req.body;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });
  try {
    const client = getWechatClient(accountName);
    const result = await articleIndex.syncAccount(accountName, client);
    res.json({ ok: true, ...result, stats: db.getIndexStats(accountName) });
  } catch (e) {
    console.error('[Sync] 失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 批量导入历史文章。
// 个人主体的公众号无法完成主体认证，「发布能力」接口组永远返回 48001，
// freepublish 拿不到历史；素材接口只覆盖极少一部分。本地存档带永久链接，
// 是这个账号唯一完整的历史来源，靠 scripts/import-archive.js 推上来。
// 按 url 幂等（upsertArticle 内部处理），重复导入不会产生重复行。
app.post('/api/import-articles', auth, (req, res) => {
  const { accountName, articles } = req.body;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });
  if (!Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ error: '没有要导入的文章' });
  }
  if (articles.length > 200) {
    return res.status(400).json({ error: '单批最多 200 篇，请分批导入' });
  }

  let imported = 0, skipped = 0;
  const errors = [];
  for (const a of articles) {
    try {
      if (!a || !a.url || !a.title) { skipped++; continue; }
      const bodyText = String(a.bodyText || '');
      const id = db.upsertArticle({
        accountName,
        title:       String(a.title),
        digest:      String(a.digest || ''),
        url:         String(a.url),
        thumbUrl:    String(a.thumbUrl || ''),
        status:      'published',
        bodyText,
        summaryText: articleIndex.makeSummary(a.title, bodyText),
        publishedAt: String(a.publishedAt || ''),
      });
      db.setArticleEntities(id, extractEntities(a.title, bodyText));
      imported++;
    } catch (e) {
      errors.push(`${String(a?.title || '?').slice(0, 30)}: ${e.message}`);
    }
  }

  console.log(`[Import] ${accountName} 导入 ${imported} 篇，跳过 ${skipped} 篇，失败 ${errors.length} 篇`);
  res.json({
    ok: true, imported, skipped, failed: errors.length,
    errors: errors.slice(0, 5), stats: db.getIndexStats(accountName),
  });
});

// 贴一条已群发的文章链接，自动抓标题/封面/发布时间/正文并入库。
//
// 个人主体的公众号没有「发布能力」接口权限（48001），freepublish 读不到
// 已发布列表，所以增量只能这样补：在微信后台群发后把链接贴回来。
// 命中同标题的 pending 记录就回填（保留 crawler 抽出的高质量正文），
// 否则作为新文章插入。按 url 幂等，重复贴同一条不会产生重复行。
app.post('/api/add-article', auth, async (req, res) => {
  const { accountName, url } = req.body;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });
  if (!url)         return res.status(400).json({ error: '请提供文章链接' });

  try {
    // 先按归一化后的 url 查重，避免同一篇被反复抓取。
    // 早退在 fetch 之前：命中就不用再拉 3.5MB 的页面。
    const canon = mpArticle.canonicalUrl(url);
    if (canon) {
      const dup = db.findArticleByUrl(canon);
      if (dup) {
        return res.status(409).json({
          ok: false, mode: 'duplicate',
          error: `这篇已在库中：「${dup.title}」`,
          article: { id: dup.id, title: dup.title, url: canon, publishedAt: dup.publishedAt, status: dup.status },
          stats: db.getIndexStats(accountName),
        });
      }
    }

    const a = await mpArticle.fetchArticle(url);

    // 抓完再查一次：链接归一化不了（缺 chksm 等）时上面那道没生效，
    // 而 fetchArticle 返回的 url 一定是规范化过的
    const dup2 = db.findArticleByUrl(a.url);
    if (dup2) {
      return res.status(409).json({
        ok: false, mode: 'duplicate',
        error: `这篇已在库中：「${dup2.title}」`,
        article: { id: dup2.id, title: dup2.title, url: a.url, publishedAt: dup2.publishedAt, status: dup2.status },
        stats: db.getIndexStats(accountName),
      });
    }

    const pending = db.findPendingByTitle(accountName, a.title);

    const id = db.upsertArticle({
      id: pending ? pending.id : undefined,   // 回填必须指定行，否则按空 url 查不到会误插
      accountName,
      title:       a.title,
      digest:      a.digest || '',
      url:         a.url,
      thumbUrl:    a.thumbUrl || '',
      sourceUrl:   pending ? pending.source_url : '',
      mediaId:     pending ? pending.media_id  : '',
      status:      'published',
      bodyText:    a.bodyText,
      summaryText: articleIndex.makeSummary(a.title, a.bodyText),
      publishedAt: a.publishedAt || '',
    });

    // 命中 pending 时保留原有实体：那是 crawler 从源文档抽的，比从
    // 微信 HTML 反解的准。没命中才重新抽。
    if (!pending) db.setArticleEntities(id, extractEntities(a.title, a.bodyText));

    console.log(`[AddArticle] ${accountName} ${pending ? '回填' : '新增'}「${a.title}」`);
    res.json({
      ok: true,
      mode: pending ? 'backfilled' : 'added',
      article: { id, title: a.title, url: a.url, thumbUrl: a.thumbUrl, publishedAt: a.publishedAt },
      stats: db.getIndexStats(accountName),
    });
  } catch (e) {
    console.error('[AddArticle] 失败:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// 待回填列表：经 zeooo.cc 发过草稿、但还没拿到永久链接的文章
app.get('/api/pending-articles', auth, (req, res) => {
  const accountName = req.query.accountName;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });
  res.json({ rows: db.listPendingArticles(accountName) });
});

// ── 给 Chrome 插件用的两个薄路由 ──
//
// 插件的正文是它自己在 Notion/飞书 页面上解析好的，没有 crawl 阶段，
// 所以复用不了 /api/prepare（那条会去爬页面，慢且可能因登录态拿不到内容）。
// 也不能用 /api/publish —— 那条最后会建微信草稿，插件只是要一段 HTML。

// 算推荐候选。纯计算，不碰浏览器，毫秒级。
app.post('/api/recommend', auth, (req, res) => {
  const { accountName, title, bodyText } = req.body;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });
  if (!title)       return res.status(400).json({ error: '缺少文章标题' });

  try {
    const body = String(bodyText || '');
    const current = {
      title,
      entities:    extractEntities(title, body),
      summaryText: articleIndex.makeSummary(title, body),
      url:         '',
      sourceUrl:   String(req.body.sourceUrl || ''),
    };
    const { docFreq, totalDocs } = db.getEntityDocFreq(accountName);
    const candidates = recommend({
      current,
      candidates: db.listPublishedArticles(accountName),
      docFreq, totalDocs, limit: 8,
    });
    res.json({ candidates });
  } catch (e) {
    console.error('[Recommend] 失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 合成卡片并返回可直接拼到正文末尾的 HTML。
// 插件不用懂排版，以后改样式也不用动插件。
// 会下载封面 + 无头浏览器截图，每张卡片一两秒。
app.post('/api/recommend-html', auth, async (req, res) => {
  const { accountName, selectedIds } = req.body;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  if (ids.length === 0) return res.json({ html: '', count: 0 });
  if (ids.length > 8)   return res.status(400).json({ error: '最多 8 篇' });

  try {
    const pool   = db.listPublishedArticles(accountName);
    // 按传入顺序保留，pool 里找不到的（已删除）跳过
    const chosen = ids.map(id => pool.find(a => a.id === id)).filter(Boolean);
    const cards  = await renderCards(chosen.map(a => ({
      title: a.title,
      url:   a.url,
      date:  String(a.publishedAt || '').slice(0, 10).replace(/-/g, '.'),
      coverUrl: a.thumbUrl,
    })));
    res.json({
      html: buildRecommendBlock(cards),
      count: cards.length,
      skipped: chosen.length - cards.length,   // 封面取不到的
    });
  } catch (e) {
    console.error('[RecommendHtml] 失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 取回草稿正文。排查微信剥掉了哪些样式时用：
// 把我们发过去的 HTML 和这里返回的一 diff 就知道了。
app.post('/api/draft-html', auth, async (req, res) => {
  const { accountName, mediaId } = req.body;
  if (!accountName || !mediaId) return res.status(400).json({ error: '缺少 accountName 或 mediaId' });
  try {
    const client = getWechatClient(accountName);
    const data   = await client.getDraft(mediaId);
    const item   = (data.news_item || [])[0] || {};
    res.json({ title: item.title || '', content: item.content || '' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 接口权限诊断：把微信那边的真实情况打出来，避免靠猜。
app.post('/api/probe-wechat', auth, async (req, res) => {
  const { accountName } = req.body;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });

  const out = {};
  let client;
  try {
    client = getWechatClient(accountName);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const probe = async (key, fn) => {
    try { out[key] = { ok: true, data: await fn() }; }
    catch (e) { out[key] = { ok: false, error: e.message }; }
  };

  await probe('发布能力',   () => client.getFreePublishList(0, 20).then(d => ({
    total_count: d.total_count, item_count: d.item_count, 本页条数: (d.item || []).length,
  })));
  await probe('素材数量',   () => client.getMaterialCount());
  await probe('素材图文首页', () => client.getMaterialNewsList(0, 20).then(d => ({
    total_count: d.total_count, item_count: d.item_count, 本页条数: (d.item || []).length,
  })));
  await probe('素材图文次页', () => client.getMaterialNewsList(20, 20).then(d => ({
    total_count: d.total_count, item_count: d.item_count, 本页条数: (d.item || []).length,
  })));

  res.json({ ok: true, accountName, probe: out });
});

app.get('/api/index-stats', auth, (req, res) => {
  const accountName = req.query.accountName;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });
  res.json(db.getIndexStats(accountName));
});

app.get('/api/logs', auth, (req, res) => {
  const page     = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  res.json(db.getLogs(page, pageSize));
});

// ── 启动 ──

// 同步一个账号，失败只记日志不抛，避免打挂启动流程
async function safeSync(accountName, reason) {
  try {
    const client = getWechatClient(accountName);
    await articleIndex.syncAccount(accountName, client);
  } catch (e) {
    console.error(`[Sync] ${accountName} ${reason} 同步失败:`, e.message);
  }
}

async function syncAllAccounts(reason, onlyIfEmpty = false) {
  for (const acc of db.getAccounts()) {
    if (onlyIfEmpty && db.getIndexStats(acc.name).published > 0) continue;
    await safeSync(acc.name, reason);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Accounts: ${db.getAccounts().length} 个公众号已配置`);
  // 索引为空时全量重建。Railway 若未挂 Volume，这一步会自动补回文章库。
  syncAllAccounts('启动', true);
});

// 每 6 小时增量同步
setInterval(() => syncAllAccounts('定时'), 6 * 60 * 60 * 1000);

process.on('SIGTERM', async () => {
  await crawler.closeBrowser();
  process.exit(0);
});
