# 文末「推荐阅读」板块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布文章时，自动从历史已发布文章中找出讲同一个对象的文章，用户确认后在文末生成「封面图 + 标题」合成卡片，点击跳转。

**Architecture:** 发布流程拆成 `/api/prepare`（爬取 + 排版 + 算候选）和 `/api/publish`（合图 + 追加 + 建草稿）两段，中间用带 TTL 的内存缓存保存 `parsed` 结果，避免重复爬取。匹配采用纯本地实体召回：共享具体实体才进候选，泛词按文档频率自动剔除，无命中则整个板块不出现。卡片复用 crawler 的常驻 chromium 截图，以 base64 data URI 塞进正文，由现有 `processHtmlImages()` 自动上传到微信。

**Tech Stack:** Node 18+、Express 4、better-sqlite3、Playwright（chromium 已常驻）、`node --test` + `node:assert`。零新增 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-08-26-recommended-reading-design.md`

## Global Constraints

- **零新增 npm 依赖。** 不引入 sharp、node-canvas、分词库、embedding SDK。
- **宁缺毋滥。** 没有共享实体就不出候选，整个板块不渲染。不设固定推荐篇数，不做主题相似度兜底。
- **只推 `status = 'published'` 且 `url` 非空的文章。** 永不产生死链。
- **多账号隔离。** 推荐只在同一个 `account_name` 内进行。
- **正文样式沿用现有 token**：微信默认字体栈、15px、`rgb(51,51,51)`、字距 `0.034em`、块间距 `30px`、品牌绿 `#327848`。
- **候选返回上限 8 篇**，防止高频实体一次刷出几十条。这是选项上限，不是推荐篇数。
- **df 阈值 0.15**；文章总数 < 50 时改用手工停用词表兜底。
- **prepare 缓存 TTL 15 分钟，最多 20 条**（Notion 图片签名 URL 约 1 小时过期）。
- **卡片输出 JPEG quality 88**，宽 750px，封面区 750×319（2.35:1），`deviceScaleFactor: 2`。
- 所有新代码注释与用户可见文案用中文，与现有代码一致。

## 对 Spec 的三处修正

写计划时读代码发现的，spec 里的说法需要更正：

1. **spec 说「不改 `parsers/crawler.js`」，实际必须改一行。** `crawler.js` 当前 `module.exports = { crawl, closeBrowser }`，没有暴露 `ensureBrowser`。卡片渲染要复用常驻浏览器就必须导出它。改动仅限 export 行。
2. **spec 说「不改 `formatter.js`」，实际需要小幅扩展。** `formatToWechat()` 把全文包在 `<section style="${S.wrapper}">…</section>` 里，推荐板块若追加在返回值之后会落在 wrapper 外面，丢掉基础字体和字色。改为 `formatToWechat(parsedData, options)`，`options.appendHtml` 插入在闭合标签之前。同时 `buildRecommendBlock()` 放在 `formatter.js`，因为它需要 `S` 里的样式 token。
3. **spec 说「不改 `wechat-api.js`」，实际需要新增一个方法。** 同步文章库要调 `freepublish/batchget`，现有 client 没有这个方法，在 `createClient` 里新增 `getFreePublishList(offset, count)`。

## File Structure

**新建：**

| 文件 | 职责 |
|---|---|
| `recommender.js` | 实体抽取、bigram 相似度、召回与打分。**纯函数**，不碰 DB、不碰网络、不碰浏览器 |
| `entity-dict.js` | 中文专名词典（产品/公司/人名）与停用词表，纯数据 |
| `article-index.js` | 文章库读写、从微信同步、pending 回填对账 |
| `card-renderer.js` | 封面图抓取、卡片 HTML 模板、playwright 截图 |
| `test/recommender.test.js` | Task 1 单测 |
| `test/article-index.test.js` | Task 2、3 单测 |
| `test/card-renderer.test.js` | Task 4 集成测试 |
| `test/formatter-recommend.test.js` | Task 5 单测 |

**修改：**

| 文件 | 改动 |
|---|---|
| `db.js` | 新增 `articles` / `article_entities` 两表及 CRUD |
| `parsers/crawler.js` | export 行新增 `ensureBrowser` |
| `formatter.js` | `formatToWechat` 加 `options.appendHtml`；新增 `buildRecommendBlock` |
| `wechat-api.js` | `createClient` 新增 `getFreePublishList` |
| `server.js` | 新增 `/api/prepare`、`/api/sync-articles`、`/api/index-stats`；改造 `/api/publish`；启动与定时同步 |
| `public/index.html` | 发布流程加候选选择步骤 |
| `public/admin.html` | 「同步文章库」按钮与索引状态 |
| `nixpacks.toml` | 加中文字体包 |
| `package.json` | 加 `"test": "node --test"` |

**依赖顺序：** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。Task 1、4、5 之间无依赖，可并行。

---

### Task 1: 实体抽取与推荐打分（纯函数）

整个功能的算法核心。纯函数、无副作用、无依赖，最好测，先做。

**Files:**
- Create: `entity-dict.js`
- Create: `recommender.js`
- Create: `test/recommender.test.js`
- Modify: `package.json`（加 test script）

**Interfaces:**
- Consumes: 无
- Produces:
  - `extractEntities(title, bodyText) → { [entity: string]: number }` 权重 3=标题 / 2=正文首段 / 1=正文其余，同一实体取最大值不累加
  - `bigramCosine(a: string, b: string) → number` 0..1
  - `isDiscriminative(entity, docFreq, totalDocs) → boolean`
  - `recommend({ current, candidates, docFreq, totalDocs, limit }) → Array<{ id, title, url, thumbUrl, score, sharedEntities }>`
    - `current`: `{ entities, summaryText, url, sourceUrl }`
    - `candidates[]`: `{ id, title, url, thumbUrl, entities, summaryText, publishedAt }`
    - `entities` 一律是普通对象（可 JSON 序列化），不是 Map
  - `entity-dict.js` 导出 `{ DICT: string[], STOPWORDS: Set<string> }`

- [ ] **Step 1: 建 `entity-dict.js`**

```js
// 中文专名词典与停用词表
// 中文没有分词器，专名只能靠词典命中。词典是给中文用的，
// 英文产品名走正则抽取，不需要登记在这里。

const DICT = [
  // 大模型与厂商
  '豆包', '通义', '千问', '文心', '混元', '星火', '盘古',
  '月之暗面', 'Kimi', '智谱', '面壁', '阶跃星辰', '深度求索',
  // 应用与工具
  '扣子', '即梦', '可灵', '海螺', '秘塔', '纳米搜索',
  // 公司
  '字节跳动', '阿里巴巴', '腾讯', '百度', '美团', '小红书',
  '快手', '哔哩哔哩', '商汤', '旷视',
];

// 冷启动兜底停用词。文章数 < 50 时 df 统计不稳，用它挡掉泛词。
// 文章数够了之后 df 过滤会接管，但这张表始终生效（两个条件同时判）。
const STOPWORDS = new Set([
  'ai', 'app', 'api', 'ios', 'android', 'web', 'http', 'https',
  'com', 'cn', 'net', 'org', 'www', 'html', 'css', 'js',
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'are',
  'llm', 'agent', 'gpt', 'model', 'chat', 'pro', 'max', 'plus',
  'ceo', 'cto', 'ui', 'ux', 'sdk', 'saas', 'pc', 'vr', 'ar',
]);

module.exports = { DICT, STOPWORDS };
```

- [ ] **Step 2: 写失败的测试**

Create `test/recommender.test.js`:

