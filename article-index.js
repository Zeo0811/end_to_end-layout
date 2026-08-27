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

async function syncAccount(accountName, client, { onProgress } = {}) {
  let offset = 0, total = 0, seen = 0;

  while (true) {
    const page = await client.getFreePublishList(offset, PAGE_SIZE);
    const items = page.item || [];
    if (items.length === 0) break;

    for (const it of items) {
      const news = (it.content && it.content.news_item) || [];
      // 只索引多图文的头条。次条封面和链接的可用性不稳，先不进推荐池。
      if (news[0]) {
        indexFromWechatItem(accountName, news[0], it.article_id, it.update_time);
        seen++;
      }
    }

    total = page.total_count || seen;
    offset += items.length;
    if (onProgress) onProgress(seen, total);
    if (offset >= total) break;
  }

  db.setSyncMeta(accountName, new Date().toISOString());
  console.log(`[Index] ${accountName} 同步完成，共 ${seen} 篇`);
  return { added: seen, updated: seen, total: seen };
}

module.exports = {
  htmlToText, pickThumbUrl, makeSummary, parsedToText,
  indexFromParsed, indexFromWechatItem, syncAccount,
};
