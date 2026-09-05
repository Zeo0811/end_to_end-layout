// 推荐阅读卡片渲染 —— 整张卡片合成一张 JPEG
//
// 为什么必须是图片：微信正文里的文字链接会被自动加上一个小图标，
// 还会给每段套 <span leaf=""> 撑出多余行框，版面控制不住（实测过 HTML 方案）。
// 一张图配一个 <a> 是微信唯一不会改的结构。
//
// 复用 crawler 的常驻 chromium，只新开 context，截完立刻关。

const { ensureBrowser } = require('./parsers/crawler');

// 2 倍图，对应正文 375pt 显示宽度
const SCALE        = 2;
const CARD_WIDTH   = 375 * SCALE;   // 750
const COVER_HEIGHT = 150 * SCALE;   // 300 —— 比早先的 180pt 再低一点
const JPEG_QUALITY = 88;

// 与正文排版同源：品牌绿、微信默认字体栈、15px 正文、0.034em 字距
const GREEN     = '#327848';
const FONT      = '"Noto Sans CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const TITLE_PX  = 15 * SCALE;       // 30
const META_PX   = 12 * SCALE;       // 24
const PAD_Y     = 14 * SCALE;       // 28
const PAD_X     = 16 * SCALE;       // 32

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
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: '' },
    });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!mime.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    console.error('[Card] 封面下载失败:', String(url).slice(0, 80), e.message);
    return null;
  }
}

// 方案 3：上图下字，绿底白字
function buildCardHtml({ title, date, coverDataUri }) {
  const cover = coverDataUri
    ? `<img class="cover" src="${coverDataUri}">`
    : '';
  const meta = date
    ? `<div class="meta">${esc(date)}</div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; font-family: ${FONT}; }
  .card { width: ${CARD_WIDTH}px; background: ${GREEN}; overflow: hidden; }
  .cover { width: ${CARD_WIDTH}px; height: ${COVER_HEIGHT}px; object-fit: cover; object-position: center; display: block; }
  .bar { padding: ${PAD_Y}px ${PAD_X}px; }
  .title {
    font-size: ${TITLE_PX}px; line-height: 1.6; color: #fff; font-weight: 600;
    letter-spacing: 0.034em;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .meta { font-size: ${META_PX}px; line-height: 1.6; color: rgba(255,255,255,.72);
          letter-spacing: 0.034em; margin-top: ${6 * SCALE}px; }
  </style></head><body>
  <div class="card">${cover}<div class="bar"><div class="title">${esc(title)}</div>${meta}</div></div>
  </body></html>`;
}

async function renderCard({ title, date, coverUrl, coverDataUri }) {
  const cover = coverDataUri !== undefined ? coverDataUri : await fetchImageAsDataUri(coverUrl);
  if (!cover) return null; // 没有封面就不出卡片，不做无图降级

  const browser = await ensureBrowser();
  const context = await browser.newContext({
    deviceScaleFactor: 1,   // 尺寸里已经乘过 SCALE，这里不能再翻倍
    viewport: { width: CARD_WIDTH, height: COVER_HEIGHT + 300 },
  });
  try {
    const page = await context.newPage();
    await page.setContent(buildCardHtml({ title, date, coverDataUri: cover }), { waitUntil: 'load' });
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
