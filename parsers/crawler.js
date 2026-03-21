// Playwright 爬取器
// 打开 Notion/飞书公开链接，注入 parser，返回结构化 blocks

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

let browser = null;

const notionParserCode = fs.readFileSync(path.join(__dirname, 'notion-parser.js'), 'utf8');
const feishuParserCode = fs.readFileSync(path.join(__dirname, 'feishu-parser.js'), 'utf8');

async function ensureBrowser() {
  // 检测浏览器是否存活
  if (browser) {
    try {
      if (browser.isConnected()) return browser;
    } catch (_) {}
    // 浏览器已断开或僵死，清理
    try { await browser.close(); } catch (_) {}
    browser = null;
    console.log('[Crawler] 浏览器已断开，重新启动...');
  }

  // 查找 Chromium 可执行文件路径：环境变量 > 系统 which > Playwright 内置
  let executablePath = process.env.CHROMIUM_PATH || undefined;
  if (!executablePath) {
    try {
      const { execSync } = require('child_process');
      const sysPath = execSync('which chromium || which chromium-browser || which google-chrome', { encoding: 'utf8' }).trim();
      if (sysPath) executablePath = sysPath;
    } catch (_) {}
  }

  if (executablePath) {
    console.log(`[Crawler] 使用 Chromium: ${executablePath}`);
  }

  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  // 监听浏览器断开事件
  browser.on('disconnected', () => {
    console.log('[Crawler] 浏览器进程已断开');
    browser = null;
  });

  return browser;
}

function normalizeUrl(url) {
  url = url.trim();
  // Notion 路径片段：纯 ID 或 带标题前缀的 slug（末尾为 32 位 hex ID）
  if (/^\/.*[0-9a-f]{32}(\?|$)/.test(url)) {
    return 'https://www.notion.so' + url;
  }
  // 没有协议头则补上
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url;
}

function detectPlatform(url) {
  if (/notion\.(so|site)/.test(url)) return 'notion';
  if (/feishu\.cn|larksuite\.com/.test(url)) return 'feishu';
  return null;
}

// 在页面上下文中将所有图片转为 base64 data URL
// 包括 blob:、Notion 签名 URL 等服务端无法直接 fetch 的图片
// 注意：GIF 图片使用 fetch 保留原始格式，避免 canvas 转为静态 PNG
async function convertAllImages(page) {
  return page.evaluate(async () => {
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:')) continue;

      // 判断是否为 GIF（通过 URL 扩展名或已知的 content-type）
      const isGif = /\.gif(\?|$)/i.test(src);

      try {
        // GIF 图片必须用 fetch 保留原始格式，canvas 会丢失动画
        if (!isGif && img.complete && img.naturalWidth > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          try {
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl && dataUrl.length > 100) {
              img.src = dataUrl;
              continue;
            }
          } catch (e) {
            // canvas tainted by CORS, fallback to fetch
          }
        }
        // fetch 方式（blob: URL、GIF 或需要 cookie 的 URL）
        const resp = await fetch(src, { credentials: 'include' });
        if (!resp.ok) continue;
        const blob = await resp.blob();
        // 对于 GIF，确保使用实际的 content-type 而非 canvas 转换
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        img.src = dataUrl;
      } catch (e) {}
    }
  });
}

