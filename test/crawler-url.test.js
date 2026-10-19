const { test } = require('node:test');
const assert   = require('node:assert');
const { normalizeUrl } = require('../parsers/crawler');

// app.notion.com/p/{空间}/{页面} 打开公开页时，Notion 常停在「Continue to external site」
// 中转页，无头浏览器不跳转，解析时页面是空壳。直接改写成它要跳去的 {空间}.notion.site。
test('app.notion.com/p 链接改写成 notion.site，丢掉 source 参数', () => {
  assert.strictEqual(
    normalizeUrl('https://app.notion.com/p/koooji/hypit-3fe8e8f58ed180e68d96d5705e3f81a0?source=copy_link'),
    'https://koooji.notion.site/hypit-3fe8e8f58ed180e68d96d5705e3f81a0');
  assert.strictEqual(
    normalizeUrl('app.notion.com/p/koooji/Character-AI-OOC-3fd8e8f58ed181ef95f1fb76a4656e6e'),
    'https://koooji.notion.site/Character-AI-OOC-3fd8e8f58ed181ef95f1fb76a4656e6e');
});

test('notion.site 和其他链接保持原样', () => {
  const site = 'https://koooji.notion.site/hypit-3fe8e8f58ed180e68d96d5705e3f81a0?pvs=74';
  assert.strictEqual(normalizeUrl(site), site);
  assert.strictEqual(normalizeUrl('https://www.notion.so/abc-0123456789abcdef0123456789abcdef'),
    'https://www.notion.so/abc-0123456789abcdef0123456789abcdef');
  assert.strictEqual(normalizeUrl('/abc-0123456789abcdef0123456789abcdef'),
    'https://www.notion.so/abc-0123456789abcdef0123456789abcdef');
});
