// 推荐相关性计算 —— 纯函数，不碰 DB、网络、浏览器
//
// 召回是硬门槛：必须与当前文章共享至少一个「有区分度」的实体。
// 没有共享实体的一律不出现，不做主题相似度兜底。
// bigram 只在已召回的候选之间决定排序先后。

const { DICT, STOPWORDS } = require('./entity-dict');

const DF_RATIO_MAX   = 0.15; // 出现在超过 15% 文章里的实体没有区分度
const DF_MIN_SAMPLE  = 50;   // 文章数低于此值时 df 统计不可信
const BIGRAM_WEIGHT  = 0.3;  // bigram 在总分里的占比，只影响排序

function extractEntities(title, bodyText) {
  const ent = {};

  function bump(raw, weight) {
    if (!raw) return;
    // 去掉尾部标点，如 "Cursor." → "cursor"
    const key = String(raw).replace(/[.+\-]+$/, '').toLowerCase().trim();
    if (key.length < 2) return;
    ent[key] = Math.max(ent[key] || 0, weight);
  }

  function scan(text, weight) {
    if (!text) return;
    // 英文/数字混合的专有名词
    for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9.+\-]{1,}/g)) bump(m[0], weight);
    // 书名号与直角引号内的短串，常是产品名或作品名
    for (const m of text.matchAll(/[《「]([^》」]{2,12})[》」]/g)) bump(m[1], weight);
    // 中文词典命中
    for (const d of DICT) if (text.includes(d)) bump(d, weight);
  }

  scan(title, 3);
  const paras = String(bodyText || '').split(/\n+/).filter(p => p.trim());
  scan(paras[0] || '', 2);
  scan(paras.slice(1).join('\n'), 1);
  return ent;
}

function bigramSet(text) {
  const clean = String(text || '').replace(/\s+/g, '').toLowerCase();
  const set = new Set();
  for (let i = 0; i + 2 <= clean.length; i++) set.add(clean.slice(i, i + 2));
  return set;
}

function bigramCosine(a, b) {
  const A = bigramSet(a), B = bigramSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / Math.sqrt(A.size * B.size);
}

function isDiscriminative(entity, docFreq, totalDocs) {
  if (STOPWORDS.has(entity)) return false;
  // 样本太小时 df 比例没有意义，只靠停用词表挡
  if (totalDocs < DF_MIN_SAMPLE) return true;
  return ((docFreq[entity] || 0) / totalDocs) < DF_RATIO_MAX;
}

function idf(entity, docFreq, totalDocs) {
  return Math.log(Math.max(totalDocs, 1) / (1 + (docFreq[entity] || 0))) + 1;
}

function recommend({ current, candidates, docFreq = {}, totalDocs = 0, limit = 8 }) {
  const curEnt = current.entities || {};
  // 只保留有区分度的实体作为召回依据
  const keys = Object.keys(curEnt).filter(e => isDiscriminative(e, docFreq, totalDocs));
  if (keys.length === 0) return [];

  const scored = [];
  for (const c of candidates) {
    if (!c.url) continue;
    if (current.url       && c.url       === current.url)       continue;
    if (current.sourceUrl && c.sourceUrl === current.sourceUrl) continue;

    const cEnt = c.entities || {};
    const shared = keys.filter(e => cEnt[e] > 0);
    if (shared.length === 0) continue; // 硬门槛

    let score = 0;
    for (const e of shared) score += curEnt[e] * cEnt[e] * idf(e, docFreq, totalDocs);
    score += BIGRAM_WEIGHT * bigramCosine(current.summaryText, c.summaryText);

    scored.push({
      id: c.id, title: c.title, url: c.url, thumbUrl: c.thumbUrl,
      publishedAt: c.publishedAt, score, sharedEntities: shared,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
  });
  return scored.slice(0, limit);
}

module.exports = { extractEntities, bigramSet, bigramCosine, isDiscriminative, recommend };