// 从页面中提取视频的真实 URL（处理 Notion 延迟加载和各种视频容器）
async function extractVideoUrls(page) {
  return page.evaluate(() => {
    const videos = [];

    // 1. 直接的 <video> 元素
    document.querySelectorAll('video').forEach(v => {
      // 优先用 .src（浏览器解析后的完整 URL），再用属性
      const src = v.src || v.getAttribute('src') || '';
      const poster = v.poster || v.getAttribute('poster') || '';
      const sourceEl = v.querySelector('source');
      const sourceSrc = sourceEl ? (sourceEl.src || sourceEl.getAttribute('src') || '') : '';
      const url = src || sourceSrc;
      // 过滤掉缩略图 URL（poster 误跑进 src 的情况）
      if (url && !url.includes('_thumbnail') && !url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)) {
        videos.push({ url, poster });
      }
    });

    // 2. Notion 的 video block 可能用 iframe 嵌入
    document.querySelectorAll('iframe').forEach(iframe => {
      const src = iframe.src || iframe.getAttribute('src') || '';
      if (src.includes('file.notion.so') || src.includes('videos')) {
        videos.push({ url: src, poster: '' });
      }
    });

    // 3. 从 Notion 的 data 属性中找视频 URL
    document.querySelectorAll('[data-block-type="video"], [class*="notion-video"]').forEach(el => {
      // 检查 a 标签链接
      const link = el.querySelector('a[href*="file.notion.so"]');
      if (link) {
        videos.push({ url: link.href, poster: '' });
      }
      // 检查 data-* 属性
      for (const attr of el.attributes) {
        if (attr.value && attr.value.includes('file.notion.so') && !videos.find(v => v.url === attr.value)) {
          videos.push({ url: attr.value, poster: '' });
        }
      }
    });

    return videos;
  });
}

