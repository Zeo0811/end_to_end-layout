const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat, buildRecommendBlock } = require('../formatter');

const PARSED = { title: 'T', blocks: [{ type: 'paragraph', content: '正文内容' }], links: [] };

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

test('buildRecommendBlock: 每张卡片包一个指向 mp 的链接', () => {
  const html = buildRecommendBlock([
    { title: '文章一', url: 'https://mp.weixin.qq.com/s/aaa', dataUri: 'data:image/jpeg;base64,AAA' },
    { title: '文章二', url: 'https://mp.weixin.qq.com/s/bbb', dataUri: 'data:image/jpeg;base64,BBB' },
  ]);
  assert.ok(html.includes('推荐阅读'));
  assert.strictEqual((html.match(/<a href="https:\/\/mp\.weixin\.qq\.com/g) || []).length, 2);
  assert.ok(html.includes('data:image/jpeg;base64,AAA'));
  assert.ok(html.includes('data:image/jpeg;base64,BBB'));
});

test('buildRecommendBlock: 标题写进 alt 且被转义', () => {
  const html = buildRecommendBlock([
    { title: '带"引号"的<标题>', url: 'https://mp.weixin.qq.com/s/x', dataUri: 'data:image/jpeg;base64,X' },
  ]);
  assert.ok(html.includes('&quot;') || html.includes('&#39;'));
  assert.ok(!html.includes('<标题>'));
});

test('buildRecommendBlock: 使用品牌绿与统一块间距', () => {
  const html = buildRecommendBlock([{ title: 'x', url: 'https://mp.weixin.qq.com/s/x', dataUri: 'data:image/jpeg;base64,X' }]);
  assert.ok(html.includes('#327848'));
  assert.ok(html.includes('30px'));
});
