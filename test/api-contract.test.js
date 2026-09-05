// 接口契约：所有 JSON 响应都带 ok，成功 true、失败 false。
// 真起一个服务进程打 HTTP，验的是调用方实际拿到的东西。

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const PORT  = 3897;
const BASE  = `http://127.0.0.1:${PORT}`;
const tmpDb = path.join(os.tmpdir(), `e2e-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

let child, token;

before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: tmpDb, WECHAT_ACCOUNTS: '',
           EXTENSION_API_KEY: 'test-key-abc123' },
    stdio: 'ignore',
  });
  // 等端口起来，最多 20 秒
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${BASE}/`, { signal: AbortSignal.timeout(500) });
      break;
    } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  const r = await (await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })).json();
  token = r.token;
});

after(() => {
  if (child) child.kill();
  try { fs.unlinkSync(tmpDb); } catch (_) {}
  for (const suffix of ['-shm', '-wal']) { try { fs.unlinkSync(tmpDb + suffix); } catch (_) {} }
});

const auth = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token });

async function get(p, headers)        { const r = await fetch(BASE + p, { headers }); return { status: r.status, body: await r.json() }; }
async function post(p, body, headers) { const r = await fetch(BASE + p, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; }

test('登录成功带 ok:true', async () => {
  const { status, body } = await post('/api/login', { username: 'admin', password: 'admin123' }, { 'Content-Type': 'application/json' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(body.token);
});

test('登录失败带 ok:false 和 error', async () => {
  const { status, body } = await post('/api/login', { username: 'admin', password: '错的' }, { 'Content-Type': 'application/json' });
  assert.strictEqual(status, 401);
  assert.strictEqual(body.ok, false, '失败也必须有 ok 字段');
  assert.ok(body.error);
});

test('未登录访问受保护接口，带 ok:false', async () => {
  const { status, body } = await get('/api/index-stats?accountName=x');
  assert.strictEqual(status, 401);
  assert.strictEqual(body.ok, false);
  assert.ok(body.error);
});

test('缺参数带 ok:false', async () => {
  const { status, body } = await post('/api/add-article', { accountName: '测试号' }, auth());
  assert.strictEqual(status, 400);
  assert.strictEqual(body.ok, false);
  assert.match(body.error, /链接/);
});

test('add-article: 链接格式不对时带 ok:false 和可读的原因', async () => {
  const { status, body } = await post('/api/add-article', { accountName: '测试号', url: 'https://example.com/a' }, auth());
  assert.strictEqual(status, 400);
  assert.strictEqual(body.ok, false);
  assert.match(body.error, /公众号文章链接/);
});

test('GET 类接口也补上 ok:true', async () => {
  const { status, body } = await get('/api/index-stats?accountName=测试号', auth());
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  // 原有字段不能因为加了 ok 就消失
  assert.strictEqual(typeof body.published, 'number');
  assert.strictEqual(typeof body.usable, 'number');
});

test('pending-articles 带 ok:true 和 rows', async () => {
  const { status, body } = await get('/api/pending-articles?accountName=测试号', auth());
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(Array.isArray(body.rows));
});

test('import-articles 成功带 ok:true 与统计', async () => {
  const { status, body } = await post('/api/import-articles', {
    accountName: '测试号',
    articles: [{ title: '导入测试文', url: 'https://mp.weixin.qq.com/s?__biz=A==&sn=t1&chksm=c',
                 thumbUrl: 'https://mmbiz/x.jpg', bodyText: '讲 Cursor 的一篇', publishedAt: '2026-01-01' }],
  }, auth());
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.imported, 1);
  assert.strictEqual(body.stats.published, 1);
});

test('import-articles 超过单批上限带 ok:false', async () => {
  const many = Array.from({ length: 201 }, (_, i) => ({ title: 't' + i, url: 'https://mp/x' + i }));
  const { status, body } = await post('/api/import-articles', { accountName: '测试号', articles: many }, auth());
  assert.strictEqual(status, 400);
  assert.strictEqual(body.ok, false);
  assert.match(body.error, /200/);
});

test('sync-articles 账号不存在时带 ok:false', async () => {
  const { status, body } = await post('/api/sync-articles', { accountName: '不存在的号' }, auth());
  assert.ok(status >= 400);
  assert.strictEqual(body.ok, false);
  assert.ok(body.error);
});

test('add-article: 库里已有同一篇时报重复，不静默覆盖', async () => {
  const url = 'https://mp.weixin.qq.com/s?__biz=B==&mid=9&idx=1&sn=dup1&chksm=cc';
  // 先用 import 塞一条，模拟这篇已在库中
  await post('/api/import-articles', {
    accountName: '查重号',
    articles: [{ title: '已存在的文章', url, thumbUrl: 'https://mmbiz/x.jpg', bodyText: 'x', publishedAt: '2026-02-02' }],
  }, auth());

  const { status, body } = await post('/api/add-article', { accountName: '查重号', url }, auth());
  assert.strictEqual(status, 409);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.mode, 'duplicate');
  assert.match(body.error, /已在库中/);
  assert.strictEqual(body.article.title, '已存在的文章', '要告诉调用方撞的是哪一篇');
});

test('add-article: 带跟踪参数的同一篇也认得出重复', async () => {
  const base = 'https://mp.weixin.qq.com/s?__biz=B==&mid=10&idx=1&sn=dup2&chksm=dd';
  await post('/api/import-articles', {
    accountName: '查重号2',
    articles: [{ title: '归一化查重', url: base, thumbUrl: 'https://mmbiz/y.jpg', bodyText: 'y', publishedAt: '2026-03-03' }],
  }, auth());

  const { status, body } = await post('/api/add-article',
    { accountName: '查重号2', url: base + '&scene=126&sessionid=777' }, auth());
  assert.strictEqual(status, 409);
  assert.strictEqual(body.mode, 'duplicate');
});

// ── 给插件用的两个薄路由 ──

test('recommend: 库里没有相关文章时返回空数组，不是错误', async () => {
  const { status, body } = await post('/api/recommend',
    { accountName: '插件号', title: 'Cursor 深度实测', bodyText: '我们用了一个月 Cursor' }, auth());
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(body.candidates, []);
});

test('recommend: 能召回讲同一个对象的历史文章', async () => {
  const acc = '插件召回号';
  await post('/api/import-articles', {
    accountName: acc,
    articles: [
      { title: 'Devin 对决 Cursor', url: 'https://mp.weixin.qq.com/s?__biz=P==&sn=r1&chksm=a',
        thumbUrl: 'https://mmbiz/1.jpg', bodyText: '我们把 Cursor 和 Devin 放一起比', publishedAt: '2024-12-13' },
      { title: '卧底 Cursor 内部 60 天', url: 'https://mp.weixin.qq.com/s?__biz=P==&sn=r2&chksm=b',
        thumbUrl: 'https://mmbiz/2.jpg', bodyText: 'Cursor 团队是怎么工作的', publishedAt: '2025-11-10' },
      { title: '聊聊播客这门生意', url: 'https://mp.weixin.qq.com/s?__biz=P==&sn=r3&chksm=c',
        thumbUrl: 'https://mmbiz/3.jpg', bodyText: '播客的商业模式', publishedAt: '2026-01-01' },
    ],
  }, auth());

  const { body } = await post('/api/recommend',
    { accountName: acc, title: 'Cursor 又更新了', bodyText: '这次我们再看看 Cursor' }, auth());
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.candidates.length, 2, '播客那篇不该进来');
  // 最新的在上面
  assert.strictEqual(body.candidates[0].title, '卧底 Cursor 内部 60 天');
  assert.ok(body.candidates[0].sharedEntities.includes('cursor'), '要带出共同话题给用户看');
  assert.ok(body.candidates[0].thumbUrl, '缩略图要给到，插件面板要显示');
});

