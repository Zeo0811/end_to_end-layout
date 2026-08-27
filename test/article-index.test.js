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

// ── Task 3: 同步与回填 ──

const idx = require('../article-index');

test('htmlToText: 去标签、合并空白', () => {
  const t = idx.htmlToText('<p>你好</p><p>世界</p><script>var a=1</script>');
  assert.ok(t.includes('你好'));
  assert.ok(t.includes('世界'));
  assert.ok(!t.includes('var a=1'), 'script 内容应被剥掉');
  assert.ok(!t.includes('<'), '不应残留标签');
});

test('pickThumbUrl: 优先用 thumb_url', () => {
  assert.strictEqual(idx.pickThumbUrl({ thumb_url: 'https://img/a.jpg', content: '' }), 'https://img/a.jpg');
});

test('pickThumbUrl: 没有 thumb_url 时从正文抠第一张图', () => {
  const item = { thumb_url: '', content: '<p>x</p><img src="https://img/first.jpg"><img src="https://img/second.jpg">' };
  assert.strictEqual(idx.pickThumbUrl(item), 'https://img/first.jpg');
});

test('pickThumbUrl: 都没有时返回空串', () => {
  assert.strictEqual(idx.pickThumbUrl({ thumb_url: '', content: '<p>无图</p>' }), '');
});

test('makeSummary: 截到 800 字以内且包含标题', () => {
  const s = idx.makeSummary('标题', '正文'.repeat(1000));
  assert.ok(s.startsWith('标题'));
  assert.ok(s.length <= 810, `实际长度 ${s.length}`);
});

test('parsedToText: 拼接文本类 block 的 content', () => {
  const parsed = { title: 'T', blocks: [
    { type: 'h1', content: '大标题' },
    { type: 'paragraph', content: '一段话' },
    { type: 'image', url: 'https://x/a.png' },
    { type: 'paragraph', content: '又一段' },
  ] };
  const t = idx.parsedToText(parsed);
  assert.ok(t.includes('大标题') && t.includes('一段话') && t.includes('又一段'));
  assert.ok(!t.includes('https://x/a.png'), '图片 URL 不应进正文');
});

test('indexFromParsed: 写入 pending 并存好实体', () => {
  const id = idx.indexFromParsed({
    accountName: '同步号', title: 'Cursor 深度实测', mediaId: 'media-abc',
    sourceUrl: 'https://notion.so/x',
    parsed: { title: 'Cursor 深度实测', blocks: [{ type: 'paragraph', content: '我们把 Cursor 用了一个月' }] },
  });
  assert.ok(id > 0);
  assert.strictEqual(db.getArticleEntities(id).cursor, 3);
  assert.ok(db.findPendingByTitle('同步号', 'Cursor 深度实测'));
});

test('indexFromWechatItem: 命中 pending 时回填 url 并转 published', () => {
  const acc = '回填号2';
  // parsed 里有 Devin，微信那份 HTML 里没有。回填后 Devin 还在，
  // 才能证明保留的是 crawler 抽的实体，而不是从微信 HTML 重抽了一遍。
  const pendingId = idx.indexFromParsed({
    accountName: acc, title: '回填测试文', mediaId: 'media-back',
    sourceUrl: 'https://notion.so/back',
    parsed: { title: '回填测试文', blocks: [
      { type: 'paragraph', content: 'Manus 很有意思' },
      { type: 'paragraph', content: '顺便也试了 Devin' },
    ] },
  });
  assert.strictEqual(db.getArticleEntities(pendingId).devin, 1, '前置条件：Devin 已被 crawler 抽到');

  const sameId = idx.indexFromWechatItem(acc, {
    title: '回填测试文', digest: '摘要', content: '<p>Manus 很有意思</p>',
    url: 'https://mp.weixin.qq.com/s/back', thumb_url: 'https://img/back.jpg',
  }, 'art-1', 1756000000);

  assert.strictEqual(sameId, pendingId, '应更新同一行而不是新插入');
  const row = db.listPublishedArticles(acc).find(r => r.id === pendingId);
  assert.ok(row, 'pending 应已转为 published');
  assert.strictEqual(row.url, 'https://mp.weixin.qq.com/s/back');
  assert.strictEqual(row.thumbUrl, 'https://img/back.jpg');
  // Manus 在正文首段，权重 2（标题 3 / 首段 2 / 其余 1）
  assert.strictEqual(db.getArticleEntities(pendingId).manus, 2);
  // 关键：微信那份 content 里没有 Devin，它还在就说明实体没被重抽覆盖
  assert.strictEqual(db.getArticleEntities(pendingId).devin, 1, 'crawler 抽出的实体必须保留');
});

