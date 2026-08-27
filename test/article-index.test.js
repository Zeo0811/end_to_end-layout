const { test, before } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

// db.js 在 require 时就打开数据库，必须先设好路径
const tmpDb = path.join(os.tmpdir(), `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DATABASE_PATH = tmpDb;

const db = require('../db');

before(() => {
  process.on('exit', () => { try { fs.unlinkSync(tmpDb); } catch (_) {} });
});

function seed(overrides = {}) {
  return db.upsertArticle({
    accountName: '十字路口', title: '默认标题', digest: '',
    url: 'https://mp.weixin.qq.com/s/aaa', thumbUrl: 'https://img/a.jpg',
    articleId: '', mediaId: '', sourceUrl: 'https://notion.so/a',
    status: 'published', bodyText: '正文', summaryText: '默认标题 正文',
    publishedAt: '2026-01-01', ...overrides,
  });
}

test('upsertArticle: 插入后能查回来', () => {
  const id = seed({ url: 'https://mp/u1', title: '插入测试' });
  assert.ok(id > 0);
  const rows = db.listPublishedArticles('十字路口');
  assert.ok(rows.some(r => r.id === id && r.title === '插入测试'));
});

test('upsertArticle: 相同 url 更新而不是重复插入', () => {
  const id1 = seed({ url: 'https://mp/dup', title: '旧标题' });
  const id2 = seed({ url: 'https://mp/dup', title: '新标题' });
  assert.strictEqual(id1, id2);
  const row = db.listPublishedArticles('十字路口').find(r => r.id === id1);
  assert.strictEqual(row.title, '新标题');
});

test('upsertArticle: url 为空时按 accountName + mediaId 去重', () => {
  const id1 = db.upsertArticle({ accountName: 'A', title: 'p1', url: '', mediaId: 'm-1', status: 'pending' });
  const id2 = db.upsertArticle({ accountName: 'A', title: 'p2', url: '', mediaId: 'm-1', status: 'pending' });
  assert.strictEqual(id1, id2);
});

test('upsertArticle: 显式 id 时更新该行，即使传入的 url 是新的', () => {
  // 这正是回填 pending 的场景：目标行 url 为空，要写入一个新 url
  const id = db.upsertArticle({ accountName: 'B', title: '待回填', url: '', mediaId: 'm-b', status: 'pending' });
  const same = db.upsertArticle({ id, accountName: 'B', title: '待回填', url: 'https://mp/filled', status: 'published' });
  assert.strictEqual(same, id, '必须更新原行而不是新插一条');
  const rows = db.listPublishedArticles('B');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].url, 'https://mp/filled');
});

test('setArticleEntities / getArticleEntities: 全量替换', () => {
  const id = seed({ url: 'https://mp/ent' });
  db.setArticleEntities(id, { cursor: 3, manus: 1 });
  assert.deepStrictEqual(db.getArticleEntities(id), { cursor: 3, manus: 1 });
  db.setArticleEntities(id, { sora: 2 });
  assert.deepStrictEqual(db.getArticleEntities(id), { sora: 2 });
});

test('listPublishedArticles: 带出 entities，且不含 pending', () => {
  const pub = seed({ url: 'https://mp/pub', title: '已发布', status: 'published' });
  db.setArticleEntities(pub, { cursor: 3 });
  db.upsertArticle({ accountName: '十字路口', title: '草稿中', url: '', mediaId: 'm-pending', status: 'pending' });

  const rows = db.listPublishedArticles('十字路口');
  assert.ok(rows.some(r => r.id === pub));
  assert.ok(!rows.some(r => r.title === '草稿中'));
  assert.deepStrictEqual(rows.find(r => r.id === pub).entities, { cursor: 3 });
});

test('listPublishedArticles: 按账号隔离', () => {
  seed({ accountName: '甲号', url: 'https://mp/jia' });
  const rows = db.listPublishedArticles('乙号');
  assert.ok(!rows.some(r => r.url === 'https://mp/jia'));
});

test('getEntityDocFreq: 统计每个实体出现在多少篇文章里', () => {
  const acc = '统计号';
  const a = db.upsertArticle({ accountName: acc, title: 'a', url: 'https://mp/s1', status: 'published' });
  const b = db.upsertArticle({ accountName: acc, title: 'b', url: 'https://mp/s2', status: 'published' });
  db.setArticleEntities(a, { cursor: 3, ai: 1 });
  db.setArticleEntities(b, { ai: 1 });

  const { docFreq, totalDocs } = db.getEntityDocFreq(acc);
  assert.strictEqual(totalDocs, 2);
  assert.strictEqual(docFreq.ai, 2);
  assert.strictEqual(docFreq.cursor, 1);
});

test('findPendingByTitle: 只找 pending 状态的', () => {
  const acc = '回填号';
  db.upsertArticle({ accountName: acc, title: '待回填', url: '', mediaId: 'm-back', status: 'pending' });
  db.upsertArticle({ accountName: acc, title: '已完成', url: 'https://mp/done', status: 'published' });

  assert.ok(db.findPendingByTitle(acc, '待回填'));
  assert.strictEqual(db.findPendingByTitle(acc, '已完成'), undefined);
});

test('getIndexStats: 返回各状态计数', () => {
  const acc = '统计号2';
  db.upsertArticle({ accountName: acc, title: 'p', url: 'https://mp/x1', status: 'published' });
  db.upsertArticle({ accountName: acc, title: 'q', url: '', mediaId: 'm-q', status: 'pending' });
  const s = db.getIndexStats(acc);
  assert.strictEqual(s.published, 1);
  assert.strictEqual(s.pending, 1);
  assert.strictEqual(s.total, 2);
});

test('setSyncMeta / getSyncMeta: 记录上次同步时间', () => {
  assert.strictEqual(db.getSyncMeta('新号'), null);
  db.setSyncMeta('新号', '2026-08-26T10:00:00Z');
  assert.strictEqual(db.getSyncMeta('新号'), '2026-08-26T10:00:00Z');
});