```js
const { test } = require('node:test');
const assert   = require('node:assert');
const {
  extractEntities, bigramCosine, isDiscriminative, recommend,
} = require('../recommender');

test('extractEntities: 标题里的英文产品名权重 3', () => {
  const e = extractEntities('Cursor 2.0 实测', '');
  assert.strictEqual(e.cursor, 3);
});

test('extractEntities: 正文首段权重 2，其余段权重 1', () => {
  const e = extractEntities('标题', 'Manus 很好用\n\n后来我们又试了 Devin');
  assert.strictEqual(e.manus, 2);
  assert.strictEqual(e.devin, 1);
});

test('extractEntities: 同一实体取最大权重，不累加', () => {
  const e = extractEntities('聊聊 Cursor', 'Cursor 挺好\n\nCursor 又更新了');
  assert.strictEqual(e.cursor, 3);
});

test('extractEntities: 归一化小写并去掉尾部标点', () => {
  const e = extractEntities('我们用了 Cursor.', '');
  assert.strictEqual(e.cursor, 3);
  assert.strictEqual(e['cursor.'], undefined);
});

test('extractEntities: 命中中文词典', () => {
  const e = extractEntities('豆包更新了', '');
  assert.strictEqual(e['豆包'], 3);
});

test('extractEntities: 抽取书名号与直角引号内的短串', () => {
  const e = extractEntities('体验《原神》', '还有「小红书」');
  assert.strictEqual(e['原神'], 3);
  assert.strictEqual(e['小红书'], 2);
});

test('extractEntities: 单字符不算实体', () => {
  const e = extractEntities('A B C', '');
  assert.deepStrictEqual(e, {});
});

test('bigramCosine: 完全相同为 1，完全不同为 0', () => {
  assert.strictEqual(bigramCosine('人工智能', '人工智能'), 1);
  assert.strictEqual(bigramCosine('人工智能', '足球比赛'), 0);
});

test('bigramCosine: 空串返回 0', () => {
  assert.strictEqual(bigramCosine('', '人工智能'), 0);
});

test('bigramCosine: 部分重合落在 0 和 1 之间', () => {
  const s = bigramCosine('我们测评了编程工具', '我们测评了绘画工具');
  assert.ok(s > 0 && s < 1, `期望 0<s<1，实际 ${s}`);
});

test('isDiscriminative: 停用词永远不算', () => {
  assert.strictEqual(isDiscriminative('ai', { ai: 1 }, 1000), false);
});

test('isDiscriminative: df 超过 15% 的词被剔除', () => {
  assert.strictEqual(isDiscriminative('openai', { openai: 200 }, 1000), false);
  assert.strictEqual(isDiscriminative('cursor', { cursor: 30 },  1000), true);
});

test('isDiscriminative: 文章数不足 50 时只看停用词表', () => {
  // df 比例 50%，但样本太小不可信，应放行
  assert.strictEqual(isDiscriminative('cursor', { cursor: 5 }, 10), true);
  assert.strictEqual(isDiscriminative('ai',     { ai: 5 },     10), false);
});

test('recommend: 没有共享实体时返回空数组', () => {
  const out = recommend({
    current:    { entities: { cursor: 3 }, summaryText: '讲 Cursor', url: '', sourceUrl: '' },
    candidates: [{ id: 1, title: '讲 Sora', url: 'https://mp/1', thumbUrl: 't', entities: { sora: 3 }, summaryText: '讲 Sora', publishedAt: '2026-01-01' }],
    docFreq: { cursor: 1, sora: 1 }, totalDocs: 100, limit: 8,
  });
  assert.deepStrictEqual(out, []);
});

test('recommend: 共享实体的候选被选中并带出 sharedEntities', () => {
  const out = recommend({
    current:    { entities: { cursor: 3 }, summaryText: '讲 Cursor', url: '', sourceUrl: '' },
    candidates: [{ id: 1, title: '旧的 Cursor 文', url: 'https://mp/1', thumbUrl: 't', entities: { cursor: 3 }, summaryText: '讲 Cursor', publishedAt: '2026-01-01' }],
    docFreq: { cursor: 10 }, totalDocs: 1000, limit: 8,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 1);
  assert.deepStrictEqual(out[0].sharedEntities, ['cursor']);
});

test('recommend: 只共享泛词的候选不算相关', () => {
  const out = recommend({
    current:    { entities: { ai: 3, cursor: 1 }, summaryText: 'x', url: '', sourceUrl: '' },
    candidates: [{ id: 1, title: 'AI 泛文', url: 'https://mp/1', thumbUrl: 't', entities: { ai: 3 }, summaryText: 'y', publishedAt: '2026-01-01' }],
    docFreq: { ai: 900, cursor: 5 }, totalDocs: 1000, limit: 8,
  });
  assert.deepStrictEqual(out, []);
});

test('recommend: 排除自己（url 或 sourceUrl 相同）', () => {
  const base = { entities: { cursor: 3 }, summaryText: 'x', publishedAt: '2026-01-01', thumbUrl: 't' };
  const out = recommend({
    current: { entities: { cursor: 3 }, summaryText: 'x', url: 'https://mp/1', sourceUrl: 'https://notion/a' },
    candidates: [
      { id: 1, title: '同 url',       url: 'https://mp/1', sourceUrl: 'https://notion/z', ...base },
      { id: 2, title: '同 sourceUrl', url: 'https://mp/2', sourceUrl: 'https://notion/a', ...base },
      { id: 3, title: '别的',         url: 'https://mp/3', sourceUrl: 'https://notion/c', ...base },
    ],
    docFreq: { cursor: 5 }, totalDocs: 1000, limit: 8,
  });
  assert.deepStrictEqual(out.map(x => x.id), [3]);
});

test('recommend: 共享实体越多分数越高，排在前面', () => {
  const out = recommend({
    current: { entities: { cursor: 3, manus: 3 }, summaryText: 'x', url: '', sourceUrl: '' },
    candidates: [
      { id: 1, title: '只共享一个', url: 'https://mp/1', thumbUrl: 't', entities: { cursor: 3 },            summaryText: 'x', publishedAt: '2026-01-01' },
      { id: 2, title: '共享两个',   url: 'https://mp/2', thumbUrl: 't', entities: { cursor: 3, manus: 3 },  summaryText: 'x', publishedAt: '2026-01-01' },
    ],
    docFreq: { cursor: 5, manus: 5 }, totalDocs: 1000, limit: 8,
  });
  assert.deepStrictEqual(out.map(x => x.id), [2, 1]);
});

test('recommend: 同分时新文章优先', () => {
  const base = { entities: { cursor: 3 }, summaryText: 'x', thumbUrl: 't' };
  const out = recommend({
    current: { entities: { cursor: 3 }, summaryText: 'x', url: '', sourceUrl: '' },
    candidates: [
      { id: 1, title: '旧', url: 'https://mp/1', publishedAt: '2025-01-01', ...base },
      { id: 2, title: '新', url: 'https://mp/2', publishedAt: '2026-06-01', ...base },
    ],
    docFreq: { cursor: 5 }, totalDocs: 1000, limit: 8,
  });
  assert.deepStrictEqual(out.map(x => x.id), [2, 1]);
});

test('recommend: 结果数量不超过 limit', () => {
  const candidates = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, title: `文 ${i}`, url: `https://mp/${i}`, thumbUrl: 't',
    entities: { cursor: 3 }, summaryText: 'x', publishedAt: '2026-01-01',
  }));
  const out = recommend({
    current: { entities: { cursor: 3 }, summaryText: 'x', url: '', sourceUrl: '' },
    candidates, docFreq: { cursor: 5 }, totalDocs: 1000, limit: 8,
  });
  assert.strictEqual(out.length, 8);
});

test('recommend: 没有 url 的候选被排除', () => {
  const out = recommend({
    current: { entities: { cursor: 3 }, summaryText: 'x', url: '', sourceUrl: '' },
    candidates: [{ id: 1, title: '没链接', url: '', thumbUrl: 't', entities: { cursor: 3 }, summaryText: 'x', publishedAt: '2026-01-01' }],
    docFreq: { cursor: 5 }, totalDocs: 1000, limit: 8,
  });
  assert.deepStrictEqual(out, []);
});
```

- [ ] **Step 3: 加 test script 并运行，确认失败**

Modify `package.json` 的 `scripts`，改成：

```json
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
```

Run: `cd ~/end_to_end-layout && npm test`
Expected: FAIL，报 `Cannot find module '../recommender'`

- [ ] **Step 4: 实现 `recommender.js`**

```js
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
```

- [ ] **Step 5: 运行测试，确认全绿**

Run: `cd ~/end_to_end-layout && npm test`
Expected: PASS，20 个测试全过

- [ ] **Step 6: 提交**

```bash
cd ~/end_to_end-layout
git add recommender.js entity-dict.js test/recommender.test.js package.json
git commit -m "feat: 推荐相关性算法（实体召回 + bigram 排序）"
```

---

### Task 2: 文章库数据层

**Files:**
- Modify: `db.js`
- Create: `test/article-index.test.js`

**Interfaces:**
- Consumes: 无
- Produces（`db.js` 新增导出）:
  - `upsertArticle(a) → number` 返回 article id。`a`: `{ id?, accountName, title, digest, url, thumbUrl, articleId, mediaId, sourceUrl, status, bodyText, summaryText, publishedAt }`。定位顺序：**显式 `a.id` → `url` → `accountName + mediaId`**。
    `a.id` 这条分支是回填 pending 必需的：回填时要写入 `url`，但 pending 行的 `url` 还是空的，按 `url` 查不到，会误插一条新行
  - `setArticleEntities(articleId, entities: {[k:string]:number}) → void` 全量替换
  - `getArticleEntities(articleId) → {[k:string]:number}`
  - `listPublishedArticles(accountName) → Array<{ id, title, url, thumbUrl, sourceUrl, summaryText, publishedAt, entities }>`
  - `getEntityDocFreq(accountName) → { docFreq: {[k:string]:number}, totalDocs: number }`
  - `findPendingByTitle(accountName, title) → row | undefined`
  - `getIndexStats(accountName) → { total, published, pending, lastSyncedAt }`
  - `setSyncMeta(accountName, isoString) → void` / `getSyncMeta(accountName) → string|null`

- [ ] **Step 1: 写失败的测试**

Create `test/article-index.test.js`:

```js
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

