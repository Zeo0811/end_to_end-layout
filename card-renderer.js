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

// 字距取自 formatter.js 的正文定义，不另写一份 —— 两边各写一份迟早会漂。
const { WX_LS } = require('./formatter');

// 字体内嵌，不依赖容器里装了什么。
//
// 正文在读者手机上渲染成什么，取决于他们的设备（iOS 是 PingFang SC，
// 安卓各不相同），我们控制不了；PingFang 又是 Apple 授权字体，打不进镜像。
// 所以卡片选 HarmonyOS Sans SC —— 字形结构比 Noto 更接近 PingFang，
// 而且和 Layout-design 渲染标题图用的是同一套字体，两个仓库出来的图一致。
//
// 内嵌的另一个好处：不用再赌 nixpacks 的 noto-fonts-cjk-sans 在容器里生效。
// 字体已子集化到 GB2312 + 常用标点（7545 字），8MB TTF → 930KB woff2。
const fs   = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, 'assets', 'fonts');
function loadFont(file) {
  try {
    return fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
  } catch (e) {
    console.warn(`[Card] 字体 ${file} 读取失败，将回退到系统字体:`, e.message);
    return null;
  }
}
const FONT_REGULAR = loadFont('HarmonyOS_Sans_SC_Regular.woff2');
const FONT_MEDIUM  = loadFont('HarmonyOS_Sans_SC_Medium.woff2');

function fontFace(weight, b64) {
  if (!b64) return '';
  return `@font-face{font-family:"HarmonyOS Sans SC";font-style:normal;font-weight:${weight};`
    + `src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
}
const FONT_FACES = fontFace(400, FONT_REGULAR) + fontFace(600, FONT_MEDIUM);

const GREEN = '#327848';
// 内嵌字体排第一；万一读取失败，后面这串是系统字体的兜底
const FONT  = '"HarmonyOS Sans SC", "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
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
  ${FONT_FACES}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; font-family: ${FONT}; }
  .card { width: ${CARD_WIDTH}px; background: ${GREEN}; overflow: hidden; }
  .cover { width: ${CARD_WIDTH}px; height: ${COVER_HEIGHT}px; object-fit: cover; object-position: center; display: block; }
  .bar { padding: ${PAD_Y}px ${PAD_X}px; }
  .title {
    font-size: ${TITLE_PX}px; line-height: 1.6; color: #fff; font-weight: 600;
    letter-spacing: ${WX_LS};
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .meta { font-size: ${META_PX}px; line-height: 1.6; color: rgba(255,255,255,.72);
          letter-spacing: ${WX_LS}; margin-top: ${6 * SCALE}px; }
  </style></head><body>
  <div class="card">${cover}<div class="bar"><div class="title">${esc(title)}</div>${meta}</div></div>
  </body></html>`;
}

// 只在首次渲染时探一次：内嵌字体到底有没有生效。
// 没生效的话卡片上的中文会用系统字体、甚至变豆腐块，
// 而这件事在 Railway 上不看日志发现不了。
let fontProbed = false;
async function probeFonts(page) {
  if (fontProbed) return;
  fontProbed = true;
  try {
    const hit = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        embedded: document.fonts.check('30px "HarmonyOS Sans SC"', '中'),
        loaded: [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`),
      };
    });
    if (hit.embedded) {
      console.log(`[Card] 内嵌字体已生效: ${hit.loaded.join(' | ')}`);
    } else {
      console.warn('[Card] 警告：内嵌字体未生效，已回退到系统字体。'
        + '检查 assets/fonts/*.woff2 是否随构建打包');
    }
  } catch (_) { /* 探测失败不影响出图 */ }
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
    await probeFonts(page);
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
