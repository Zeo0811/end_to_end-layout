// 抓取一篇已群发的公众号文章
//
// 个人主体的公众号拿不到「发布能力」接口权限（48001），freepublish
// 读不到已发布列表。但文章页本身是公开的：只要有永久链接，标题、封面、
// 发布时间、正文都能从页面里解析出来。
//
// 这是增量更新那条路 —— 在微信后台群发之后，把链接贴回来即可入库。

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49';

// chksm 必须保留 —— 实测去掉它 mp 只返回一段 JS 壳（约 3.5KB），拿不到正文；
// 带上才是完整页面。scene / sessionid 这类跟踪参数每次分享都不同，必须清掉，
// 否则同一篇文章会因 url 不同被当成两篇，幂等就失效了。
const KEEP_PARAMS = ['__biz', 'mid', 'idx', 'sn', 'chksm'];

function canonicalUrl(raw) {
  const trimmed = String(raw || '').trim().replace(/&amp;/g, '&');
  if (!/^https?:\/\/mp\.weixin\.qq\.com\/s/.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);

    // 短链 /s/<hash>：从微信「复制链接」拿到的就是这种，也是最常见的形式。
    // 它本身已经是永久规范链接，不带参数、也不需要 chksm，
    // 去掉 ?from=... 这类跟踪参数即可。
    const short = u.pathname.match(/^\/s\/([A-Za-z0-9_-]{8,})$/);
    if (short) return `https://mp.weixin.qq.com/s/${short[1]}`;

    // 长链 /s?__biz=...：存档导出和后台复制常见这种
    const kept = [];
    for (const k of KEEP_PARAMS) {
      const v = u.searchParams.get(k);
      // 不用 URLSearchParams.toString()：它会把 __biz 末尾的 == 编码成 %3D%3D，
      // 微信认不出来会 302 到「未知错误」页
      if (v) kept.push(`${k}=${v}`);
    }
    if (kept.length) return `https://mp.weixin.qq.com/s?${kept.join('&')}`;

    return null;
  } catch {
    return null;
  }
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|br|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 页面里的 var msg_title = '……'.html(false) —— 单引号内可能有转义
function pickVar(html, name) {
  const m = html.match(new RegExp(`var\\s+${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`));
  return m ? m[2] : '';
}

function parseArticlePage(html) {
  const title = pickVar(html, 'msg_title')
    .replace(/\\x26nbsp;/g, ' ').replace(/\\x26amp;/g, '&')
    .replace(/\\x26quot;/g, '"').replace(/\\x26#39;/g, "'")
    .replace(/\\x26lt;/g, '<').replace(/\\x26gt;/g, '>')
    .replace(/\\/g, '').trim();

  const thumbUrl = (pickVar(html, 'msg_cdn_url') || pickVar(html, 'cdn_url')).replace(/&amp;/g, '&');

  // 发布时间：var ct = "1757059200"（秒级时间戳）
  const ctMatch = html.match(/var\s+ct\s*=\s*"?(\d{9,11})"?/);
  const publishedAt = ctMatch
    ? new Date(Number(ctMatch[1]) * 1000).toISOString().slice(0, 19).replace('T', ' ')
    : '';

  // 正文在 id="js_content" 里。从该标签的 '>' 之后切起，
  // 否则容器自己的属性（style="visibility:hidden…"）会混进正文开头。
  const tagAt = html.indexOf('id="js_content"');
  let bodyText = '';
  if (tagAt > 0) {
    const from = html.indexOf('>', tagAt);
    if (from > 0) bodyText = htmlToText(html.slice(from + 1, from + 400000));
  }

  const digest = pickVar(html, 'msg_desc').replace(/\\/g, '').trim();

  return { title, thumbUrl, publishedAt, bodyText, digest };
}

async function fetchArticle(rawUrl) {
  const url = canonicalUrl(rawUrl);
  if (!url) throw new Error('不是有效的公众号文章链接。支持两种形式：'
    + 'https://mp.weixin.qq.com/s/xxxxx 或 https://mp.weixin.qq.com/s?__biz=...&sn=...');

  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);

  const html = await res.text();
  const parsed = parseArticlePage(html);

  if (!parsed.title) {
    // 链接缺 chksm、文章已删除、或被判定为环境异常时都会走到这里
    throw new Error('页面里没找到文章标题。请确认链接完整（保留 chksm 参数）且文章未被删除');
  }
  return { url, ...parsed };
}

module.exports = { canonicalUrl, parseArticlePage, htmlToText, fetchArticle };
