const { test, after } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const { buildCardHtml, renderCard, renderCards,
        CARD_WIDTH, COVER_HEIGHT, CARD_WIDTH_PT, COVER_HEIGHT_PT, DPR } = require('../card-renderer');
const crawler = require('../parsers/crawler');

after(async () => { await crawler.closeBrowser(); });

// 1×1 红点，避免测试依赖网络
const RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('尺寸：CSS 用真实 pt，输出 3 倍图', () => {
  assert.strictEqual(CARD_WIDTH_PT, 375, '正文显示宽度');
  assert.strictEqual(COVER_HEIGHT_PT, 150);
  assert.strictEqual(DPR, 3, 'iPhone Pro 系列是 3 倍屏，2 倍图会被放大 1.5 倍');
  assert.strictEqual(CARD_WIDTH, 1125);
  assert.strictEqual(COVER_HEIGHT, 450);
});

test('CSS 里写的是真实字号，不是硬乘过的', () => {
  // 用大号 CSS px 排版，文字光栅化拿不到高 DPI 的 subpixel 定位
  const h = buildCardHtml({ title: '标题', date: '2025.01.01', coverDataUri: RED });
  assert.ok(h.includes('font-size: 15px'), '标题与正文同字号');
  assert.ok(h.includes('font-size: 12px'), '日期');
  assert.ok(!h.includes('font-size: 30px'), '不该再有硬乘 2 的字号');
});

test('buildCardHtml: 标题转义，封面嵌入', () => {
  const h = buildCardHtml({ title: '<script>x</script>标题', date: '2025.09.25', coverDataUri: RED });
  assert.ok(h.includes('&lt;script&gt;'));
  assert.ok(!h.includes('<script>x</script>'));
  assert.ok(h.includes(RED));
  assert.ok(h.includes('2025.09.25'));
});

test('buildCardHtml: 内嵌字体，不依赖容器里装了什么', () => {
  const h = buildCardHtml({ title: '标题', date: '2025.01.01', coverDataUri: RED });
  assert.ok(h.includes('@font-face'), '必须内嵌 @font-face');
  assert.ok(h.includes('data:font/woff2;base64,'), '字体应以 data URI 内嵌');
  assert.ok(h.includes('"HarmonyOS Sans SC"'), '与 Layout-design 渲染标题图同一套字体');
  assert.ok(h.includes('font-weight:400') && h.includes('font-weight:600'), '两个字重都要内嵌');
  // 读取失败时的系统字体兜底
  assert.ok(h.includes('PingFang SC'), '缺兜底字体');
});

test('buildCardHtml: 字距与正文同源', () => {
  const { WX_LS } = require('../formatter');
  const h = buildCardHtml({ title: '标题', date: '2025.01.01', coverDataUri: RED });
  assert.ok(h.includes(`letter-spacing: ${WX_LS}`), '字距走 formatter 的 token');
  assert.ok(h.includes('#327848'), '品牌绿');
});

test('字体文件已随仓库提供且体积可控', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const f of ['HarmonyOS_Sans_SC_Regular.woff2', 'HarmonyOS_Sans_SC_Medium.woff2']) {
    const p = path.join(__dirname, '..', 'assets', 'fonts', f);
    assert.ok(fs.existsSync(p), `缺字体文件 ${f}`);
    const mb = fs.statSync(p).size / 1024 / 1024;
    assert.ok(mb < 2, `${f} 有 ${mb.toFixed(1)}MB，子集化应压到 1MB 上下`);
  }
});



test('buildCardHtml: 没有日期时不画日期行', () => {
  const h = buildCardHtml({ title: '标题', date: '', coverDataUri: RED });
  assert.ok(!h.includes('class="meta"'));
});

test('renderCard: 输出 3 倍图，宽度 1125', async () => {
  const uri = await renderCard({ title: '像素检查', date: '2025.01.01', coverDataUri: RED });
  const buf = Buffer.from(uri.split(',')[1], 'base64');
  // 从 JPEG SOF 段读真实尺寸
  let i = 2, w = 0;
  while (i < buf.length && buf[i] === 0xFF) {
    const marker = buf[i + 1];
    if (marker === 0xC0 || marker === 0xC2) { w = buf.readUInt16BE(i + 7); break; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  assert.strictEqual(w, 1125, `实际宽度 ${w}`);
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
