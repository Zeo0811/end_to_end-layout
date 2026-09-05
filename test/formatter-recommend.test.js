const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat, buildRecommendBlock } = require('../formatter');

const PARSED = { title: 'T', blocks: [{ type: 'paragraph', content: '正文内容' }], links: [] };

const CARDS = [
  { title: '文章一', url: 'https://mp.weixin.qq.com/s?__biz=A&sn=1', publishedAt: '2025-09-25 21:41:23' },
  { title: '文章二', url: 'https://mp.weixin.qq.com/s?__biz=A&sn=2', publishedAt: '2026-08-14' },
];

test('formatToWechat: 不传 options 时行为不变', () => {
  const html = formatToWechat(PARSED);
  assert.ok(html.startsWith('<section style="'));
  assert.ok(html.endsWith('</section>'));
  assert.ok(html.includes('正文内容'));
});

test('formatToWechat: appendHtml 插在最外层 section 之内', () => {
  const html = formatToWechat(PARSED, { appendHtml: '<p>尾巴</p>' });
  assert.ok(html.endsWith('<p>尾巴</p></section>'), `实际结尾: ${html.slice(-60)}`);
});

test('formatToWechat: appendHtml 为空串时不影响输出', () => {
  assert.strictEqual(formatToWechat(PARSED, { appendHtml: '' }), formatToWechat(PARSED));
});

test('buildRecommendBlock: 空数组返回空串（板块整体不出现）', () => {
  assert.strictEqual(buildRecommendBlock([]), '');
  assert.strictEqual(buildRecommendBlock(null), '');
});

test('buildRecommendBlock: 每篇一个指向 mp 的链接', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('推荐阅读'));
  assert.strictEqual((html.match(/<a href="https:\/\/mp\.weixin\.qq\.com/g) || []).length, 2);
  assert.ok(html.includes('文章一'));
  assert.ok(html.includes('文章二'));
});

test('buildRecommendBlock: 不再产出图片，改为纯 HTML', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(!html.includes('<img'), '不应再有 img 标签');
  assert.ok(!html.includes('data:image'), '不应再有内嵌图片');
});

test('buildRecommendBlock: 日期取到天，格式 YYYY.MM.DD', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('2025.09.25'));
  assert.ok(html.includes('2026.08.14'));
  assert.ok(!html.includes('21:41:23'), '不应带时分秒');
});

test('buildRecommendBlock: 没有发布时间时不渲染日期行', () => {
  const html = buildRecommendBlock([{ title: 'x', url: 'https://mp/x', publishedAt: '' }]);
  assert.ok(html.includes('x'));
  assert.ok(!html.includes('recommend_card_meta'));
  assert.strictEqual((html.match(/8a998f/g) || []).length, 0, '日期样式不应出现');
});

test('buildRecommendBlock: 标题被转义', () => {
  const html = buildRecommendBlock([
    { title: '带"引号"的<标题>', url: 'https://mp.weixin.qq.com/s/x', publishedAt: '2026-01-01' },
  ]);
  assert.ok(html.includes('&lt;标题&gt;'));
  assert.ok(!html.includes('<标题>'));
});

test('buildRecommendBlock: 字体字号字距与正文一致', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('mp-quote'), '必须用正文字体栈');
  assert.ok(html.includes('font-size: 15px'), '卡片标题用正文字号');
  assert.ok(html.includes('letter-spacing: 0.034em'), '字距与正文一致');
});

test('buildRecommendBlock: 板块标题沿用 H1 语汇但不抢层级', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('border-bottom: 4px solid #327848'), '绿色下边框，收窄到 4px');
  assert.ok(html.includes('width: fit-content'));
  assert.ok(html.includes('text-align: center'));
  assert.ok(!html.includes('border-bottom: 8px'), '8px 是文章 H1 的，不能占用');
});

test('buildRecommendBlock: 卡片沿用 callout 语汇', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('#f7faf8'), 'callout 底色');
  assert.ok(html.includes('border: 1px solid #327848'), 'callout 绿边');
});
