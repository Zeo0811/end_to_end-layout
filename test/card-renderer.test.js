const { test, after } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { buildCardHtml, renderCard, renderCards } = require('../card-renderer');
const crawler = require('../parsers/crawler');

after(async () => { await crawler.closeBrowser(); });

// 1×1 红点，避免测试依赖网络
const RED_DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('buildCardHtml: 标题被转义，封面被嵌入', () => {
  const html = buildCardHtml({ title: '<script>x</script>标题', coverDataUri: RED_DOT });
  assert.ok(html.includes('&lt;script&gt;'), '标题必须转义');
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes(RED_DOT));
});

test('buildCardHtml: 包含中文字体栈', () => {
  const html = buildCardHtml({ title: '标题', coverDataUri: RED_DOT });
  assert.ok(/Noto Sans CJK|PingFang SC/.test(html));
});

test('renderCard: 渲染出 JPEG data URI', async () => {
  const uri = await renderCard({ title: '这是一个中文标题，用来验证字体渲染', coverDataUri: RED_DOT });
  assert.ok(uri, '应返回 data URI');
  assert.ok(uri.startsWith('data:image/jpeg;base64,'), `实际前缀: ${uri.slice(0, 40)}`);
  assert.ok(uri.length > 2000, '图片不应为空白小图');

  // 存一份到本地，人工确认中文没渲染成豆腐块
  const out = path.join(__dirname, 'card-preview.jpg');
  fs.writeFileSync(out, Buffer.from(uri.split(',')[1], 'base64'));
  console.log(`\n  卡片预览已写入 ${out}，请肉眼确认中文正常显示\n`);
});

test('renderCard: 没有封面时返回 null，不出无图卡片', async () => {
  const uri = await renderCard({ title: '无封面', coverDataUri: null });
  assert.strictEqual(uri, null);
});

test('renderCards: 跳过取不到封面的条目', async () => {
  const cards = await renderCards([
    { title: '有封面', url: 'https://mp/1', coverDataUri: RED_DOT },
    { title: '无封面', url: 'https://mp/2', coverDataUri: null },
  ]);
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].url, 'https://mp/1');
});
