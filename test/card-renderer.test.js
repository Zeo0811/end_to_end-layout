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

// ── 封面上的行动按钮（会员群卡片用）──

test('buildCardHtml: 传 button 时压在封面右侧、垂直居中', () => {
  const h = buildCardHtml({ title: '标题', coverDataUri: RED, button: '免费入群 ›' });
  assert.match(h, /免费入群/);
  assert.ok(h.includes('class="coverwrap"'), '封面要有定位容器');
  assert.ok(h.includes('position: absolute'), '按钮绝对定位');
  assert.ok(h.includes('right: 22px'), '靠右');
  assert.ok(h.includes('translateY(-50%)'), '垂直居中');
  assert.ok(h.includes('#327848'), '品牌绿');
  assert.ok(!/border-radius/.test(h), '直角，与 callout/图片去圆角一致');
});

test('buildCardHtml: 不传 button 时没有按钮，推荐阅读卡片不受影响', () => {
  const h = buildCardHtml({ title: '标题', date: '2025.01.01', coverDataUri: RED });
  assert.ok(!h.includes('class="btn"'));
  assert.match(h, /2025\.01\.01/, '日期照常显示');
});

test('buildCardHtml: 不传 date 时不画日期行', () => {
  const h = buildCardHtml({ title: '标题', coverDataUri: RED, button: '免费入群' });
  assert.ok(!h.includes('class="meta"'));
});

test('buildCardHtml: 按钮文字被转义', () => {
  const h = buildCardHtml({ title: 'x', coverDataUri: RED, button: '<script>y</script>' });
  assert.ok(h.includes('&lt;script&gt;'));
  assert.ok(!h.includes('<script>y</script>'));
});

test('renderCard: 带按钮能正常出图', async () => {
  const uri = await renderCard({ title: '会员群标题', coverDataUri: RED, button: '免费入群 ›' });
  assert.ok(uri && uri.startsWith('data:image/jpeg;base64,'));
  assert.ok(uri.length > 2000);
});

// ── 卡片底部不能露白 ──
// 带日期时 .card 高度是小数（日期行 12px × 1.6 = 19.2），元素截图会把裁剪框
// 向上取整，多截进一条白色 body —— 3 倍图上就是底部 3 行白像素。
async function bottomRows(uri, n = 3) {
  const browser = await crawler.ensureBrowser();
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    return await page.evaluate(async ([u, n]) => {
      const im = new Image(); im.src = u; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const out = [];
      for (let k = 1; k <= n; k++) out.push([...g.getImageData(im.width >> 1, im.height - k, 1, 1).data].slice(0, 3));
      return out;
    }, [uri, n]);
  } finally { await ctx.close(); }
}

for (const [label, args] of [
  ['一行标题 + 日期', { title: '短标题', date: '2025.01.01' }],
  ['两行标题 + 日期', { title: '这是一个很长很长的中文标题，用来验证两行标题时卡片底部会不会多出白条', date: '2025.01.01' }],
]) {
  test(`renderCard: 底部不露白（${label}）`, async () => {
    const rows = await bottomRows(await renderCard({ ...args, coverDataUri: RED }));
    for (const [r, g, b] of rows) {
      assert.ok(r < 120 && g > 90 && b < 120, `底部应是品牌绿，实际 rgb(${r},${g},${b})`);
    }
  });
}