async function crawl(url) {
  url = normalizeUrl(url);
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

  // 拦截并记录所有视频相关的请求 URL（排除缩略图）
  const videoRequestUrls = [];
  page.on('response', response => {
    const resUrl = response.url();
    const contentType = response.headers()['content-type'] || '';
    const isThumb = resUrl.includes('_thumbnail') || resUrl.includes('.jpg') || resUrl.includes('.jpeg') || resUrl.includes('.png') || resUrl.includes('.webp');
    if (!isThumb && (contentType.includes('video') || resUrl.match(/\.(mp4|mov|webm|avi)/i))) {
      videoRequestUrls.push(resUrl);
    }
  });

  try {
    console.log(`[Crawler] 打开 ${platform} 页面: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {
      console.log('[Crawler] networkidle 超时，继续尝试...');
    });

    if (platform === 'notion') {
      // 多种选择器，兼容不同版本 Notion 公开页面
      const notionSelectors = [
        '.notion-page-content',
        '[data-content-editable-root]',
        '[class*="layout-content"]',
        '.notion-presence-container',
        '[class*="notion-page"]',
        'main [class*="page-content"]',
        '[data-block-id]',
      ];
      await page.waitForSelector(notionSelectors.join(', '), { timeout: 30000 }).catch(() => {
        console.log('[Crawler] Notion 选择器未匹配，等待额外时间...');
      });
      // 等待页面内容充分渲染
      await page.waitForTimeout(5000);

      // 滚动页面确保所有内容（包括视频）都加载
      await autoScroll(page);
      // 等待视频元素出现（Notion 视频懒加载）
      await page.waitForSelector('video, [data-block-type="video"]', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(3000);
    } else {
      await page.waitForSelector(
        '[data-block-type="page"], .lark-ck-editor, [class*="docx-content"]',
        { timeout: 15000 }
      ).catch(() => {});
      await page.waitForTimeout(2000);
      // 等待视频元素加载
      await page.waitForSelector('video, [class*="is-in-video"]', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // 在浏览器上下文中将所有图片转为 base64（避免服务端 fetch 签名 URL 失败）
    await convertAllImages(page);

    // 提取视频 URL（在解析之前，趁页面还活着）
    const pageVideos = await extractVideoUrls(page);
    console.log(`[Crawler] 页面中发现 ${pageVideos.length} 个视频, 网络请求中发现 ${videoRequestUrls.length} 个视频 URL`);


    let result;

    if (platform === 'notion') {
      result = await page.evaluate((parserCode) => {
        eval(parserCode);
        return parseNotion();
      }, notionParserCode);
    } else {
      // 飞书：scrollAndCollect 会滚动页面触发虚拟滚动加载
      result = await page.evaluate(async (parserCode) => {
        eval(parserCode);
        if (typeof scrollAndCollect === 'function') {
          const sc = await scrollAndCollect();
          const title = getFeishuTitle();
          return { type: 'feishu', title, blocks: sc.blocks, links: sc.links };
        }
        return parseFeishu();
      }, feishuParserCode);

      // 飞书滚动后新加载的图片需要再次转换
      await convertAllImages(page);

      // 飞书视频需要 cookie 才能下载，提取当前 session cookies
      const feishuCookies = await context.cookies();
      const cookieStr = feishuCookies.map(c => `${c.name}=${c.value}`).join('; ');
      if (result && result.blocks) {
        for (const block of result.blocks) {
          if (block.type === 'video' && block.url && block.url.includes('feishu.cn')) {
            block._cookies = cookieStr;
          }
        }
      }
    }

    // 将 blocks 中的 blob: 图片在页面上下文中转为 base64
    if (result && result.blocks) {
      const blobUrls = result.blocks
        .filter(b => b.type === 'image' && b.url && b.url.startsWith('blob:'))
        .map(b => b.url);

      if (blobUrls.length > 0) {
        console.log(`[Crawler] 转换 ${blobUrls.length} 个 blob 图片...`);
        const converted = await page.evaluate(async (urls) => {
          const results = {};
          for (const blobUrl of urls) {
            try {
              const resp = await fetch(blobUrl, { credentials: 'include' });
              if (!resp.ok) continue;
              const blob = await resp.blob();
              const reader = new FileReader();
              const dataUrl = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              results[blobUrl] = dataUrl;
            } catch (e) {
              // blob 可能已失效，尝试从 DOM 中找到对应 img 用 canvas 转换
              try {
                const img = document.querySelector(`img[src="${blobUrl}"]`) ||
                            document.querySelector(`img[currentSrc="${blobUrl}"]`);
                if (img && img.complete && img.naturalWidth > 0) {
                  const canvas = document.createElement('canvas');
                  canvas.width = img.naturalWidth;
                  canvas.height = img.naturalHeight;
                  canvas.getContext('2d').drawImage(img, 0, 0);
                  results[blobUrl] = canvas.toDataURL('image/png');
                }
              } catch (e2) {}
            }
          }
          return results;
        }, blobUrls);

        // 替换 blocks 中的 blob URL
        for (const block of result.blocks) {
          if (block.type === 'image' && block.url && converted[block.url]) {
            block.url = converted[block.url];
          }
        }
        console.log(`[Crawler] 成功转换 ${Object.keys(converted).length}/${blobUrls.length} 个 blob 图片`);
      }
    }

    // 后处理：修复视频和图片 URL
    if (result && result.blocks) {
      let videoIndex = 0;
      for (const block of result.blocks) {
        // 修复图片相对路径
        if (block.type === 'image' && block.url) {
          if (block.url.startsWith('/')) {
            const base = new URL(url);
            block.url = base.origin + block.url;
          }
        }

        // 修复视频 URL：如果 parser 没拿到有效 URL，从页面提取和网络请求中补充
        if (block.type === 'video') {
          const hasValidUrl = block.url && block.url.startsWith('http') && !block.url.startsWith('blob:');

          if (!hasValidUrl) {
            // 优先用页面提取到的视频 URL
            if (pageVideos[videoIndex]) {
              block.url = pageVideos[videoIndex].url;
              if (!block.thumbnailUrl && pageVideos[videoIndex].poster) {
                block.thumbnailUrl = pageVideos[videoIndex].poster;
              }
            }
            // 其次用网络请求中捕获的视频 URL
            else if (videoRequestUrls[videoIndex]) {
              block.url = videoRequestUrls[videoIndex];
            }
          }

          // 确保缩略图也有有效 URL
          if (!block.thumbnailUrl || block.thumbnailUrl.startsWith('blob:')) {
            if (pageVideos[videoIndex] && pageVideos[videoIndex].poster) {
              block.thumbnailUrl = pageVideos[videoIndex].poster;
            }
          }

          console.log(`[Crawler] 视频 #${videoIndex}: url=${(block.url || '').slice(0, 80)}...`);
          videoIndex++;
        }
      }
    }

    console.log(`[Crawler] 解析完成: ${result.title || '无标题'}, ${result.blocks?.length || 0} 个块`);
    return result;
  } finally {
    await context.close();
  }
}

// 自动滚动页面，触发懒加载内容
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          window.scrollTo(0, 0);
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = { crawl, closeBrowser };
