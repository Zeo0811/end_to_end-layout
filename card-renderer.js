// 推荐阅读卡片渲染
//
// 复用 crawler 的常驻 chromium，只新开 context，截完立刻关。
// 不引入 sharp / node-canvas —— 卡片样式就是 CSS，以后想调直接改样式。

const { ensureBrowser } = require('./parsers/crawler');

const CARD_WIDTH   = 750;              // 2 倍图，对应正文 375pt
const COVER_RATIO  = 2.35;             // 与公众号头条封面一致
const COVER_HEIGHT = Math.round(CARD_WIDTH / COVER_RATIO); // 319
const JPEG_QUALITY = 88;

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// mmbiz 图片有 Referer 防盗链，自己 fetch 才能控制 header，
// 所以不让 chromium 直接加载远程 URL。
async function fetchImageAsDataUri(url) {
  if (!url || !/^https?:/.test(url)) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': '' },
    });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!mime.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    console.error('[Card] 封面下载失败:', String(url).slice(0, 80), e.message);
    return null;
  }
}

function buildCardHtml({ title, coverDataUri }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; }
  .card {
    width: ${CARD_WIDTH}px;
    background: #fff;
    border: 1px solid #e8e8e8;
    overflow: hidden;
    font-family: "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .cover { width: ${CARD_WIDTH}px; height: ${COVER_HEIGHT}px; object-fit: cover; display: block; }
  .bar { padding: 24px 28px; }
  .title {
    font-size: 30px; line-height: 1.45; color: #333; font-weight: 600;
    letter-spacing: 0.034em;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  </style></head><body>
  <div class="card">
    <img class="cover" src="${coverDataUri}">
    <div class="bar"><div class="title">${esc(title)}</div></div>
  </div>
  </body></html>`;
}

async function renderCard({ title, coverUrl, coverDataUri }) {
  const cover = coverDataUri !== undefined ? coverDataUri : await fetchImageAsDataUri(coverUrl);
  if (!cover) return null; // 没有封面就不出卡片，不做无图降级

  const browser = await ensureBrowser();
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: CARD_WIDTH, height: COVER_HEIGHT + 200 },
  });
  try {
    const page = await context.newPage();
    await page.setContent(buildCardHtml({ title, coverDataUri: cover }), { waitUntil: 'load' });
    const buf = await page.locator('.card').screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (e) {
    console.error('[Card] 渲染失败:', title, e.message);
    return null;
  } finally {
    await context.close();
  }
}

// 串行渲染，不并发。Railway 内存紧张，一次只开一个 context。
async function renderCards(items) {
  const out = [];
  for (const it of items) {
    const dataUri = await renderCard(it);
    if (dataUri) out.push({ title: it.title, url: it.url, dataUri });
  }
  return out;
}

module.exports = { fetchImageAsDataUri, buildCardHtml, renderCard, renderCards, CARD_WIDTH, COVER_HEIGHT };