test('indexFromWechatItem: 没有 pending 时作为新文章插入', () => {
  const acc = '直发号';
  const id = idx.indexFromWechatItem(acc, {
    title: '后台直接写的文章', digest: '', content: '<p>聊聊 Sora 的进展</p>',
    url: 'https://mp.weixin.qq.com/s/direct', thumb_url: 'https://img/d.jpg',
  }, 'art-2', 1756000000);
  assert.ok(id > 0);
  // Sora 在反解出的正文首段，权重 2
  assert.strictEqual(db.getArticleEntities(id).sora, 2);
});

test('syncAccount: 分页拉取并全部入库', async () => {
  const acc = '分页号';
  // 造 25 条，验证翻页（每页 20）
  const all = Array.from({ length: 25 }, (_, i) => ({
    article_id: `a-${i}`, update_time: 1756000000 + i,
    content: { news_item: [{
      title: `分页文章 ${i}`, digest: '', content: `<p>讲 Widget${i} 这个产品</p>`,
      url: `https://mp.weixin.qq.com/s/page-${i}`, thumb_url: `https://img/${i}.jpg`,
    }] },
  }));

  const fakeClient = {
    async getFreePublishList(offset, count) {
      return { item: all.slice(offset, offset + count), total_count: all.length, item_count: Math.min(count, all.length - offset) };
    },
  };

  const result = await idx.syncAccount(acc, fakeClient);
  assert.strictEqual(result.total, 25);
  assert.strictEqual(db.listPublishedArticles(acc).length, 25);
  assert.ok(db.getSyncMeta(acc), '应记录同步时间');
});

test('syncAccount: 重复同步不产生重复行', async () => {
  const acc = '幂等号';
  const one = [{
    article_id: 'a-1', update_time: 1756000000,
    content: { news_item: [{ title: '唯一文章', digest: '', content: '<p>x</p>', url: 'https://mp.weixin.qq.com/s/only', thumb_url: '' }] },
  }];
  const fakeClient = { async getFreePublishList(offset, count) { return { item: one.slice(offset, offset + count), total_count: 1, item_count: offset === 0 ? 1 : 0 }; } };

  await idx.syncAccount(acc, fakeClient);
  await idx.syncAccount(acc, fakeClient);
  assert.strictEqual(db.listPublishedArticles(acc).length, 1);
});

test('syncAccount: 没有发布能力权限时自动降级到永久素材接口', async () => {
  const acc = '降级号';
  const material = [{
    media_id: 'mid-1', update_time: 1756000000,
    content: { news_item: [{
      title: '素材接口拉到的文章', digest: '', 
      content: '<p>讲 Widget 这个产品</p><img src="https://img/inline.jpg">',
      url: 'https://mp.weixin.qq.com/s/mat-1',
    }] },
  }];

  let freeCalls = 0, matCalls = 0;
  const fakeClient = {
    async getFreePublishList() { freeCalls++; throw new Error('拉取已发布文章失败: [48001] api unauthorized'); },
    async getMaterialNewsList(offset, count) {
      matCalls++;
      return { item: material.slice(offset, offset + count), total_count: 1, item_count: offset === 0 ? 1 : 0 };
    },
  };

  const result = await idx.syncAccount(acc, fakeClient);
  assert.strictEqual(result.source, 'material', '应报告实际使用的来源');
  assert.ok(freeCalls >= 1 && matCalls >= 1);

  const rows = db.listPublishedArticles(acc);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].url, 'https://mp.weixin.qq.com/s/mat-1');
  // 素材接口不给 thumb_url，封面必须由正文第一张图兜底
  assert.strictEqual(rows[0].thumbUrl, 'https://img/inline.jpg');
});

test('syncAccount: 两个接口都无权限时给出可操作的错误', async () => {
  const fakeClient = {
    async getFreePublishList() { throw new Error('拉取已发布文章失败: [48001] api unauthorized'); },
    async getMaterialNewsList() { throw new Error('拉取永久素材图文失败: [48001] api unauthorized'); },
  };
  await assert.rejects(
    () => idx.syncAccount('无权号', fakeClient),
    e => /接口权限/.test(e.message) && /发布能力/.test(e.message) && /素材管理/.test(e.message),
  );
});