// db.js 在 require 时就打开数据库，必须先设好路径
const tmpDb = path.join(os.tmpdir(), `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.DATABASE_PATH = tmpDb;

const db = require('../db');

before(() => {
  process.on('exit', () => { try { fs.unlinkSync(tmpDb); } catch (_) {} });
});

function seed(overrides = {}) {
  return db.upsertArticle({
    accountName: '十字路口', title: '默认标题', digest: '',
    url: 'https://mp.weixin.qq.com/s/aaa', thumbUrl: 'https://img/a.jpg',
    articleId: '', mediaId: '', sourceUrl: 'https://notion.so/a',
    status: 'published', bodyText: '正文', summaryText: '默认标题 正文',
    publishedAt: '2026-01-01', ...overrides,
  });
}

test('upsertArticle: 插入后能查回来', () => {
  const id = seed({ url: 'https://mp/u1', title: '插入测试' });
  assert.ok(id > 0);
  const rows = db.listPublishedArticles('十字路口');
  assert.ok(rows.some(r => r.id === id && r.title === '插入测试'));
});

test('upsertArticle: 相同 url 更新而不是重复插入', () => {
  const id1 = seed({ url: 'https://mp/dup', title: '旧标题' });
  const id2 = seed({ url: 'https://mp/dup', title: '新标题' });
  assert.strictEqual(id1, id2);
  const row = db.listPublishedArticles('十字路口').find(r => r.id === id1);
  assert.strictEqual(row.title, '新标题');
});

test('upsertArticle: url 为空时按 accountName + mediaId 去重', () => {
  const id1 = db.upsertArticle({ accountName: 'A', title: 'p1', url: '', mediaId: 'm-1', status: 'pending' });
  const id2 = db.upsertArticle({ accountName: 'A', title: 'p2', url: '', mediaId: 'm-1', status: 'pending' });
  assert.strictEqual(id1, id2);
});

test('upsertArticle: 显式 id 时更新该行，即使传入的 url 是新的', () => {
  // 这正是回填 pending 的场景：目标行 url 为空，要写入一个新 url
  const id = db.upsertArticle({ accountName: 'B', title: '待回填', url: '', mediaId: 'm-b', status: 'pending' });
  const same = db.upsertArticle({ id, accountName: 'B', title: '待回填', url: 'https://mp/filled', status: 'published' });
  assert.strictEqual(same, id, '必须更新原行而不是新插一条');
  const rows = db.listPublishedArticles('B');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].url, 'https://mp/filled');
});

test('setArticleEntities / getArticleEntities: 全量替换', () => {
  const id = seed({ url: 'https://mp/ent' });
  db.setArticleEntities(id, { cursor: 3, manus: 1 });
  assert.deepStrictEqual(db.getArticleEntities(id), { cursor: 3, manus: 1 });
  db.setArticleEntities(id, { sora: 2 });
  assert.deepStrictEqual(db.getArticleEntities(id), { sora: 2 });
});

test('listPublishedArticles: 带出 entities，且不含 pending', () => {
  const pub = seed({ url: 'https://mp/pub', title: '已发布', status: 'published' });
  db.setArticleEntities(pub, { cursor: 3 });
  db.upsertArticle({ accountName: '十字路口', title: '草稿中', url: '', mediaId: 'm-pending', status: 'pending' });

  const rows = db.listPublishedArticles('十字路口');
  assert.ok(rows.some(r => r.id === pub));
  assert.ok(!rows.some(r => r.title === '草稿中'));
  assert.deepStrictEqual(rows.find(r => r.id === pub).entities, { cursor: 3 });
});

test('listPublishedArticles: 按账号隔离', () => {
  seed({ accountName: '甲号', url: 'https://mp/jia' });
  const rows = db.listPublishedArticles('乙号');
  assert.ok(!rows.some(r => r.url === 'https://mp/jia'));
});

test('getEntityDocFreq: 统计每个实体出现在多少篇文章里', () => {
  const acc = '统计号';
  const a = db.upsertArticle({ accountName: acc, title: 'a', url: 'https://mp/s1', status: 'published' });
  const b = db.upsertArticle({ accountName: acc, title: 'b', url: 'https://mp/s2', status: 'published' });
  db.setArticleEntities(a, { cursor: 3, ai: 1 });
  db.setArticleEntities(b, { ai: 1 });

  const { docFreq, totalDocs } = db.getEntityDocFreq(acc);
  assert.strictEqual(totalDocs, 2);
  assert.strictEqual(docFreq.ai, 2);
  assert.strictEqual(docFreq.cursor, 1);
});

test('findPendingByTitle: 只找 pending 状态的', () => {
  const acc = '回填号';
  db.upsertArticle({ accountName: acc, title: '待回填', url: '', mediaId: 'm-back', status: 'pending' });
  db.upsertArticle({ accountName: acc, title: '已完成', url: 'https://mp/done', status: 'published' });

  assert.ok(db.findPendingByTitle(acc, '待回填'));
  assert.strictEqual(db.findPendingByTitle(acc, '已完成'), undefined);
});

test('getIndexStats: 返回各状态计数', () => {
  const acc = '统计号2';
  db.upsertArticle({ accountName: acc, title: 'p', url: 'https://mp/x1', status: 'published' });
  db.upsertArticle({ accountName: acc, title: 'q', url: '', mediaId: 'm-q', status: 'pending' });
  const s = db.getIndexStats(acc);
  assert.strictEqual(s.published, 1);
  assert.strictEqual(s.pending, 1);
  assert.strictEqual(s.total, 2);
});

test('setSyncMeta / getSyncMeta: 记录上次同步时间', () => {
  assert.strictEqual(db.getSyncMeta('新号'), null);
  db.setSyncMeta('新号', '2026-08-26T10:00:00Z');
  assert.strictEqual(db.getSyncMeta('新号'), '2026-08-26T10:00:00Z');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd ~/end_to_end-layout && node --test test/article-index.test.js`
Expected: FAIL，报 `db.upsertArticle is not a function`

- [ ] **Step 3: 在 `db.js` 的建表 SQL 里追加三张表**

在 `db.exec(\`…\`)` 那段 SQL 的 `logs` 表定义之后、反引号结束之前，插入：

```sql
  CREATE TABLE IF NOT EXISTS articles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name  TEXT NOT NULL,
    title         TEXT NOT NULL,
    digest        TEXT,
    url           TEXT,
    thumb_url     TEXT,
    article_id    TEXT,
    media_id      TEXT,
    source_url    TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    body_text     TEXT,
    summary_text  TEXT,
    published_at  TEXT,
    created_at    TEXT DEFAULT (datetime('now', '+8 hours')),
    updated_at    TEXT DEFAULT (datetime('now', '+8 hours'))
  );

  CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(account_name, status);
  CREATE INDEX IF NOT EXISTS idx_articles_url    ON articles(url);
  CREATE INDEX IF NOT EXISTS idx_articles_media  ON articles(account_name, media_id);

  CREATE TABLE IF NOT EXISTS article_entities (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    entity     TEXT NOT NULL,
    weight     REAL NOT NULL DEFAULT 1,
    PRIMARY KEY (article_id, entity)
  );

  CREATE INDEX IF NOT EXISTS idx_entities ON article_entities(entity);

  CREATE TABLE IF NOT EXISTS sync_meta (
    account_name    TEXT PRIMARY KEY,
    last_synced_at  TEXT
  );
```

- [ ] **Step 4: 在 `db.js` 里加文章库 CRUD**

在 `// ── 日志 ──` 那一节之后、`module.exports` 之前插入：

```js
// ── 文章库 ──

function upsertArticle(a) {
  const acc = a.accountName;
  let existing = null;
  if (a.id) {
    // 显式指定行。回填 pending 时必须走这条：那一刻要写入 url，
    // 但 pending 行的 url 还是空的，按 url 查不到会误插新行。
    existing = db.prepare('SELECT id FROM articles WHERE id = ?').get(a.id);
  } else if (a.url) {
    existing = db.prepare('SELECT id FROM articles WHERE url = ?').get(a.url);
  } else if (a.mediaId) {
    existing = db.prepare('SELECT id FROM articles WHERE account_name = ? AND media_id = ?').get(acc, a.mediaId);
  }

  if (existing) {
    // COALESCE：新值为 null/undefined 时保留旧值，避免回填时把好数据覆盖成空
    db.prepare(`
      UPDATE articles SET
        title = COALESCE(@title, title),
        digest = COALESCE(@digest, digest),
        url = COALESCE(NULLIF(@url, ''), url),
        thumb_url = COALESCE(NULLIF(@thumbUrl, ''), thumb_url),
        article_id = COALESCE(NULLIF(@articleId, ''), article_id),
        media_id = COALESCE(NULLIF(@mediaId, ''), media_id),
        source_url = COALESCE(NULLIF(@sourceUrl, ''), source_url),
        status = COALESCE(@status, status),
        body_text = COALESCE(NULLIF(@bodyText, ''), body_text),
        summary_text = COALESCE(NULLIF(@summaryText, ''), summary_text),
        published_at = COALESCE(NULLIF(@publishedAt, ''), published_at),
        updated_at = datetime('now', '+8 hours')
      WHERE id = @id
    `).run({
      id: existing.id,
      title: a.title ?? null, digest: a.digest ?? null,
      url: a.url || '', thumbUrl: a.thumbUrl || '',
      articleId: a.articleId || '', mediaId: a.mediaId || '',
      sourceUrl: a.sourceUrl || '', status: a.status ?? null,
      bodyText: a.bodyText || '', summaryText: a.summaryText || '',
      publishedAt: a.publishedAt || '',
    });
    return existing.id;
  }

  const info = db.prepare(`
    INSERT INTO articles
      (account_name, title, digest, url, thumb_url, article_id, media_id,
       source_url, status, body_text, summary_text, published_at)
    VALUES
      (@accountName, @title, @digest, @url, @thumbUrl, @articleId, @mediaId,
       @sourceUrl, @status, @bodyText, @summaryText, @publishedAt)
  `).run({
    accountName: acc, title: a.title || '未命名', digest: a.digest || '',
    url: a.url || '', thumbUrl: a.thumbUrl || '',
    articleId: a.articleId || '', mediaId: a.mediaId || '',
    sourceUrl: a.sourceUrl || '', status: a.status || 'pending',
    bodyText: a.bodyText || '', summaryText: a.summaryText || '',
    publishedAt: a.publishedAt || '',
  });
  return info.lastInsertRowid;
}

const _replaceEntities = db.transaction((articleId, entities) => {
  db.prepare('DELETE FROM article_entities WHERE article_id = ?').run(articleId);
  const ins = db.prepare('INSERT INTO article_entities (article_id, entity, weight) VALUES (?, ?, ?)');
  for (const [entity, weight] of Object.entries(entities || {})) ins.run(articleId, entity, weight);
});

function setArticleEntities(articleId, entities) {
  _replaceEntities(articleId, entities);
}

function getArticleEntities(articleId) {
  const rows = db.prepare('SELECT entity, weight FROM article_entities WHERE article_id = ?').all(articleId);
  return Object.fromEntries(rows.map(r => [r.entity, r.weight]));
}

function listPublishedArticles(accountName) {
  const rows = db.prepare(`
    SELECT id, title, url, thumb_url AS thumbUrl, source_url AS sourceUrl,
           summary_text AS summaryText, published_at AS publishedAt
    FROM articles
    WHERE account_name = ? AND status = 'published' AND url IS NOT NULL AND url != ''
  `).all(accountName);

  const entRows = db.prepare(`
    SELECT ae.article_id AS id, ae.entity, ae.weight
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE a.account_name = ? AND a.status = 'published'
  `).all(accountName);

  const byId = new Map(rows.map(r => [r.id, { ...r, entities: {} }]));
  for (const e of entRows) {
    const row = byId.get(e.id);
    if (row) row.entities[e.entity] = e.weight;
  }
  return [...byId.values()];
}

function getEntityDocFreq(accountName) {
  const { total } = db.prepare(`
    SELECT COUNT(*) AS total FROM articles WHERE account_name = ? AND status = 'published'
  `).get(accountName);

  const rows = db.prepare(`
    SELECT ae.entity, COUNT(DISTINCT ae.article_id) AS df
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE a.account_name = ? AND a.status = 'published'
    GROUP BY ae.entity
  `).all(accountName);

  return { docFreq: Object.fromEntries(rows.map(r => [r.entity, r.df])), totalDocs: total };
}

function findPendingByTitle(accountName, title) {
  return db.prepare(`
    SELECT * FROM articles WHERE account_name = ? AND title = ? AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `).get(accountName, title);
}

function getIndexStats(accountName) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending
    FROM articles WHERE account_name = ?
  `).get(accountName);
  return {
    total: row.total || 0,
    published: row.published || 0,
    pending: row.pending || 0,
    lastSyncedAt: getSyncMeta(accountName),
  };
}