test('recommend: 缺标题时带 ok:false', async () => {
  const { status, body } = await post('/api/recommend', { accountName: 'x', bodyText: 'y' }, auth());
  assert.strictEqual(status, 400);
  assert.strictEqual(body.ok, false);
  assert.match(body.error, /标题/);
});

test('recommend-html: 没选任何篇时返回空串，不报错', async () => {
  const { status, body } = await post('/api/recommend-html',
    { accountName: '插件号', selectedIds: [] }, auth());
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.html, '');
  assert.strictEqual(body.count, 0);
});

test('recommend-html: 超过 8 篇带 ok:false', async () => {
  const { status, body } = await post('/api/recommend-html',
    { accountName: 'x', selectedIds: [1,2,3,4,5,6,7,8,9] }, auth());
  assert.strictEqual(status, 400);
  assert.strictEqual(body.ok, false);
});


// ── 插件专用 key ──

const keyHdr = () => ({ 'Content-Type': 'application/json', 'X-Extension-Key': 'test-key-abc123' });

test('插件 key 能调推荐路由，不需要登录', async () => {
  const { status, body } = await post('/api/recommend',
    { accountName: '钥匙号', title: 'Cursor 实测', bodyText: '讲 Cursor' }, keyHdr());
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(Array.isArray(body.candidates));
});

test('插件 key 能拉账号列表（面板要选公众号）', async () => {
  const r = await fetch(BASE + '/api/accounts', { headers: { 'X-Extension-Key': 'test-key-abc123' } });
  const body = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(Array.isArray(body.accounts));
});

test('插件 key 拿不到发布相关的路由', async () => {
  for (const p of ['/api/publish', '/api/add-article', '/api/sync-articles', '/api/import-articles']) {
    const { status, body } = await post(p, {}, keyHdr());
    assert.strictEqual(status, 401, `${p} 不该对插件 key 开放`);
    assert.strictEqual(body.ok, false);
  }
});

test('插件 key 拿不到管理员路由', async () => {
  const r = await fetch(BASE + '/api/users', { headers: { 'X-Extension-Key': 'test-key-abc123' } });
  assert.strictEqual(r.status, 401);
});

test('错误的 key 被拒', async () => {
  const { status, body } = await post('/api/recommend',
    { accountName: 'x', title: 'y' },
    { 'Content-Type': 'application/json', 'X-Extension-Key': 'wrong-key' });
  assert.strictEqual(status, 401);
  assert.strictEqual(body.ok, false);
});
