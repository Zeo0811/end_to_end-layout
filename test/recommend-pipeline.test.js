// 集成测试：把 recommender → db → card-renderer → formatter 串起来跑一遍。
// 各模块的单测都绿，不代表接线对。这里验的是字段名在模块边界上是否真的对得上。

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const tmpDb = path.join(os.tmpdir(), `e2e-pipe-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DATABASE_PATH = tmpDb;

const db           = require('../db');
const articleIndex = require('../article-index');
const { recommend, extractEntities } = require('../recommender');
const { formatToWechat, buildRecommendBlock } = require('../formatter');

const ACC = '管线号';

after(() => {
  try { fs.unlinkSync(tmpDb); } catch (_) {}
});

// 造一批历史文章：两篇讲 Cursor，一篇讲别的
function seedHistory() {
  const rows = [
    { title: 'Cursor 1.0 上手',   url: 'https://mp.weixin.qq.com/s/c1', body: '我们第一次用 Cursor 写代码', at: '2025-01-01' },
    { title: 'Cursor 2.0 有什么变化', url: 'https://mp.weixin.qq.com/s/c2', body: 'Cursor 这次更新很大', at: '2026-01-01' },
    { title: '聊聊播客这门生意',   url: 'https://mp.weixin.qq.com/s/p1', body: '播客的商业模式很特别', at: '2026-02-01' },
  ];
  for (const r of rows) {
    const id = db.upsertArticle({
      accountName: ACC, title: r.title, url: r.url, thumbUrl: 'https://img/x.jpg',
      status: 'published', bodyText: r.body,
      summaryText: articleIndex.makeSummary(r.title, r.body), publishedAt: r.at,
    });
    db.setArticleEntities(id, extractEntities(r.title, r.body));
  }
}

function recommendFor(parsed) {
  const title    = parsed.title;
  const bodyText = articleIndex.parsedToText(parsed);
  const { docFreq, totalDocs } = db.getEntityDocFreq(ACC);
  return recommend({
    current: {
      entities:    extractEntities(title, bodyText),
      summaryText: articleIndex.makeSummary(title, bodyText),
      url: '', sourceUrl: 'https://notion.so/new',
    },
    candidates: db.listPublishedArticles(ACC),
    docFreq, totalDocs, limit: 8,
  });
}

test('管线：讲同一个产品的新文章能召回历史文章，新的排前面', () => {
  seedHistory();
  const picks = recommendFor({
    title: 'Cursor 又更新了',
    blocks: [{ type: 'paragraph', content: '这次我们再看看 Cursor' }],
  });
  assert.strictEqual(picks.length, 2, '应只召回两篇 Cursor 文章，播客那篇不该进来');
  assert.deepStrictEqual(picks.map(p => p.title), ['Cursor 2.0 有什么变化', 'Cursor 1.0 上手']);
  assert.ok(picks[0].sharedEntities.includes('cursor'));
  // db 出来的字段名必须能直接喂给卡片渲染
  assert.ok(picks[0].thumbUrl, 'thumbUrl 必须一路传下来');
});

test('管线：没有共同对象时一篇都不召回', () => {
  const picks = recommendFor({
    title: '我们做了一次线下活动',
    blocks: [{ type: 'paragraph', content: '来了两百个人，聊得很开心' }],
  });
  assert.deepStrictEqual(picks, []);
});

test('管线：召回结果直接落进正文 wrapper 之内', () => {
  const picks = recommendFor({
    title: 'Cursor 又更新了',
    blocks: [{ type: 'paragraph', content: '这次我们再看看 Cursor' }],
  });
  assert.strictEqual(picks.length, 2);

  const html = formatToWechat(
    { title: 'Cursor 又更新了', blocks: [{ type: 'paragraph', content: '正文' }], links: [] },
    { appendHtml: buildRecommendBlock(picks) },
  );

  assert.ok(html.endsWith('</section>'));
  assert.ok(html.includes('推荐阅读'));
  // 板块必须在最外层 wrapper 之内，否则丢基础字体字色
  assert.ok(html.indexOf('推荐阅读') < html.lastIndexOf('</section>'), '推荐板块跑到 wrapper 外面了');
  // 两个可点击链接，指向真实 mp 地址
  assert.strictEqual((html.match(/<a href="https:\/\/mp\.weixin\.qq\.com\/s\//g) || []).length, 2);
  // db 出来的 publishedAt 一路传到日期行
  assert.ok(html.includes('2026.01.01'), '日期应渲染出来');
  // 纯 HTML，不再有图片
  // 封面直连原图，由 processHtmlImages 转存到 mmbiz，不再内嵌合成图
  assert.ok(!html.includes('data:image'), '不应再有内嵌合成图');
});

test('管线：一篇都没选时正文与改造前完全一致', () => {
  const parsed = { title: 'T', blocks: [{ type: 'paragraph', content: '正文' }], links: [] };
  assert.strictEqual(
    formatToWechat(parsed, { appendHtml: buildRecommendBlock([]) }),
    formatToWechat(parsed),
  );
});