function setSyncMeta(accountName, iso) {
  db.prepare(`
    INSERT INTO sync_meta (account_name, last_synced_at) VALUES (?, ?)
    ON CONFLICT(account_name) DO UPDATE SET last_synced_at = excluded.last_synced_at
  `).run(accountName, iso);
}

function getSyncMeta(accountName) {
  const row = db.prepare('SELECT last_synced_at FROM sync_meta WHERE account_name = ?').get(accountName);
  return row ? row.last_synced_at : null;
}
```

在 `module.exports` 的对象里追加：

```js
  upsertArticle,
  setArticleEntities,
  getArticleEntities,
  listPublishedArticles,
  getEntityDocFreq,
  findPendingByTitle,
  getIndexStats,
  setSyncMeta,
  getSyncMeta,
```

- [ ] **Step 5: 运行测试，确认全绿**

Run: `cd ~/end_to_end-layout && npm test`
Expected: PASS，Task 1 的 20 个 + Task 2 的 10 个全过

- [ ] **Step 6: 提交**

```bash
cd ~/end_to_end-layout
git add db.js test/article-index.test.js
git commit -m "feat: 文章库数据层（articles / article_entities / sync_meta）"
```

---

### Task 3: 微信同步与 pending 回填

**Files:**
- Modify: `wechat-api.js`（`createClient` 新增 `getFreePublishList`）
- Create: `article-index.js`
- Modify: `test/article-index.test.js`（追加同步相关测试）

**Interfaces:**
- Consumes: Task 1 的 `extractEntities`；Task 2 的全部 db 导出
- Produces:
  - `wechat-api.js` 的 client 新增 `getFreePublishList(offset, count) → { item, total_count, item_count }`
  - `article-index.js`:
    - `htmlToText(html) → string`
    - `pickThumbUrl(newsItem) → string` 三级兜底
    - `makeSummary(title, bodyText) → string` 标题 + 正文前 800 字
    - `indexFromParsed({ accountName, title, mediaId, sourceUrl, parsed }) → number` 建草稿后写 pending，返回 article id
    - `indexFromWechatItem(accountName, newsItem, articleId, updateTime) → number` 写/更新 published，命中 pending 则回填
    - `syncAccount(accountName, client, { onProgress }) → { added, updated, total }`
    - `parsedToText(parsed) → string` 从 crawl 结果提取纯文本

- [ ] **Step 1: 写失败的测试（追加到 `test/article-index.test.js` 末尾）**

```js
// ── Task 3: 同步与回填 ──

const idx = require('../article-index');

test('htmlToText: 去标签、合并空白', () => {
  const t = idx.htmlToText('<p>你好</p><p>世界</p><script>var a=1</script>');
  assert.ok(t.includes('你好'));
  assert.ok(t.includes('世界'));
  assert.ok(!t.includes('var a=1'), 'script 内容应被剥掉');
  assert.ok(!t.includes('<'), '不应残留标签');
});

test('pickThumbUrl: 优先用 thumb_url', () => {
  assert.strictEqual(idx.pickThumbUrl({ thumb_url: 'https://img/a.jpg', content: '' }), 'https://img/a.jpg');
});

test('pickThumbUrl: 没有 thumb_url 时从正文抠第一张图', () => {
  const item = { thumb_url: '', content: '<p>x</p><img src="https://img/first.jpg"><img src="https://img/second.jpg">' };
  assert.strictEqual(idx.pickThumbUrl(item), 'https://img/first.jpg');
});

test('pickThumbUrl: 都没有时返回空串', () => {
  assert.strictEqual(idx.pickThumbUrl({ thumb_url: '', content: '<p>无图</p>' }), '');
});

test('makeSummary: 截到 800 字以内且包含标题', () => {
  const s = idx.makeSummary('标题', '正文'.repeat(1000));
  assert.ok(s.startsWith('标题'));
  assert.ok(s.length <= 810, `实际长度 ${s.length}`);
});

test('parsedToText: 拼接文本类 block 的 content', () => {
  const parsed = { title: 'T', blocks: [
    { type: 'h1', content: '大标题' },
    { type: 'paragraph', content: '一段话' },
    { type: 'image', url: 'https://x/a.png' },
    { type: 'paragraph', content: '又一段' },
  ] };
  const t = idx.parsedToText(parsed);
  assert.ok(t.includes('大标题') && t.includes('一段话') && t.includes('又一段'));
  assert.ok(!t.includes('https://x/a.png'), '图片 URL 不应进正文');
});

test('indexFromParsed: 写入 pending 并存好实体', () => {
  const id = idx.indexFromParsed({
    accountName: '同步号', title: 'Cursor 深度实测', mediaId: 'media-abc',
    sourceUrl: 'https://notion.so/x',
    parsed: { title: 'Cursor 深度实测', blocks: [{ type: 'paragraph', content: '我们把 Cursor 用了一个月' }] },
  });
  assert.ok(id > 0);
  assert.strictEqual(db.getArticleEntities(id).cursor, 3);
  assert.ok(db.findPendingByTitle('同步号', 'Cursor 深度实测'));
});

test('indexFromWechatItem: 命中 pending 时回填 url 并转 published', () => {
  const acc = '回填号2';
  const pendingId = idx.indexFromParsed({
    accountName: acc, title: '回填测试文', mediaId: 'media-back',
    sourceUrl: 'https://notion.so/back',
    parsed: { title: '回填测试文', blocks: [{ type: 'paragraph', content: 'Manus 很有意思' }] },
  });

  const sameId = idx.indexFromWechatItem(acc, {
    title: '回填测试文', digest: '摘要', content: '<p>Manus 很有意思</p>',
    url: 'https://mp.weixin.qq.com/s/back', thumb_url: 'https://img/back.jpg',
  }, 'art-1', 1756000000);

  assert.strictEqual(sameId, pendingId, '应更新同一行而不是新插入');
  const row = db.listPublishedArticles(acc).find(r => r.id === pendingId);
  assert.ok(row, 'pending 应已转为 published');
  assert.strictEqual(row.url, 'https://mp.weixin.qq.com/s/back');
  assert.strictEqual(row.thumbUrl, 'https://img/back.jpg');
  // crawler 抽出的高质量实体应被保留
  assert.strictEqual(db.getArticleEntities(pendingId).manus, 3);
});

test('indexFromWechatItem: 没有 pending 时作为新文章插入', () => {
  const acc = '直发号';
  const id = idx.indexFromWechatItem(acc, {
    title: '后台直接写的文章', digest: '', content: '<p>聊聊 Sora 的进展</p>',
    url: 'https://mp.weixin.qq.com/s/direct', thumb_url: 'https://img/d.jpg',
  }, 'art-2', 1756000000);
  assert.ok(id > 0);
  assert.strictEqual(db.getArticleEntities(id).sora, 3);
});

test('syncAccount: 分页拉取并全部入库', async () => {
  const acc = '分页号';
  // 造 25 条，验证翻页（每页 20）
  const all = Array.from({ length: 25 }, (_, i) => ({
    article_id: `a-${i}`, update_time: 1756000000 + i,
    content: { news_item: [{
      title: `分页文章 ${i}`, digest: '', content: `<p>讲 Widget${i} 这个产品</p>`,
      url: `https://mp.weixin.qq.com/s/page-${i}`, thumb_url: `https://img/${i}.jpg`,
    }] },
  }));

  const fakeClient = {
    async getFreePublishList(offset, count) {
      return { item: all.slice(offset, offset + count), total_count: all.length, item_count: Math.min(count, all.length - offset) };
    },
  };

  const result = await idx.syncAccount(acc, fakeClient);
  assert.strictEqual(result.total, 25);
  assert.strictEqual(db.listPublishedArticles(acc).length, 25);
  assert.ok(db.getSyncMeta(acc), '应记录同步时间');
});

