#!/usr/bin/env node
// 从本地公众号 HTML 存档批量导入历史文章到文章库。
//
// 为什么需要它：个人主体的公众号无法完成主体认证，「发布能力」接口组永远
// 返回 48001，freepublish 拿不到历史文章；永久素材接口只覆盖极少一部分。
// 本地存档带永久链接和配图，是这个账号唯一完整的历史来源。
//
// 用法：
//   node scripts/import-archive.js --user admin --pass '密码' --account '十字路口Crossing'
//
// 可选项：
//   --dir   <路径>  存档目录，默认 ~/Downloads/html
//   --api   <地址>  服务地址，默认 https://zeooo.cc
//   --limit <n>     只处理前 n 个文件（先小批量试跑）
//   --dry           只解析不上传，打印解析结果
//
// 按 url 幂等：重复跑不会产生重复行，存档更新后直接重跑即可。

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BATCH_SIZE = 50;
const BODY_LIMIT = 2000; // 上传的正文长度上限，够抽实体即可，不必传全文

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key  = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

// 存档链接带 scene / sessionid 等跟踪参数，每次导出都不同。
// 不清掉的话同一篇会因 url 不同被当成两篇，幂等失效。
//
// chksm 必须保留 —— 实测去掉它，mp 只返回一段 JS 壳（3.5KB），
// 拿不到正文；带上才是完整页面。它是内容校验码，不是跟踪参数。
const KEEP_PARAMS = ['__biz', 'mid', 'idx', 'sn', 'chksm'];

function canonicalUrl(raw) {
  try {
    const u = new URL(raw.replace(/&amp;/g, '&'));
    const kept = [];
    let biz = '', sn = '';
    for (const k of KEEP_PARAMS) {
      const v = u.searchParams.get(k);
      if (!v) continue;
      if (k === '__biz') biz = v;
      if (k === 'sn')    sn  = v;
      // 不能用 URLSearchParams.toString()：它会把 __biz 末尾的 == 编码成
      // %3D%3D，微信认不出来会 302 到「未知错误」页，卡片链接就点不开了
      kept.push(`${k}=${v}`);
    }
    if (!biz || !sn) return null;
    return `https://mp.weixin.qq.com/s?${kept.join('&')}`;
  } catch {
    return null;
  }
}

