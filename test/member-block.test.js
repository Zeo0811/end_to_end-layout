const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat, buildRecommendBlock, buildMemberBlock, MEMBER_ARTICLE } = require('../formatter');

const CARD = { title: MEMBER_ARTICLE.title, url: MEMBER_ARTICLE.url, dataUri: 'data:image/jpeg;base64,MEM' };
const RECO = [{ title: '推荐文章', url: 'https://mp.weixin.qq.com/s/x', dataUri: 'data:image/jpeg;base64,AAA' }];

test('会员群是一张卡片，点击跳入群说明文章', () => {
  const h = buildMemberBlock(CARD);
  assert.match(h, /加入会员群/, '标题');
  assert.ok(h.includes(`href="${MEMBER_ARTICLE.url}"`), '链接指向那篇文章');
  assert.strictEqual((h.match(/<img /g) || []).length, 1, '一张卡片图');
  assert.ok(h.includes('data:image/jpeg;base64,MEM'));
});

test('卡片样式与推荐阅读同一套 token', () => {
  const mem  = buildMemberBlock(CARD);
  const reco = buildRecommendBlock(RECO);
  // 两边的 <img> 用的是同一个 recommend_img
  const imgStyle = /<img[^>]+style="([^"]+)"/;
  assert.strictEqual(mem.match(imgStyle)[1], reco.match(imgStyle)[1],
    '卡片图样式必须一致，以后改一处两边一起变');
});

test('标题与文章 H1 同一套语汇', () => {
  const h = buildMemberBlock(CARD);
  for (const t of ['font-size: 24px', 'font-weight: bold', 'color: #327848',
                   'border-bottom: 8px solid #327848', 'width: fit-content', 'text-align: center']) {
    assert.ok(h.includes(t), `缺少 H1 的 ${t}`);
  }
});

test('没有卡片时返回空串，不出半截板块', () => {
  assert.strictEqual(buildMemberBlock(null), '');
  assert.strictEqual(buildMemberBlock({}), '');
  assert.strictEqual(buildMemberBlock({ title: 'x', url: 'y' }), '', '缺 dataUri 也不出');
});

test('不再有二维码和权益列表（那是上一版理解错的做法）', () => {
  const h = buildMemberBlock(CARD);
  assert.ok(!h.includes('<li '), '不该有权益列表');
  assert.ok(!h.includes('你将获得'));
  assert.ok(!/mmbiz[^"]*wx_fmt=png/.test(h), '不该内嵌二维码原图');
});

test('有推荐阅读时，会员群排在它下面', () => {
  const parsed = { title: 'T', links: [], blocks: [{ type: 'paragraph', content: '正文' }] };
  const html = formatToWechat(parsed, { appendHtml: buildRecommendBlock(RECO) + buildMemberBlock(CARD) });
  const reco = html.indexOf('推荐阅读');
  const mem  = html.indexOf('加入会员群');
  assert.ok(reco > 0 && mem > 0);
  assert.ok(reco < mem, '推荐阅读必须在会员群前面');
  assert.ok(mem < html.lastIndexOf('</section>'), '会员群要落在最外层 wrapper 之内');
});

test('没有推荐阅读时，会员群直接接在正文后', () => {
  const parsed = { title: 'T', links: [], blocks: [{ type: 'paragraph', content: '正文内容' }] };
  const html = formatToWechat(parsed, { appendHtml: buildMemberBlock(CARD) });
  assert.ok(!html.includes('推荐阅读'));
  assert.match(html, /加入会员群/);
  assert.ok(html.indexOf('正文内容') < html.indexOf('加入会员群'));
});

test('文章信息集中在 MEMBER_ARTICLE，换文章只改一处', () => {
  assert.match(MEMBER_ARTICLE.url, /^https:\/\/mp\.weixin\.qq\.com\/s\//);
  assert.ok(MEMBER_ARTICLE.title.length > 5);
  assert.match(MEMBER_ARTICLE.coverUrl, /^https:\/\/mmbiz/);
  assert.match(MEMBER_ARTICLE.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'formatter.js'), 'utf8');
  assert.strictEqual((src.match(/const MEMBER_ARTICLE = /g) || []).length, 1);
});