test('syncAccount: 重复同步不产生重复行', async () => {
  const acc = '幂等号';
  const one = [{
    article_id: 'a-1', update_time: 1756000000,
    content: { news_item: [{ title: '唯一文章', digest: '', content: '<p>x</p>', url: 'https://mp.weixin.qq.com/s/only', thumb_url: '' }] },
  }];
  const fakeClient = { async getFreePublishList(offset, count) { return { item: one.slice(offset, offset + count), total_count: 1, item_count: offset === 0 ? 1 : 0 }; } };

  await idx.syncAccount(acc, fakeClient);
  await idx.syncAccount(acc, fakeClient);
  assert.strictEqual(db.listPublishedArticles(acc).length, 1);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd ~/end_to_end-layout && node --test test/article-index.test.js`
Expected: FAIL，报 `Cannot find module '../article-index'`

- [ ] **Step 3: 在 `wechat-api.js` 里加 `getFreePublishList`**

在 `createClient` 内部、`deleteDraft` 函数之后插入：

```js
  // 拉取已群发文章列表。offset 从 0 开始，count 上限 20。
  async function getFreePublishList(offset = 0, count = 20) {
    return apiCallWithRetry(async () => {
      const token = await getAccessToken();
      const url   = `https://api.weixin.qq.com/cgi-bin/freepublish/batchget?access_token=${token}`;
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ offset, count, no_content: 0 }),
      });
      const data = await res.json();
      if (data.errcode) throw new Error(`拉取已发布文章失败: [${data.errcode}] ${data.errmsg}`);
      return data;
    });
  }
```

并在 `createClient` 末尾的 `return { … }` 里追加 `getFreePublishList,`。

- [ ] **Step 4: 实现 `article-index.js`**

```js
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
```

- [ ] **Step 5: 运行测试，确认全绿**

Run: `cd ~/end_to_end-layout && npm test`
Expected: PASS，全部测试通过

- [ ] **Step 6: 提交**

```bash
cd ~/end_to_end-layout
git add article-index.js wechat-api.js test/article-index.test.js
git commit -m "feat: 微信文章同步与 pending 回填对账"
```

---

### Task 4: 卡片渲染

**Files:**
- Modify: `parsers/crawler.js`（export 加 `ensureBrowser`）
- Modify: `nixpacks.toml`（加中文字体）
- Create: `card-renderer.js`
- Create: `test/card-renderer.test.js`

**Interfaces:**
- Consumes: `crawler.ensureBrowser()`
- Produces:
  - `fetchImageAsDataUri(url) → Promise<string|null>`
  - `buildCardHtml({ title, coverDataUri }) → string` 完整 HTML 文档字符串
  - `renderCard({ title, coverUrl }) → Promise<string|null>` 返回 `data:image/jpeg;base64,…`，失败返回 null
  - `renderCards(items) → Promise<Array<{ title, url, dataUri }>>` 串行渲染，跳过失败项

- [ ] **Step 1: 写失败的测试**

Create `test/card-renderer.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { buildCardHtml, renderCard, renderCards } = require('../card-renderer');
const crawler = require('../parsers/crawler');

after(async () => { await crawler.closeBrowser(); });

// 1×1 红点，避免测试依赖网络
const RED_DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('buildCardHtml: 标题被转义，封面被嵌入', () => {
  const html = buildCardHtml({ title: '<script>x</script>标题', coverDataUri: RED_DOT });
  assert.ok(html.includes('&lt;script&gt;'), '标题必须转义');
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes(RED_DOT));
});

test('buildCardHtml: 包含中文字体栈', () => {
  const html = buildCardHtml({ title: '标题', coverDataUri: RED_DOT });
  assert.ok(/Noto Sans CJK|PingFang SC/.test(html));
});

test('renderCard: 渲染出 JPEG data URI', async () => {
  const uri = await renderCard({ title: '这是一个中文标题，用来验证字体渲染', coverDataUri: RED_DOT });
  assert.ok(uri, '应返回 data URI');
  assert.ok(uri.startsWith('data:image/jpeg;base64,'), `实际前缀: ${uri.slice(0, 40)}`);
  assert.ok(uri.length > 2000, '图片不应为空白小图');

  // 存一份到本地，人工确认中文没渲染成豆腐块
  const out = path.join(__dirname, 'card-preview.jpg');
  fs.writeFileSync(out, Buffer.from(uri.split(',')[1], 'base64'));
  console.log(`\n  卡片预览已写入 ${out}，请肉眼确认中文正常显示\n`);
});

test('renderCard: 没有封面时返回 null，不出无图卡片', async () => {
  const uri = await renderCard({ title: '无封面', coverDataUri: null });
  assert.strictEqual(uri, null);
});

test('renderCards: 跳过取不到封面的条目', async () => {
  const cards = await renderCards([
    { title: '有封面', url: 'https://mp/1', coverDataUri: RED_DOT },
    { title: '无封面', url: 'https://mp/2', coverDataUri: null },
  ]);
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].url, 'https://mp/1');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd ~/end_to_end-layout && node --test test/card-renderer.test.js`
Expected: FAIL，报 `Cannot find module '../card-renderer'`

- [ ] **Step 3: 在 `parsers/crawler.js` 导出 `ensureBrowser`**

把最后一行改成：

```js
module.exports = { crawl, closeBrowser, ensureBrowser };
```

- [ ] **Step 4: 在 `nixpacks.toml` 加中文字体**

把 `[phases.setup]` 那行改成：

```toml
[phases.setup]
nixPkgs = ["...", "chromium", "python3", "gcc", "gnumake", "noto-fonts-cjk-sans"]
```

- [ ] **Step 5: 实现 `card-renderer.js`**

```js
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
```

- [ ] **Step 6: 运行测试并肉眼确认卡片**

Run: `cd ~/end_to_end-layout && node --test test/card-renderer.test.js`
Expected: PASS。然后打开 `test/card-preview.jpg`，确认中文标题正常显示，不是方框或豆腐块。

本机有中文字体所以本地一定正常。**部署到 Railway 后必须再跑一次这个测试**，那才是真正的验证。

- [ ] **Step 7: 提交**

```bash
cd ~/end_to_end-layout
echo "test/card-preview.jpg" >> .gitignore
git add card-renderer.js test/card-renderer.test.js parsers/crawler.js nixpacks.toml .gitignore
git commit -m "feat: 推荐卡片渲染（复用常驻 chromium 截图）"
```

---

### Task 5: 正文追加点

**Files:**
- Modify: `formatter.js`
- Create: `test/formatter-recommend.test.js`

**Interfaces:**
- Consumes: Task 4 的 `renderCards` 输出结构 `{ title, url, dataUri }`
- Produces:
  - `formatToWechat(parsedData, options = {}) → string`，`options.appendHtml` 插入在最外层 `</section>` 之前
  - `buildRecommendBlock(cards) → string`，`cards` 为空时返回空串

- [ ] **Step 1: 写失败的测试**

Create `test/formatter-recommend.test.js`:

```js
const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat, buildRecommendBlock } = require('../formatter');

const PARSED = { title: 'T', blocks: [{ type: 'paragraph', content: '正文内容' }], links: [] };

test('formatToWechat: 不传 options 时行为不变', () => {
  const html = formatToWechat(PARSED);
  assert.ok(html.startsWith('<section style="'));
  assert.ok(html.endsWith('</section>'));
  assert.ok(html.includes('正文内容'));
});

test('formatToWechat: appendHtml 插在最外层 section 之内', () => {
  const html = formatToWechat(PARSED, { appendHtml: '<p>尾巴</p>' });
  assert.ok(html.endsWith('<p>尾巴</p></section>'), `实际结尾: ${html.slice(-60)}`);
});

test('formatToWechat: appendHtml 为空串时不影响输出', () => {
  assert.strictEqual(formatToWechat(PARSED, { appendHtml: '' }), formatToWechat(PARSED));
});

test('buildRecommendBlock: 空数组返回空串（板块整体不出现）', () => {
  assert.strictEqual(buildRecommendBlock([]), '');
  assert.strictEqual(buildRecommendBlock(null), '');
});