test('syncAccount: 非权限类错误照常抛出，不误降级', async () => {
  const fakeClient = {
    async getFreePublishList() { throw new Error('拉取已发布文章失败: [40001] invalid credential'); },
    async getMaterialNewsList() { throw new Error('不该走到这里'); },
  };
  await assert.rejects(() => idx.syncAccount('凭证错号', fakeClient), /40001/);
});

test('getIndexStats: usable 只数「已发布 + 有链接 + 有封面」的', () => {
  const acc = '可用性号';
  db.upsertArticle({ accountName: acc, title: '齐全', url: 'https://mp/ok', thumbUrl: 'https://img/a.jpg', status: 'published' });
  db.upsertArticle({ accountName: acc, title: '缺封面', url: 'https://mp/nocover', thumbUrl: '', status: 'published' });
  db.upsertArticle({ accountName: acc, title: '缺链接', url: '', mediaId: 'm-nolink', thumbUrl: 'https://img/b.jpg', status: 'published' });
  const s = db.getIndexStats(acc);
  assert.strictEqual(s.published, 3);
  assert.strictEqual(s.usable, 1, '只有三者齐全的那篇能进推荐池');
});

test('syncAccount: total_count 缺失时仍能翻完所有页（曾卡在正好 20 篇）', async () => {
  const acc = '翻页回归号';
  const all = Array.from({ length: 47 }, (_, i) => ({
    media_id: `m-${i}`, update_time: 1756000000 + i,
    content: { news_item: [{
      title: `翻页文 ${i}`, digest: '', content: `<p>讲 Gadget${i}</p>`,
      url: `https://mp.weixin.qq.com/s/pg-${i}`,
    }] },
  }));
  // 关键：服务端不返回 total_count。旧实现会退化成「本页数量」，第一页就 break。
  const fakeClient = {
    async getFreePublishList() { throw new Error('[48001] api unauthorized'); },
    async getMaterialNewsList(offset, count) {
      return { item: all.slice(offset, offset + count) };
    },
  };
  const r = await idx.syncAccount(acc, fakeClient);
  assert.strictEqual(r.total, 47, `应取满 47 篇，实际 ${r.total}`);
  assert.strictEqual(r.pages, 3, '20 + 20 + 7 共三页');
  assert.strictEqual(db.listPublishedArticles(acc).length, 47);
});

test('syncAccount: total_count 为 0 时也不提前终止', async () => {
  const acc = '零总数号';
  const all = Array.from({ length: 25 }, (_, i) => ({
    media_id: `z-${i}`, update_time: 1756000000 + i,
    content: { news_item: [{ title: `零总数文 ${i}`, digest: '', content: '<p>x</p>', url: `https://mp.weixin.qq.com/s/z-${i}` }] },
  }));
  const fakeClient = {
    async getFreePublishList() { throw new Error('[48001] api unauthorized'); },
    async getMaterialNewsList(offset, count) {
      return { item: all.slice(offset, offset + count), total_count: 0 };
    },
  };
  const r = await idx.syncAccount(acc, fakeClient);
  assert.strictEqual(r.total, 25);
});

test('syncAccount: 多图文里的每一篇都入库，不只头条', async () => {
  const acc = '多图文号';
  const one = [{
    media_id: 'multi-1', update_time: 1756000000,
    content: { news_item: [
      { title: '头条：聊聊 Cursor',  digest: '', content: '<p>头条正文</p>', url: 'https://mp.weixin.qq.com/s/mt-1' },
      { title: '次条：聊聊 Manus',  digest: '', content: '<p>次条正文</p>', url: 'https://mp.weixin.qq.com/s/mt-2' },
      { title: '三条：聊聊 Devin',  digest: '', content: '<p>三条正文</p>', url: 'https://mp.weixin.qq.com/s/mt-3' },
    ] },
  }];
  const fakeClient = {
    async getFreePublishList() { throw new Error('[48001] api unauthorized'); },
    async getMaterialNewsList(offset, count) { return { item: one.slice(offset, offset + count) }; },
  };
  const r = await idx.syncAccount(acc, fakeClient);
  assert.strictEqual(r.total, 3, '一条多图文素材应产出 3 篇文章');
  const titles = db.listPublishedArticles(acc).map(x => x.title).sort();
  assert.deepStrictEqual(titles, ['三条：聊聊 Devin', '头条：聊聊 Cursor', '次条：聊聊 Manus'].sort());
});
