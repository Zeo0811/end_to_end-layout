const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat, buildRecommendBlock } = require('../formatter');

const PARSED = { title: 'T', blocks: [{ type: 'paragraph', content: '正文内容' }], links: [] };


// 卡片是合成好的图，buildRecommendBlock 只负责套 <a> 和 <img>
const CARDS = [
  { title: '文章一', url: 'https://mp.weixin.qq.com/s?__biz=A&sn=1', dataUri: 'data:image/jpeg;base64,AAA' },
  { title: '文章二', url: 'https://mp.weixin.qq.com/s?__biz=A&sn=2', dataUri: 'data:image/jpeg;base64,BBB' },
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









test('buildRecommendBlock: 板块标题与文章 H1 逐项一致', () => {
  // 早先收成 20px + 4px 边框 + 6px 下内边距，想着别抢层级，
  // 结果在微信里看着就不像同一套排版。改为与 S.h1 完全相同。
  const html = buildRecommendBlock(CARDS);
  for (const token of [
    'font-size: 24px',
    'font-weight: bold',
    'color: #327848',
    'border-bottom: 8px solid #327848',
    'padding: 0 0.25em;',
    'width: fit-content',
    'text-align: center',
    'line-height: 1.5',
  ]) {
    assert.ok(html.includes(token), `板块标题缺少 H1 的 ${token}`);
  }
  assert.ok(!html.includes('padding: 0 0.25em 6px'), '不该有额外下内边距，会把下划线推开');
});









test('buildRecommendBlock: 每张卡片一张图配一个链接', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('推荐阅读'));
  assert.strictEqual((html.match(/<a href="https:\/\/mp\.weixin\.qq\.com/g) || []).length, 2);
  assert.strictEqual((html.match(/<img /g) || []).length, 2);
  assert.ok(html.includes('data:image/jpeg;base64,AAA'));
  assert.ok(html.includes('data:image/jpeg;base64,BBB'));
});

test('buildRecommendBlock: <a> 里只有 <img>，没有块级元素', () => {
  // 微信会拆开跨块级的 <a>，并给文字链接自动加小图标
  const html = buildRecommendBlock(CARDS);
  assert.ok(!/<a[^>]*>\s*<section/.test(html), '<a> 不能包 section');
  assert.ok(/<a[^>]*>\s*<img/.test(html), '<a> 里应直接是 img');
});

test('buildRecommendBlock: alt 用标题且被转义', () => {
  const html = buildRecommendBlock([{ title: '带<尖括号>的标题', url: 'https://mp/x', dataUri: 'data:image/jpeg;base64,X' }]);
  assert.ok(html.includes('&lt;尖括号&gt;'));
  assert.ok(!html.includes('<尖括号>'));
});

test('buildRecommendBlock: 板块标题与文章 H1 逐项一致', () => {
  const html = buildRecommendBlock(CARDS);
  for (const t of ['font-size: 24px', 'font-weight: bold', 'color: #327848',
                   'border-bottom: 8px solid #327848', 'padding: 0 0.25em;',
                   'width: fit-content', 'text-align: center', 'line-height: 1.5']) {
    assert.ok(html.includes(t), `缺少 H1 的 ${t}`);
  }
});