test('buildRecommendBlock: 每张卡片包一个指向 mp 的链接', () => {
  const html = buildRecommendBlock([
    { title: '文章一', url: 'https://mp.weixin.qq.com/s/aaa', dataUri: 'data:image/jpeg;base64,AAA' },
    { title: '文章二', url: 'https://mp.weixin.qq.com/s/bbb', dataUri: 'data:image/jpeg;base64,BBB' },
  ]);
  assert.ok(html.includes('推荐阅读'));
  assert.strictEqual((html.match(/<a href="https:\/\/mp\.weixin\.qq\.com/g) || []).length, 2);
  assert.ok(html.includes('data:image/jpeg;base64,AAA'));
  assert.ok(html.includes('data:image/jpeg;base64,BBB'));
});

test('buildRecommendBlock: 标题写进 alt 且被转义', () => {
  const html = buildRecommendBlock([
    { title: '带"引号"的<标题>', url: 'https://mp.weixin.qq.com/s/x', dataUri: 'data:image/jpeg;base64,X' },
  ]);
  assert.ok(html.includes('&quot;') || html.includes('&#39;'));
  assert.ok(!html.includes('<标题>'));
});

test('buildRecommendBlock: 使用品牌绿与统一块间距', () => {
  const html = buildRecommendBlock([{ title: 'x', url: 'https://mp.weixin.qq.com/s/x', dataUri: 'data:image/jpeg;base64,X' }]);
  assert.ok(html.includes('#327848'));
  assert.ok(html.includes('30px'));
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd ~/end_to_end-layout && node --test test/formatter-recommend.test.js`
Expected: FAIL，`buildRecommendBlock is not a function`

- [ ] **Step 3: 在 `formatter.js` 的 `S` 对象里追加三个 token**

在 `footnote_num` 那一行之后、`};` 之前插入：

```js

  recommend_wrapper: `margin: 40px 0 0; padding-top: 24px; border-top: 1px solid rgba(0,0,0,.1);`,
  recommend_title:   `display: block; font-size: 15px; font-weight: 600; color: #327848; font-family: ${WX_FONT}; letter-spacing: ${WX_LS}; margin: 0 0 20px; text-align: left;`,
  recommend_img:     `width: 100%; max-width: 100%; height: auto; display: block; margin: 0 0 30px;`,
```

- [ ] **Step 4: 改 `formatToWechat` 签名并新增 `buildRecommendBlock`**

把 `formatToWechat` 的定义改成（只动函数签名和最后一行 return）：

```js
function formatToWechat(parsedData, options = {}) {
  if (!parsedData || !parsedData.blocks) {
    return '<p style="color:red">解析数据为空，请重试</p>';
  }
  const { blocks, links = [] } = parsedData;

  // 跳过开头的空块（空段落、空行），避免文章顶部出现多余空白
  let startIndex = 0;
  while (startIndex < blocks.length) {
    const b = blocks[startIndex];
    if (b.type === 'paragraph') {
      const text = (b.content || '').replace(/​/g, '').trim();
      if (!text) { startIndex++; continue; }
    }
    break;
  }

  let html = '';
  for (let i = startIndex; i < blocks.length; i++) html += renderBlock(blocks[i], links, 0);
  if (links.length > 0) html += renderFootnotes(links);
  // appendHtml 必须落在 wrapper 之内，否则丢掉基础字体与字色
  html += options.appendHtml || '';
  return `<section style="${S.wrapper}">${html}</section>`;
}
```

在 `renderFootnotes` 函数之后插入：

```js
// 文末「推荐阅读」板块。cards 为空时返回空串，整个板块不出现。
// 图片用 data URI，publishArticle 的 processHtmlImages 会自动上传到微信并换成 mmbiz 地址。
function buildRecommendBlock(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return '';
  // alt 是正文内容，用 escHtml（转义 & < > "）；href/src 是 URL，escAttr 转引号就够
  const items = cards.map(c =>
    `<a href="${escAttr(c.url)}"><img src="${escAttr(c.dataUri)}" alt="${escHtml(c.title)}" style="${S.recommend_img}"></a>`
  ).join('');
  return `<section style="${S.recommend_wrapper}"><section style="${S.recommend_title}">推荐阅读</section>${items}</section>`;
}
```

把最后一行改成：

```js
module.exports = { formatToWechat, buildRecommendBlock };
```

- [ ] **Step 5: 运行全部测试，确认没有回归**

Run: `cd ~/end_to_end-layout && npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
cd ~/end_to_end-layout
git add formatter.js test/formatter-recommend.test.js
git commit -m "feat: 正文追加推荐阅读板块（formatToWechat 支持 appendHtml）"
```

---

### Task 6: 后端两段式发布

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: Task 1 `recommend`、`extractEntities`；Task 2 全部 db 导出；Task 3 `indexFromParsed` / `syncAccount` / `parsedToText` / `makeSummary`；Task 4 `renderCards`；Task 5 `formatToWechat` / `buildRecommendBlock`
- Produces:
  - `POST /api/prepare` → SSE，`done` 事件形如 `{ type:'done', ok:true, prepareId, title, candidates: [{ id, title, url, thumbUrl, score, sharedEntities }] }`
  - `POST /api/publish` 请求体新增 `prepareId` 和 `selectedIds: number[]`；未带 `prepareId` 时退回原有的一次性流程，保持向后兼容
  - `POST /api/sync-articles` → `{ ok, added, total }`（需登录）
  - `GET /api/index-stats?accountName=…` → `{ total, published, pending, lastSyncedAt }`

- [ ] **Step 1: 在 `server.js` 顶部补 import 与 prepare 缓存**

把顶部 import 段改成：

```js
require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const db      = require('./db');
const crawler = require('./parsers/crawler');
const { formatToWechat, buildRecommendBlock } = require('./formatter');
const { createClient }   = require('./wechat-api');
const { recommend, extractEntities } = require('./recommender');
const articleIndex = require('./article-index');
const { renderCards } = require('./card-renderer');
```

在 `const clientCache = new Map();` 之后插入：

```js
// ── prepare 缓存 ──
// 存 crawl 出来的 parsed，让 publish 阶段不必重爬。
// TTL 短是因为 Notion 图片是签名 URL，约 1 小时过期。
const prepares = new Map();
const PREPARE_TTL = 15 * 60 * 1000;
const PREPARE_MAX = 20;

function putPrepare(data) {
  // 超出上限时淘汰最老的一条
  while (prepares.size >= PREPARE_MAX) {
    const oldest = [...prepares.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) break;
    prepares.delete(oldest[0]);
  }
  const id = crypto.randomBytes(16).toString('hex');
  prepares.set(id, { ...data, createdAt: Date.now() });
  return id;
}

function takePrepare(id) {
  const p = prepares.get(id);
  if (!p) return null;
  if (Date.now() - p.createdAt > PREPARE_TTL) { prepares.delete(id); return null; }
  return p;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of prepares) if (now - p.createdAt > PREPARE_TTL) prepares.delete(id);
}, 5 * 60 * 1000);
```

- [ ] **Step 2: 抽出 SSE 辅助函数并新增 `/api/prepare`**

在 `app.post('/api/publish', …)` 之前插入：

```js
// ── 发布第一段：爬取 + 排版 + 算候选 ──

function openSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  return {
    progress(step, percent, msg) {
      res.write(`data: ${JSON.stringify({ type: 'progress', step, percent, msg })}\n\n`);
    },
    done(payload) {
      res.write(`data: ${JSON.stringify({ type: 'done', ...payload })}\n\n`);
      res.end();
    },
  };
}

function normalizeNotionUrl(url) {
  const u = (url || '').trim();
  return /^\/[0-9a-f]{32}/.test(u) ? 'https://www.notion.so' + u : u;
}

app.post('/api/prepare', auth, async (req, res) => {
  const url = normalizeNotionUrl(req.body.url);
  const { accountName } = req.body;
  if (!url)         return res.status(400).json({ error: '缺少链接' });
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });

  const sse = openSSE(res);
  try {
    // 索引超过 1 小时没同步就后台补一次，不 await，不拖慢本次准备。
    // 本次用的还是旧索引，下次就是新的。
    const last = db.getSyncMeta(accountName);
    if (!last || Date.now() - new Date(last).getTime() > 60 * 60 * 1000) {
      safeSync(accountName, '发布页触发').catch(() => {});
    }

    sse.progress(1, 15, '正在打开页面...');
    const parsed = await crawler.crawl(url);
    const title  = parsed.title || '未命名文章';
    sse.progress(2, 55, `已解析「${title}」${parsed.blocks?.length || 0} 个内容块`);

    sse.progress(3, 75, '正在查找相关的历史文章...');
    const bodyText = articleIndex.parsedToText(parsed);
    const current = {
      entities:    extractEntities(title, bodyText),
      summaryText: articleIndex.makeSummary(title, bodyText),
      url:         '',
      sourceUrl:   url,
    };
    const { docFreq, totalDocs } = db.getEntityDocFreq(accountName);
    const candidates = recommend({
      current,
      candidates: db.listPublishedArticles(accountName),
      docFreq, totalDocs, limit: 8,
    });

    const prepareId = putPrepare({ parsed, title, url, accountName });
    sse.progress(4, 100, candidates.length ? `找到 ${candidates.length} 篇相关文章` : '没有找到相关文章');
    sse.done({ ok: true, prepareId, title, candidates });
  } catch (e) {
    console.error('[Prepare] 失败:', e.message);
    sse.done({ ok: false, error: translatePublishError(e.message) });
  }
});
```

- [ ] **Step 3: 把错误翻译逻辑抽成函数**

在 `openSSE` 之后插入（把原来内联在 `/api/publish` catch 里的那段搬出来）：

```js
// 把技术性错误翻译为用户能理解的提示
function translatePublishError(msg) {
  if (/Target crashed|target closed|Target closed/i.test(msg)) {
    return '页面内容过大或服务器内存不足，浏览器进程崩溃。建议：1) 检查页面是否已公开 2) 减少文章中的图片数量 3) 稍后重试';
  }
  if (/timeout|超时/i.test(msg))  return '页面加载超时，请检查链接是否可正常访问';
  if (/net::ERR_/i.test(msg))     return '无法访问该链接，请检查网络或链接是否正确';
  return msg;
}
```

- [ ] **Step 4: 改造 `/api/publish`**

把整个 `app.post('/api/publish', auth, async (req, res) => { … })` 替换成：

```js
app.post('/api/publish', auth, async (req, res) => {
  let { url, accountName, author, digest, prepareId, selectedIds } = req.body;
  const operator = req.user.username;
  url = normalizeNotionUrl(url);

  const cached = prepareId ? takePrepare(prepareId) : null;
  if (prepareId && !cached) {
    return res.status(410).json({ error: '本次准备结果已过期，请重新开始' });
  }
  if (cached) {
    url         = cached.url;
    accountName = cached.accountName;
  }

  if (!url)         return res.status(400).json({ error: '缺少链接' });
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });

  const sse = openSSE(res);
  let title = '';
  try {
    let parsed;
    if (cached) {
      parsed = cached.parsed;
      title  = cached.title;
      sse.progress(1, 30, `复用已解析的「${title}」`);
    } else {
      sse.progress(1, 10, '正在打开页面...');
      parsed = await crawler.crawl(url);
      title  = parsed.title || '未命名文章';
      sse.progress(2, 35, `已解析「${title}」${parsed.blocks?.length || 0} 个内容块`);
    }

    // 合成推荐卡片。任何一步失败都不阻断发布，最多是没有推荐板块。
    let appendHtml = '';
    const ids = Array.isArray(selectedIds) ? selectedIds : [];
    if (ids.length > 0) {
      sse.progress(3, 45, `正在合成 ${ids.length} 张推荐卡片...`);
      try {
        const pool  = db.listPublishedArticles(accountName);
        const chosen = ids.map(id => pool.find(a => a.id === id)).filter(Boolean);
        const cards = await renderCards(chosen.map(a => ({ title: a.title, url: a.url, coverUrl: a.thumbUrl })));
        appendHtml = buildRecommendBlock(cards);
        if (cards.length < chosen.length) {
          sse.progress(3, 50, `${chosen.length - cards.length} 篇因封面取不到被跳过`);
        }
      } catch (e) {
        console.error('[Publish] 推荐卡片合成失败，跳过该板块:', e.message);
        sse.progress(3, 50, '推荐卡片合成失败，已跳过');
      }
    }

    sse.progress(4, 55, '正在排版格式化...');
    const html = formatToWechat(parsed, { appendHtml });

    const client = getWechatClient(accountName);
    sse.progress(5, 65, '正在上传图片到微信...');

    const result = await client.publishArticle({ title, author: author || '', html, digest: digest || '' });
    sse.progress(6, 100, '发布成功！');

    // 写入文章库（pending，等群发后由同步任务回填 url）
    try {
      articleIndex.indexFromParsed({ accountName, title, mediaId: result.media_id, sourceUrl: url, parsed });
    } catch (e) {
      console.error('[Publish] 写入文章库失败（不影响发布）:', e.message);
    }

    db.addLog({ operator, url, title, accountName, mediaId: result.media_id, status: 'success', errorMsg: '' });
    sse.done({ ok: true, title, media_id: result.media_id });
  } catch (e) {
    console.error('[Publish] 失败:', e.message);
    db.addLog({ operator, url, title, accountName, mediaId: '', status: 'error', errorMsg: e.message });
    sse.done({ ok: false, error: translatePublishError(e.message), title });
  }
});
```

- [ ] **Step 5: 新增同步与统计路由**

在 `app.get('/api/logs', …)` 之前插入：

```js
// ── 文章库 ──

