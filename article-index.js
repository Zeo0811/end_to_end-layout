// 文章库 —— 从微信同步已群发文章，以及建草稿时写 pending 记录
//
// 两条写入路径：
//   1. indexFromParsed     建草稿后调用，数据质量最高（crawler 刚吐出结构化内容）
//   2. indexFromWechatItem 同步时调用，命中 pending 就回填 url 并转 published
//
// 只有 published 且 url 非空的文章会进推荐池，所以永不产生死链。

const db = require('./db');
const { extractEntities } = require('./recommender');

const SUMMARY_LEN = 800;
const PAGE_SIZE   = 20;
const MAX_PAGES   = 500;  // 安全阀：最多 1 万篇，防止服务端行为异常时空转

function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|br|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 封面图三级兜底：thumb_url → 正文第一张图 → 空
// （material/get_material 那条路留到实测确认前两条都不通时再加）
function pickThumbUrl(newsItem) {
  if (newsItem.thumb_url) return newsItem.thumb_url;
  const m = String(newsItem.content || '').match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : '';
}

function makeSummary(title, bodyText) {
  return `${title || ''} ${String(bodyText || '').slice(0, SUMMARY_LEN)}`.trim();
}

// crawl 结果里只有这些块承载正文语义
const TEXT_BLOCKS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'paragraph', 'quote', 'callout', 'bulleted_list_item', 'numbered_list_item', 'toggle',
]);

function parsedToText(parsed) {
  const out = [];
  for (const b of (parsed && parsed.blocks) || []) {
    if (!b || !TEXT_BLOCKS.has(b.type)) continue;
    const t = String(b.content || '').replace(/​/g, '').trim();
    if (t) out.push(t);
    for (const item of b.items || []) {
      const it = String(item.content || item || '').trim();
      if (it) out.push(it);
    }
  }
  return out.join('\n');
}

function indexFromParsed({ accountName, title, mediaId, sourceUrl, parsed }) {
  const bodyText = parsedToText(parsed);
  const id = db.upsertArticle({
    accountName, title, mediaId, sourceUrl,
    status: 'pending', bodyText,
    summaryText: makeSummary(title, bodyText),
  });
  db.setArticleEntities(id, extractEntities(title, bodyText));
  return id;
}

function indexFromWechatItem(accountName, newsItem, articleId, updateTime) {
  const title    = newsItem.title || '未命名';
  const pending  = db.findPendingByTitle(accountName, title);
  const thumbUrl = pickThumbUrl(newsItem);
  const publishedAt = updateTime
    ? new Date(updateTime * 1000).toISOString().slice(0, 19).replace('T', ' ')
    : '';

  // 命中 pending：只回填链接类字段，保留 crawler 抽出的高质量正文和实体
  if (pending) {
    db.upsertArticle({
      id: pending.id, // 必须显式指定，否则按空 url 查不到会误插新行
      accountName, title, digest: newsItem.digest || '',
      url: newsItem.url || '', thumbUrl, articleId,
      mediaId: pending.media_id, sourceUrl: pending.source_url,
      status: 'published', publishedAt,
    });
    return pending.id;
  }

  // 后台直接写的文章：正文从微信 HTML 反解
  const bodyText = htmlToText(newsItem.content);
  const id = db.upsertArticle({
    accountName, title, digest: newsItem.digest || '',
    url: newsItem.url || '', thumbUrl, articleId,
    status: 'published', bodyText,
    summaryText: makeSummary(title, bodyText), publishedAt,
  });
  db.setArticleEntities(id, extractEntities(title, bodyText));
  return id;
}

// 选一个能用的文章来源。
// 「发布能力」(freepublish) 拿到的数据最全，但不少号没开这个权限，会回 48001。
// 那就退到「素材管理」(material)，权限组不同，很多号只有后者。
// 两个都不通就抛错，让用户去公众平台看接口权限。
async function pickArticleSource(accountName, client) {
  try {
    await client.getFreePublishList(0, 1);
    return { name: 'freepublish', fetch: (o, c) => client.getFreePublishList(o, c) };
  } catch (e) {
    if (!/\[48001\]/.test(e.message)) throw e;
    console.log(`[Index] ${accountName} 无「发布能力」权限，改用永久素材接口`);
  }

  try {
    await client.getMaterialNewsList(0, 1);
    return { name: 'material', fetch: (o, c) => client.getMaterialNewsList(o, c) };
  } catch (e) {
    if (/\[48001\]/.test(e.message)) {
      throw new Error('该公众号既没有「发布能力」也没有「素材管理」接口权限，无法自动拉取历史文章。请到公众平台 → 设置与开发 → 接口权限 查看这两项');
    }
    throw e;
  }
}

async function syncAccount(accountName, client, { onProgress } = {}) {
  const source = await pickArticleSource(accountName, client);
  let offset = 0, seen = 0, pages = 0, reported = 0;

  while (true) {
    const page  = await source.fetch(offset, PAGE_SIZE);
    const items = page.item || [];
    if (items.length === 0) break;

    for (const it of items) {
      // 多图文里每一篇都自带独立的 url 和正文，全部索引。
      // 素材接口用 media_id 标识，发布接口用 article_id，取到哪个算哪个。
      const stamp = it.article_id || it.media_id || '';
      for (const news of (it.content && it.content.news_item) || []) {
        if (!news) continue;
        indexFromWechatItem(accountName, news, stamp, it.update_time);
        seen++;
      }
    }

    pages++;
    offset += items.length;
    reported = page.total_count || reported;
    if (onProgress) onProgress(seen, reported);
    console.log(`[Index] ${accountName} 第 ${pages} 页：素材 ${items.length} 条，累计文章 ${seen} 篇，微信侧声称共 ${page.total_count ?? '未知'} 条`);

    // 终止条件不依赖 total_count —— 素材接口有时不返回或返回 0，
    // 只靠它判断会在第一页就停住（正好卡在 PAGE_SIZE 篇）。
    // 以「本页取回数量不足一页」为准，另加一道安全阀防止服务端行为异常时空转。
    if (items.length < PAGE_SIZE) break;
    if (pages >= MAX_PAGES) {
      console.warn(`[Index] ${accountName} 已达 ${MAX_PAGES} 页上限，停止翻页`);
      break;
    }
  }

  db.setSyncMeta(accountName, new Date().toISOString());
  console.log(`[Index] ${accountName} 同步完成（来源 ${source.name}），共 ${seen} 篇文章 / ${pages} 页`);
  return { added: seen, updated: seen, total: seen, pages, remoteTotal: reported, source: source.name };
}

module.exports = {
  htmlToText, pickThumbUrl, makeSummary, parsedToText,
  indexFromParsed, indexFromWechatItem, syncAccount,
};
