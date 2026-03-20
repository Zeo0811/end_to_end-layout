// Playwright 爬取器
// 打开 Notion/飞书公开链接，注入 parser，返回结构化 blocks

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

let browser = null;

// 读取 parser 源码（注入到页面 evaluate 中执行）
const notionParserCode = fs.readFileSync(path.join(__dirname, 'notion-parser.js'), 'utf8');
const feishuParserCode = fs.readFileSync(path.join(__dirname, 'feishu-parser.js'), 'utf8');

async function ensureBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browser;
}

function detectPlatform(url) {
  if (/notion\.(so|site)/.test(url)) return 'notion';
  if (/feishu\.cn|larksuite\.com/.test(url)) return 'feishu';
  return null;
}

// 将页面中所有 blob: 图片转为 base64 data URL
async function convertBlobImages(page) {
  return page.evaluate(async () => {
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      if (!src.startsWith('blob:')) continue;
      try {
        const resp = await fetch(src);
        const blob = await resp.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        img.src = dataUrl;
      } catch (e) {
        // blob 失效则跳过
      }
    }
  });
}

async function crawl(url) {
  const platform = detectPlatform(url);
  if (!platform) {
    throw new Error('不支持的链接，仅支持 Notion 和飞书公开链接');
  }

  const b = await ensureBrowser();
  const context = await b.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log(`[Crawler] 打开 ${platform} 页面: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 等待内容渲染
    if (platform === 'notion') {
      // Notion 页面：等待内容区域出现
      await page.waitForSelector(
        '.notion-page-content, [data-content-editable-root], [class*="layout-content"]',
        { timeout: 15000 }
      ).catch(() => {});
      // 额外等待动态加载
      await page.waitForTimeout(2000);
    } else {
      // 飞书页面：等待 block 出现
      await page.waitForSelector(
        '[data-block-type="page"], .lark-ck-editor, [class*="docx-content"]',
        { timeout: 15000 }
      ).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // 转换 blob 图片
    await convertBlobImages(page);

    let result;

    if (platform === 'notion') {
      result = await page.evaluate((parserCode) => {
        eval(parserCode);
        return parseNotion();
      }, notionParserCode);
    } else {
      // 飞书：先用 scrollAndCollect 处理虚拟滚动，再组装结果
      result = await page.evaluate(async (parserCode) => {
        eval(parserCode);
        // scrollAndCollect 是异步的（处理虚拟滚动）
        if (typeof scrollAndCollect === 'function') {
          const sc = await scrollAndCollect();
          const title = getFeishuTitle();
          return { type: 'feishu', title, blocks: sc.blocks, links: sc.links };
        }
        // 降级：直接用同步解析
        return parseFeishu();
      }, feishuParserCode);
    }

    // 解析完成后再处理一次图片（parser 可能更新了 src）
    // 将 blocks 中的图片 URL 替换：如果是相对路径或特殊协议，尝试转为绝对 URL
    if (result && result.blocks) {
      for (const block of result.blocks) {
        if (block.type === 'image' && block.url) {
          // 将相对 URL 补全
          if (block.url.startsWith('/')) {
            const base = new URL(url);
            block.url = base.origin + block.url;
          }
        }
      }
    }

    console.log(`[Crawler] 解析完成: ${result.title || '无标题'}, ${result.blocks?.length || 0} 个块`);
    return result;
  } finally {
    await context.close();
  }
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = { crawl, closeBrowser };
