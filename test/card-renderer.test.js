const { test, after } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const { buildCardHtml, renderCard, renderCards, CARD_WIDTH, COVER_HEIGHT } = require('../card-renderer');
const crawler = require('../parsers/crawler');

after(async () => { await crawler.closeBrowser(); });

// 1×1 红点，避免测试依赖网络
const RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('尺寸：750 宽（375pt @2x），封面 300 高', () => {
  assert.strictEqual(CARD_WIDTH, 750);
  assert.strictEqual(COVER_HEIGHT, 300);
});

test('buildCardHtml: 标题转义，封面嵌入', () => {
  const h = buildCardHtml({ title: '<script>x</script>标题', date: '2025.09.25', coverDataUri: RED });
  assert.ok(h.includes('&lt;script&gt;'));
  assert.ok(!h.includes('<script>x</script>'));
  assert.ok(h.includes(RED));
  assert.ok(h.includes('2025.09.25'));
});

test('buildCardHtml: 用品牌绿和中文字体栈', () => {
  const h = buildCardHtml({ title: '标题', date: '', coverDataUri: RED });
  assert.ok(h.includes('#327848'), '品牌绿');
  assert.ok(/Noto Sans CJK|PingFang SC/.test(h), '容器里靠 Noto CJK，本机靠 PingFang');
});

test('buildCardHtml: 没有日期时不画日期行', () => {
  const h = buildCardHtml({ title: '标题', date: '', coverDataUri: RED });
  assert.ok(!h.includes('class="meta"'));
});

test('renderCard: 输出 JPEG data URI', async () => {
  const uri = await renderCard({ title: '这是一个中文标题，用来验证字体渲染', date: '2025.09.25', coverDataUri: RED });
  assert.ok(uri, '应返回 data URI');
  assert.ok(uri.startsWith('data:image/jpeg;base64,'));
  assert.ok(uri.length > 2000, '不应是空白小图');

  // 存一份，人工确认中文不是豆腐块
  fs.writeFileSync(path.join(__dirname, 'card-preview.jpg'), Buffer.from(uri.split(',')[1], 'base64'));
});

test('renderCard: 没有封面时返回 null，不出无图卡片', async () => {
  assert.strictEqual(await renderCard({ title: '无封面', date: '', coverDataUri: null }), null);
});

test('renderCards: 跳过取不到封面的条目', async () => {
  const cards = await renderCards([
    { title: '有封面', url: 'https://mp/1', date: '2025.01.01', coverDataUri: RED },
    { title: '无封面', url: 'https://mp/2', date: '2025.01.02', coverDataUri: null },
  ]);
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].url, 'https://mp/1');
  assert.ok(cards[0].dataUri.startsWith('data:image/jpeg;base64,'));
});
