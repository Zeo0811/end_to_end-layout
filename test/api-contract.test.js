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
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: tmpDb, WECHAT_ACCOUNTS: '' },
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