function htmlToText(html) {
  return String(html || '')
    // 存档在 body 内还有第二个 style 块，不剥掉会把 CSS 当成正文
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|br|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseArchive(file) {
  const html = fs.readFileSync(file, 'utf8');

  // 头部有 var data={...}，带公众号名、标题、发布时间
  let meta = {};
  const metaMatch = html.match(/var\s+data\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (metaMatch) { try { meta = JSON.parse(metaMatch[1]); } catch {} }

  const urlMatch = html.match(/https:\/\/mp\.weixin\.qq\.com\/s\?[^"'\s<]+/);
  const url = urlMatch ? canonicalUrl(urlMatch[0]) : null;
  if (!url) return { file, skip: 'no-url' };

  const title = String(meta.title || '').trim()
    || (html.match(/<title>([^<]*)<\/title>/) || [])[1]?.replace(/^\d{4}-\d{2}-\d{2}_/, '').trim()
    || '';
  if (!title) return { file, skip: 'no-title' };

  // 封面：正文第一张 mmbiz 图。存档里没有真正的公众号封面图字段。
  const imgMatch = html.match(/src="(https:\/\/mmbiz[^"]+)"/);
  const thumbUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';

  // 正文：整个 <body>。存档的 <style> 全在 head 里，从 body 切起就不会
  // 把样式表当成正文（早先按 class 名切，切点落在 style 块中间，
  // 开标签被切掉，剥标签正则失效，正文全变成 CSS）。
  const bStart = html.indexOf('<body');
  const bEnd   = html.lastIndexOf('</body>');
  const seg    = bStart >= 0 ? html.slice(bStart, bEnd > bStart ? bEnd : undefined) : html;

  // 去掉标题行和作者/时间那条 meta，它们不该重复进正文
  const cleaned = seg
    .replace(/<h1[^>]*rich_media_title[\s\S]*?<\/h1>/i, ' ')
    .replace(/<div[^>]*rich_media_meta_list[\s\S]*?<\/div>/i, ' ');

  const bodyText = htmlToText(cleaned).slice(0, BODY_LIMIT);

  const publishedAt = String(meta.time || '').trim()
    || (path.basename(file).match(/^(\d{4}-\d{2}-\d{2})/) || [])[1]
    || '';

  return { title, url, thumbUrl, bodyText, publishedAt, mp: meta.mp || '' };
}

async function main() {
  const args = parseArgs(process.argv);
  const dir  = args.dir || path.join(os.homedir(), 'Downloads/html');
  const api  = String(args.api || 'https://zeooo.cc').replace(/\/$/, '');

  if (!fs.existsSync(dir)) {
    console.error(`存档目录不存在: ${dir}`);
    process.exit(1);
  }

  let files = fs.readdirSync(dir).filter(f => f.endsWith('.html')).sort().map(f => path.join(dir, f));
  if (args.limit) files = files.slice(0, Number(args.limit));
  console.log(`扫描到 ${files.length} 个存档文件`);

  const parsed = [], skipped = [];
  for (const f of files) {
    const a = parseArchive(f);
    if (a.skip) skipped.push(a);
    else parsed.push(a);
  }

  // 同一篇可能被存档多次，按 url 去重保留最后一次
  const byUrl  = new Map(parsed.map(a => [a.url, a]));
  const unique = [...byUrl.values()];

  console.log(`解析成功 ${parsed.length} 篇，去重后 ${unique.length} 篇，跳过 ${skipped.length} 篇`);
  const noCover = unique.filter(a => !a.thumbUrl).length;
  if (noCover) console.log(`其中 ${noCover} 篇没抓到封面，导入后不会出现在推荐里`);
  const thin = unique.filter(a => a.bodyText.length < 100).length;
  if (thin) console.log(`其中 ${thin} 篇正文不足 100 字，匹配精度会偏低`);

  if (args.dry) {
    console.log('\n--dry 模式，抽 3 篇看解析结果：\n');
    for (const a of [unique[0], unique[Math.floor(unique.length / 2)], unique[unique.length - 1]].filter(Boolean)) {
      console.log(`标题: ${a.title}`);
      console.log(`链接: ${a.url}`);
      console.log(`封面: ${a.thumbUrl ? a.thumbUrl.slice(0, 80) + '…' : '(无)'}`);
      console.log(`时间: ${a.publishedAt}`);
      console.log(`正文: ${a.bodyText.slice(0, 100).replace(/\n/g, ' ')}…（共 ${a.bodyText.length} 字）`);
      console.log('');
    }
    return;
  }

  if (!args.user || !args.pass || !args.account) {
    console.error('\n缺少参数，需要 --user --pass --account，例如：');
    console.error(`  node scripts/import-archive.js --user admin --pass '你的密码' --account '十字路口Crossing'`);
    process.exit(1);
  }

  const loginRes = await fetch(`${api}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: args.user, password: args.pass }),
  });
  const login = await loginRes.json();
  if (!login.token) {
    console.error('登录失败:', login.error || JSON.stringify(login));
    process.exit(1);
  }
  console.log('登录成功，开始导入…');

  let imported = 0, skip2 = 0, failed = 0;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${api}/api/import-articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + login.token },
      body: JSON.stringify({ accountName: args.account, articles: batch }),
    });
    const data = await res.json();
    if (data.error) {
      console.error(`第 ${Math.floor(i / BATCH_SIZE) + 1} 批失败:`, data.error);
      process.exit(1);
    }
    imported += data.imported; skip2 += data.skipped; failed += data.failed;
    console.log(`  ${Math.min(i + BATCH_SIZE, unique.length)}/${unique.length} … 累计导入 ${imported}`);
    if (data.errors?.length) for (const e of data.errors) console.warn('    ', e);
  }

  console.log(`\n完成：导入 ${imported} 篇，跳过 ${skip2} 篇，失败 ${failed} 篇`);
  console.log('去 zeooo.cc 后台「文章库」看可推荐篇数。');
}

main().catch(e => { console.error(e); process.exit(1); });