app.post('/api/sync-articles', auth, async (req, res) => {
  const { accountName } = req.body;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });
  try {
    const client = getWechatClient(accountName);
    const result = await articleIndex.syncAccount(accountName, client);
    res.json({ ok: true, ...result, stats: db.getIndexStats(accountName) });
  } catch (e) {
    console.error('[Sync] 失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/index-stats', auth, (req, res) => {
  const accountName = req.query.accountName;
  if (!accountName) return res.status(400).json({ error: '请选择公众号' });
  res.json(db.getIndexStats(accountName));
});
```

- [ ] **Step 6: 启动时与定时同步**

把 `app.listen(…)` 那段改成：

```js
// 同步一个账号，失败只记日志不抛，避免打挂启动流程
async function safeSync(accountName, reason) {
  try {
    const client = getWechatClient(accountName);
    await articleIndex.syncAccount(accountName, client);
  } catch (e) {
    console.error(`[Sync] ${accountName} ${reason} 同步失败:`, e.message);
  }
}

async function syncAllAccounts(reason, onlyIfEmpty = false) {
  for (const acc of db.getAccounts()) {
    if (onlyIfEmpty && db.getIndexStats(acc.name).published > 0) continue;
    await safeSync(acc.name, reason);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Accounts: ${db.getAccounts().length} 个公众号已配置`);
  // 索引为空时全量重建。Railway 若未挂 Volume，这一步会自动补回文章库。
  syncAllAccounts('启动', true);
});

// 每 6 小时增量同步
setInterval(() => syncAllAccounts('定时'), 6 * 60 * 60 * 1000);
```

- [ ] **Step 7: 手工验证服务能起来**

Run: `cd ~/end_to_end-layout && node -e "require('./server.js')" & sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/ && kill %1`
Expected: `200`，且控制台没有报错堆栈

Run: `cd ~/end_to_end-layout && npm test`
Expected: PASS，全绿（server.js 无单测，确认没打挂已有测试即可）

- [ ] **Step 8: 提交**

```bash
cd ~/end_to_end-layout
git add server.js
git commit -m "feat: 发布流程拆成 prepare / publish 两段，加文章库同步路由"
```

---

### Task 7: 前端候选选择

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: Task 6 的 `/api/prepare` 与改造后的 `/api/publish`
- Produces: 无（终端界面）

- [ ] **Step 1: 加候选选择区的 HTML**

在 `<div class="publish-log" id="publishLog"></div>` 那一行之前插入：

```html
            <div class="recommend-picker" id="recommendPicker" style="display:none">
              <div class="recommend-picker-head">
                <span id="recommendHint">找到相关文章</span>
                <button class="btn-text" onclick="toggleAllRecommend()" id="recommendToggleAll">全选</button>
              </div>
              <div id="recommendList"></div>
              <div class="recommend-picker-foot">
                <button class="modal-btn modal-btn-cancel" onclick="cancelPrepare()">取消</button>
                <button class="modal-btn" onclick="confirmAndPublish()" id="recommendConfirmBtn">确认并发布</button>
              </div>
            </div>
```

- [ ] **Step 2: 加样式**

在 `<style>` 块末尾（`</style>` 之前）插入：

```css
    .recommend-picker { margin-top: 16px; padding: 16px; border: 1px solid rgba(0,0,0,.12); background: #fafafa; }
    .recommend-picker-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 13px; color: #555; }
    .recommend-item { display: flex; align-items: center; gap: 10px; padding: 8px; cursor: pointer; border-bottom: 1px solid rgba(0,0,0,.06); }
    .recommend-item:last-child { border-bottom: none; }
    .recommend-item:hover { background: rgba(0,0,0,.03); }
    .recommend-item img { width: 72px; height: 40px; object-fit: cover; flex-shrink: 0; background: #eee; }
    .recommend-item .ri-title { font-size: 13px; color: #222; line-height: 1.4; flex: 1; }
    .recommend-item .ri-why { font-size: 11px; color: #888; margin-top: 3px; }
    .recommend-picker-foot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
```

- [ ] **Step 3: 抽出 SSE 读取辅助函数**

在 `async function doPublish() {` 之前插入：

```js
    // 读一条 SSE 流。onProgress 收进度，返回 done 事件的 payload。
    // 流断了但没收到 done，抛错，由调用方提示。
    async function readSSE(res, onProgress) {
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', result = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'progress') onProgress(data);
            else if (data.type === 'done') result = data;
          } catch (_) {}
        }
      }
      if (!result) throw new Error('连接中断，服务端可能内存不足');
      return result;
    }
```

- [ ] **Step 4: 用两段式重写 `doPublish`**

把 `async function doPublish() { … }` 整个替换成：

```js
    let currentPrepare = null; // { prepareId, title, author, digest }

    function publishUI() {
      return {
        btn:     document.getElementById('publishBtn'),
        btnText: document.getElementById('publishBtnText'),
        fill:    document.getElementById('progressFill'),
        logEl:   document.getElementById('publishLog'),
      };
    }

    function addPublishLog(msg) {
      const logEl = document.getElementById('publishLog');
      const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      logEl.innerHTML += `<div class="log-line"><span class="log-time">${now}</span><span class="log-msg">${esc(msg)}</span></div>`;
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setPublishBusy(busy, text) {
      const { btn, btnText } = publishUI();
      btn.disabled = busy;
      btn.classList.toggle('publishing', busy);
      if (text) btnText.textContent = text;
    }

    function resetPublishBtn() {
      const { fill, btnText } = publishUI();
      setTimeout(() => { fill.style.width = '0'; btnText.textContent = '发布到草稿箱'; }, 2000);
    }

    async function doPublish() {
      const url         = document.getElementById('urlInput').value.trim();
      const accountName = document.getElementById('accountSelect').value;
      const author      = document.getElementById('authorInput').value.trim();
      const digest      = document.getElementById('digestInput').value.trim();

      if (!url)         return showModal({ icon: SVG_MODAL_EDIT, title: '提示', msg: '请输入 Notion 或飞书链接', confirmText: '知道了', confirmClass: 'modal-btn-cancel' });
      if (!accountName) return showModal({ icon: SVG_MODAL_MEGAPHONE, title: '提示', msg: '请先选择目标公众号', confirmText: '知道了', confirmClass: 'modal-btn-cancel' });

      const { fill, logEl } = publishUI();
      document.getElementById('recommendPicker').style.display = 'none';
      logEl.innerHTML = '';
      setStatus('', '');
      fill.style.width = '5%';
      setPublishBusy(true, '准备中...');
      addPublishLog('开始解析文章...');

      try {
        const res = await fetch('/api/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ url, accountName }),
        });
        const data = await readSSE(res, d => {
          fill.style.width = d.percent + '%';
          setPublishBusy(true, d.msg);
          addPublishLog(d.msg);
        });

        if (!data.ok) {
          addPublishLog('❌ 失败: ' + data.error);
          setStatus('error', '失败: ' + esc(data.error));
          setPublishBusy(false);
          resetPublishBtn();
          return;
        }

        currentPrepare = { prepareId: data.prepareId, title: data.title, author, digest };

        // 没有相关文章就不打断，直接发
        if (!data.candidates || data.candidates.length === 0) {
          addPublishLog('没有找到相关的历史文章，跳过推荐板块');
          await runPublish([]);
          return;
        }
        showRecommendPicker(data.candidates);
      } catch (e) {
        addPublishLog('❌ 请求异常: ' + e.message);
        setStatus('error', '请求异常: ' + esc(e.message));
        setPublishBusy(false);
        resetPublishBtn();
      }
    }

    function showRecommendPicker(candidates) {
      const picker = document.getElementById('recommendPicker');
      document.getElementById('recommendHint').textContent =
        `找到 ${candidates.length} 篇相关文章，勾选后合成到文末（可以一篇都不选）`;
      document.getElementById('recommendList').innerHTML = candidates.map(c => `
        <label class="recommend-item">
          <input type="checkbox" class="ri-check" value="${c.id}">
          <img src="${esc(c.thumbUrl || '')}" alt="">
          <div>
            <div class="ri-title">${esc(c.title)}</div>
            <div class="ri-why">共同话题：${esc((c.sharedEntities || []).join('、'))}</div>
          </div>
        </label>
      `).join('');
      picker.style.display = 'block';
      setPublishBusy(false, '等待选择...');
    }

    function toggleAllRecommend() {
      const boxes = [...document.querySelectorAll('.ri-check')];
      const target = !boxes.every(b => b.checked);
      boxes.forEach(b => { b.checked = target; });
      document.getElementById('recommendToggleAll').textContent = target ? '全不选' : '全选';
    }

    function cancelPrepare() {
      document.getElementById('recommendPicker').style.display = 'none';
      currentPrepare = null;
      addPublishLog('已取消');
      setPublishBusy(false);
      resetPublishBtn();
    }

    async function confirmAndPublish() {
      const ids = [...document.querySelectorAll('.ri-check:checked')].map(b => Number(b.value));
      document.getElementById('recommendPicker').style.display = 'none';
      await runPublish(ids);
    }

    async function runPublish(selectedIds) {
      if (!currentPrepare) return;
      const { fill } = publishUI();
      setPublishBusy(true, '发布中...');

      try {
        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({
            prepareId: currentPrepare.prepareId,
            selectedIds,
            author: currentPrepare.author,
            digest: currentPrepare.digest,
          }),
        });

        if (res.status === 410) {
          const err = await res.json();
          addPublishLog('❌ ' + err.error);
          setStatus('error', esc(err.error));
          return;
        }

        const data = await readSSE(res, d => {
          fill.style.width = d.percent + '%';
          setPublishBusy(true, d.msg);
          addPublishLog(d.msg);
        });

        if (data.ok) {
          fill.style.width = '100%';
          setPublishBusy(true, '发布成功!');
          addPublishLog(`✅ 草稿创建成功: ${data.title}`);
          setStatus('success', `\u{1F389} 发布成功！「${esc(data.title)}」已保存到草稿箱`);
          document.getElementById('urlInput').value = '';
          document.getElementById('authorInput').value = '';
          document.getElementById('digestInput').value = '';
          launchFireworks();
        } else {
          addPublishLog('❌ 失败: ' + data.error);
          setStatus('error', '失败: ' + esc(data.error));
        }
      } catch (e) {
        addPublishLog('❌ 请求异常: ' + e.message);
        setStatus('error', '请求异常: ' + esc(e.message));
      } finally {
        currentPrepare = null;
        setPublishBusy(false);
        resetPublishBtn();
        loadLogs();
      }
    }
```

- [ ] **Step 5: 手工验证界面**

Run: `cd ~/end_to_end-layout && npm start`

在浏览器打开 `http://localhost:3000`，登录后：

1. 文章库为空时贴一个链接发布，确认**没有候选也能正常走完**，行为跟改造前一致
2. 点「取消」，确认按钮恢复、可以重新发起
3. 打开 DevTools Network，确认先打 `/api/prepare` 再打 `/api/publish`，且 `/api/publish` 没有重新爬页面（耗时明显短于 prepare）

- [ ] **Step 6: 提交**

```bash
cd ~/end_to_end-layout
git add public/index.html
git commit -m "feat: 发布界面加推荐文章选择步骤"
```

---

### Task 8: 管理后台文章库

**Files:**
- Modify: `public/admin.html`

**Interfaces:**
- Consumes: Task 6 的 `/api/sync-articles`、`/api/index-stats`
- Produces: 无（终端界面）

已确认的现状（不必再查）：

- `api(path, opts)` 在 `public/admin.html:169`，**已经自动带 `Content-Type: application/json` 和 `Authorization`**，直接用即可
- 卡片写法是 `<div class="card"><h2>标题</h2>…</div>`，账号卡片在 `:135`，用户卡片在 `:147`
- 初始化在 `DOMContentLoaded` 里，`loadAccounts()` 调用在 `:189`
- 按钮类名：`btn-add`（主操作）、`btn-del`（危险）、`btn-text`（次要）

- [ ] **Step 1: 加「文章库」卡片**

在用户管理卡片（`</div>` 收尾，约 `:159`）之后插入：

```html
      <div class="card">
        <h2>文章库</h2>
        <p style="font-size:13px;color:var(--gray);margin:0 0 12px">
          推荐阅读的候选来源。服务启动和每 6 小时会自动同步，这里可以手动触发。
        </p>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="indexAccount"></select>
          <button class="btn-add" onclick="syncArticles()" id="syncBtn">同步文章库</button>
        </div>
        <div id="indexStats" style="font-size:13px;color:var(--gray);margin-top:12px"></div>
      </div>
```

- [ ] **Step 2: 加脚本**

在 admin.html 的 `<script>` 末尾插入：

```js
    async function loadIndexAccounts() {
      const { accounts } = await api('/api/accounts');
      const sel = document.getElementById('indexAccount');
      sel.innerHTML = accounts.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
      if (accounts.length) loadIndexStats();
    }

    async function loadIndexStats() {
      const name = document.getElementById('indexAccount').value;
      if (!name) return;
      try {
        const s = await api('/api/index-stats?accountName=' + encodeURIComponent(name));
        const last = s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString('zh-CN') : '从未同步';
        document.getElementById('indexStats').textContent =
          `已发布 ${s.published} 篇 · 待回填 ${s.pending} 篇 · 上次同步：${last}`;
      } catch (e) {
        document.getElementById('indexStats').textContent = '读取失败: ' + e.message;
      }
    }

    async function syncArticles() {
      const name = document.getElementById('indexAccount').value;
      if (!name) return;
      const btn = document.getElementById('syncBtn');
      btn.disabled = true;
      btn.textContent = '同步中...';
      try {
        await api('/api/sync-articles', {
          method: 'POST',
          body: JSON.stringify({ accountName: name }),
        });
        await loadIndexStats();
      } catch (e) {
        document.getElementById('indexStats').textContent = '同步失败: ' + e.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '同步文章库';
      }
    }

    document.getElementById('indexAccount').addEventListener('change', loadIndexStats);
```

- [ ] **Step 3: 挂到初始化流程**

在 `public/admin.html:189` 的 `loadAccounts();` 之后追加一行：

```js
        loadIndexAccounts();
```

- [ ] **Step 4: 手工验证**

Run: `cd ~/end_to_end-layout && npm start`

打开 `http://localhost:3000/admin.html`，用管理员登录：

1. 文章库卡片能列出账号
2. 点「同步文章库」，观察服务端控制台打出 `[Index] … 同步完成，共 N 篇`
3. 统计行刷新出篇数和同步时间

**这一步会打真实的微信接口**，也是验证 spec 第 7 节前两个未知项的时机：

- 账号有没有 `freepublish/batchget` 权限（无权限会报 `[48001] api unauthorized`）
- 封面图字段走的是哪条兜底路径。同步后查一下：

Run: `cd ~/end_to_end-layout && sqlite3 data.db "SELECT COUNT(*) AS 有封面 FROM articles WHERE thumb_url != ''; SELECT COUNT(*) AS 总数 FROM articles;"`

若「有封面」远小于「总数」，说明 `thumb_url` 和正文抠图两条路都不够用，需要补 `material/get_material` 那条兜底。

- [ ] **Step 5: 提交**

```bash
cd ~/end_to_end-layout
git add public/admin.html
git commit -m "feat: 管理后台加文章库同步与索引状态"
```

---

## 上线前必须在 Railway 真机验证

本地全绿不代表线上可用。部署后按顺序确认：

1. **中文字体**（最可能出问题）。部署后在 Railway shell 跑 `node --test test/card-renderer.test.js`，把 `test/card-preview.jpg` 取下来看中文是不是豆腐块。若是，检查 `nixpacks.toml` 的 `noto-fonts-cjk-sans` 有没有生效，必要时改用 `@font-face` 内嵌字体文件。
2. **`freepublish/batchget` 权限**。走 Task 8 Step 4。
3. **封面图字段兜底**。走 Task 8 Step 4 的 sqlite 查询。
4. **mmbiz 封面服务端直取**。同步后随便挑一条 `thumb_url` 跑 `curl -sI "<url>"`，确认返回 200 而不是 403。
5. **端到端**。真发一篇带推荐板块的草稿，去微信后台确认：卡片显示正常、点击能跳转到目标文章、卡片图已经换成 `mmbiz.qpic.cn` 地址（说明 `processHtmlImages` 正确接管了 data URI）。
6. **内存**。发布一篇长文时看 Railway 的内存曲线，确认合图阶段没有把容器顶到 OOM。若顶到了，把 `renderCards` 改成每张之间 `await new Promise(r => setTimeout(r, 300))` 让 GC 有机会跑。

## 建议但不阻塞

Railway 面板挂一个 Volume，把 `DATABASE_PATH` 指到挂载点。不挂也能跑（启动时会从微信重建索引），但挂了之后 `logs` 表和 pending 记录才不会在每次部署时丢。
