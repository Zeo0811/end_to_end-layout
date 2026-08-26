# 文末「推荐阅读」板块 设计方案

日期：2026-08-26
范围：`end_to_end-layout` 仓库。`Layout-design` 插件接入放到下一期。

## 1. 要解决什么

发布文章时，自动从历史已发布文章里找出**讲同一个对象**的文章，让用户确认后，在文末生成「封面图 + 标题」合成卡片，点击可跳转。

核心原则：**宁缺毋滥**。没有真正相关的，整个板块不出现。不凑数、不设固定篇数。

## 2. 用户流程

现在是一次请求走完：

```
POST /api/publish  →  crawl → 排版 → 上传图片 → 建草稿
```

改成两段：

```
POST /api/prepare  →  crawl → 排版 → 算候选
                      返回 { prepareId, title, candidates[] }

     用户在页面上勾选（可以一篇都不勾）

POST /api/publish  →  复用缓存的 parsed → 合图 → 追加板块
                      → 上传图片 → 建草稿
```

`crawl` 是整条链最慢的一步（Notion 大页面十几秒），绝不能跑两遍。所以服务端缓存 `parsed` 结果。

**prepare 缓存**：内存 `Map`，key 是 `prepareId`，TTL **15 分钟**，参照现有 `sessions` 的写法。TTL 取 15 分钟是因为 Notion 图片 URL 带签名、约 1 小时过期，缓存太久会导致后续上传拿到 403。同时限制最多 20 条，超了按 LRU 淘汰，防止内存涨。

**候选为空时**：`candidates` 返回空数组，前端不显示选择步骤，直接进入发布，行为跟现在完全一致。

## 3. 数据层

### 3.1 表结构

加在 `db.js` 的建表 SQL 里。

```sql
CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name  TEXT NOT NULL,        -- 多账号隔离，只在同号内推荐
  title         TEXT NOT NULL,
  digest        TEXT,
  url           TEXT,                 -- mp 永久链接，published 才有
  thumb_url     TEXT,                 -- 封面图地址
  article_id    TEXT,                 -- freepublish 的 article_id
  media_id      TEXT,                 -- 草稿 media_id，用于回填对账
  source_url    TEXT,                 -- 原始 Notion / 飞书链接
  status        TEXT NOT NULL,        -- pending | published | deleted
  body_text     TEXT,                 -- 纯文本正文，留作以后重算实体用
  summary_text  TEXT,                 -- 标题 + 正文前 800 字，打分用
  published_at  TEXT,
  created_at    TEXT DEFAULT (datetime('now','+8 hours')),
  updated_at    TEXT DEFAULT (datetime('now','+8 hours'))
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(account_name, status);
CREATE INDEX IF NOT EXISTS idx_articles_url    ON articles(url);

CREATE TABLE IF NOT EXISTS article_entities (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  entity     TEXT NOT NULL,           -- 归一化小写，如 cursor / manus
  weight     REAL NOT NULL DEFAULT 1, -- 标题命中权重高于正文
  PRIMARY KEY (article_id, entity)
);
CREATE INDEX IF NOT EXISTS idx_entities ON article_entities(entity);
```

实体单独开表，召回走 SQL 索引，O(1) 拿到「所有提过 cursor 的文章」。

`summary_text` 只存前 800 字，因为 bigram 只在少量候选上跑。`body_text` 存全文纯粹是留后路，等实体规则改进了能离线重算。

### 3.2 两条写入路径

**路径一，从微信全量同步**

调 `freepublish/batchget`（分页，`offset` / `count`，每页 20）。每条 `item.content.news_item[]` 取 `title` / `digest` / `content` / `url`，写入或更新 `articles`，`status = 'published'`。`is_deleted` 为真的标成 `deleted`。

**路径二，发布钩子**

`/api/publish` 成功建草稿后，写一条 `status = 'pending'` 记录，带 `media_id` / `title` / `source_url`，以及从 `parsed` 直接抽出的 `body_text` 和实体。

这一刻的数据质量最高：`crawler.crawl()` 刚吐出干净的结构化内容，比事后从微信 content HTML 反解准得多。

**回填对账**

同步任务跑 `freepublish/batchget` 时，按 `account_name + title` 找 `pending` 记录。对上就填 `url` / `thumb_url` / `article_id` / `published_at`，状态转 `published`，保留原有的高质量 `body_text` 和实体。

对不上的，就是直接在微信后台写的文章，作为新记录插入，`body_text` 从 `content` HTML 反解（去标签、去空白）。

**只有 `status = 'published'` 且 `url` 非空的进推荐池。** 所以永远不会推出死链。

### 3.3 同步触发

- 服务启动时，若 `articles` 为空 → 跑一次全量同步
- 每 6 小时定时增量同步（`setInterval`）
- admin 页面加一个「同步文章库」按钮，手动触发
- 打开发布页时，若距上次同步超过 1 小时 → 后台静默触发一次

不在建草稿后立即触发。草稿还没群发，微信那边查不到，没有意义。

### 3.4 关于 Railway 持久化

仓库里 `railway.json` 没有 volume 配置，`DATABASE_PATH` 默认指向容器内的 `./data.db`。若 Railway 面板未挂 Volume，容器文件系统是临时的，每次部署清零。

**这个问题已被设计规避**：索引的权威来源是微信服务器。启动时表为空就全量重建，几分钟恢复全部已发文章。

真正会丢的只有两样：尚未群发的 pending 记录，以及 crawler 解析出的高质量 `body_text`（退化成从微信 HTML 反解的版本）。可以接受。

所以挂 Volume 从「必须」降级为「建议」。顺手挂上更好（`logs` 表现在也在每次部署时丢），但不阻塞本期。

## 4. 匹配算法

纯本地，零外部依赖，零成本，结果可复现可调试。

### 4.1 实体抽取

对一篇文章的标题和正文，抽出实体集合。三个来源：

1. **拉丁词**：`/[A-Za-z][A-Za-z0-9.+-]{1,}/g`，长度 ≥ 2，归一化小写。AI 媒体文章里产品名密度极高，这是最强信号。
2. **词典命中**：维护一份中文专名词典（产品 / 公司 / 人名），几十个词的 JSON，命中即算实体。没有分词器，中文只能靠词典。
3. **书名号与直角引号内的短串**：`《...》` `「...」` 里长度 2 到 12 的内容，常是产品名或作品名。

**权重**：标题命中 3，正文首段 2，正文其他 1。取最大值，不累加。

### 4.2 泛词自动过滤

关键设计：**不手工维护停用词全集，用文档频率自动过滤**。

一个实体若在超过 **15%** 的已入库文章里出现，它没有区分度，不作为召回依据。`ai`、`app`、`模型`、`openai` 这类会自动出局。

冷启动兜底：文章总数 < 50 时 df 不稳，改用一份手工小停用词表（`ai / app / api / ios / android / http / com / cn / the / and / for` 等）。

### 4.3 召回与排序

**召回（硬门槛）**：候选必须与当前文章**至少共享一个 df 比例 < 15% 的实体**。

这就是「绝对相关」的定义。没有共享实体的一律不出现，不做主题相似度兜底。

**排序**：在已召回的候选里打分。

```
score = Σ(共享实体: w_new × w_old × idf)  +  0.3 × bigram余弦(summary_text)
```

bigram 余弦是中文字符二元组的余弦相似度，只用来在已经命中同一实体的文章之间排先后，不参与召回。

**其他规则**：

- 排除自己（同 `url` 或同 `source_url`）
- 排除 `status != 'published'` 和 `url` 为空的
- 同分时新文章优先
- 返回上限 8 篇。不是推荐 8 篇，是给用户最多 8 个选项，防止某个高频实体一次刷出几十条

### 4.4 性能

召回走 SQL 索引，候选通常几条到几十条。bigram 只对候选的 `summary_text`（800 字）算。整体毫秒级，几千篇文章规模下完全不需要 FTS 或倒排索引。

**注意**：不要照搬 `~/CrossingVault/kb.sqlite` 的 FTS5 + `unicode61` 方案。实测 `unicode61` 把一整段连续中文当成单个 token，`match '测评'` 匹配不到 `'我们测评了'`。用它做中文相关性会大量漏召回。

## 5. 卡片合成

### 5.1 渲染方式

复用 `parsers/crawler.js` 里那个**常驻单例 chromium**（`getBrowser()` 会复用已连接实例）。新开一个 context，`setContent` 写卡片 HTML，对元素 `screenshot`，截完立刻关 context。

不引入 sharp 或 node-canvas。卡片样式就是 CSS，以后想调直接改样式。

参数：

- context `deviceScaleFactor: 2`
- 卡片宽 750px（2 倍图，对应正文 375pt）
- 封面区 750 × 319，比例 2.35:1，与公众号头条封面一致，`object-fit: cover`
- 标题条白底，标题最多 2 行，超出省略
- 输出 **JPEG，quality 88**。封面多是照片，JPEG 比 PNG 小一个数量级
- 一张一张串行渲染，不并发

### 5.2 封面图取用

先服务端 `fetch` 封面图，转成 base64 data URI 嵌进卡片 HTML，再交给 chromium 渲染。

不直接让 chromium 加载远程 URL，因为 mmbiz 图片有 Referer 防盗链，自己 fetch 才能控制 header。

封面图取不到时，跳过这篇候选，不出无图卡片。

### 5.3 容器缺中文字体（几乎肯定要修）

`nixpacks.toml` 当前是：

```toml
nixPkgs = ["...", "chromium", "python3", "gcc", "gnumake"]
```

**没有任何中文字体包**。Nix 的 chromium 不自带 CJK 字体。现在没暴露问题，是因为 crawler 只用浏览器抽取文本，不关心字形。一旦开始截图，中文会渲染成豆腐块。

修法：加 `noto-fonts-cjk-sans`。

```toml
nixPkgs = ["...", "chromium", "python3", "gcc", "gnumake", "noto-fonts-cjk-sans"]
```

上线前必须在真实容器里截一张图确认。

### 5.4 插入正文

板块 HTML 追加在 `formatToWechat()` 输出之后。**不改 `formatter.js`**，在发布流程里拼接。

```html
<section style="margin:0 0 30px;">
  <p style="{标题块样式}">推荐阅读</p>
  <a href="{mp永久链接}">
    <img src="data:image/jpeg;base64,..." style="width:100%;display:block;margin:0 0 12px;">
  </a>
  ...
</section>
```

**关键复用**：合成图直接以 `data:` URI 塞进 HTML 即可。`wechat-api.js` 里 `processHtmlImages()` 已经有 `base64ToBuffer` 分支，会自动上传到微信并替换成 mmbiz 地址。这条路径零额外代码。

「推荐阅读」四个字的样式沿用现有 `S` 里的标题块 token，与正文视觉统一（微信默认字体栈、15px、`#333`、字距 0.034em、块间距 30px、品牌绿 `#327848`）。

`draft/add` 接受正文里指向 `mp.weixin.qq.com` 的 `<a>`，链接会被保留。这是本期只做 end_to_end-layout 的原因之一。

## 6. 代码组织

新增：

- `recommender.js` — 实体抽取、df 统计、召回、打分。纯函数，不碰 DB 和网络，好测
- `card-renderer.js` — 卡片 HTML 模板 + playwright 截图
- `article-index.js` — 同步任务、回填对账、DB 读写

改动：

- `db.js` — 加两张表和对应 CRUD
- `server.js` — 加 `/api/prepare`、`/api/sync-articles`，改 `/api/publish` 接受 `prepareId` 和选中的文章 id
- `public/index.html` — 发布流程加一步候选选择
- `public/admin.html` — 加「同步文章库」按钮和索引状态
- `nixpacks.toml` — 加中文字体

不改：`formatter.js`、`parsers/*`、`wechat-api.js`。

## 7. 需要实测确认的点

1. **`freepublish/batchget` 的封面图字段**。是直接给 `thumb_url`，还是只有 `thumb_media_id` 需要再调 `material/get_material` 换地址，不同版本文档说法不一致。三条兜底：`news_item.thumb_url` → `material/get_material` → 从 `content` HTML 抠第一张图。哪条通用哪条。
2. **账号是否有 `freepublish/batchget` 权限**。需要已认证订阅号或服务号。拿不到就得退回手动维护清单。
3. **容器中文字体**（见 5.3）。
4. **mmbiz 封面图服务端直取是否被防盗链拦**。预计不拦，实测确认。

## 8. 本期不做

- LLM 或 embedding 参与选文
- 卡片样式定制界面。先固定一版，跑通后再迭代
- `Layout-design` 插件接入。插件路径有个未验证的硬风险：粘贴进公众号编辑器时 `<a>` 标签是否被剥掉。下一期先花十分钟单独验证
- 多账号交叉推荐。只在同一个 `account_name` 内选
- 「推荐阅读」板块位置可配。固定在文末

## 9. 测试

`package.json` 加 `"test": "node --test"`，与 `Layout-design` 一致。

单元测试：

- 实体抽取：拉丁词、词典、书名号三条路径，以及归一化
- df 过滤：泛词被剔除，冷启动走停用词表
- 召回：无共享实体时返回空
- 打分排序：共享实体多的排前面，同分时新的优先
- 排除规则：自己、pending、无 url

集成测试：

- 卡片渲染：跑一次存到本地文件，肉眼确认中文不是豆腐块
- 端到端：真发一篇草稿，去微信后台确认卡片显示正常、点击能跳转

## 10. 下一期

插件那边没有 crawl 阶段，正文是它自己在页面上解析好的，所以复用不了 `/api/prepare`。届时加一个薄路由 `/api/recommend`：接受 `{ accountName, title, bodyText }`，直接调 `recommender.js` 返回候选，不碰浏览器。这也是把 `recommender.js` 做成纯函数、不碰 DB 和网络的原因。

服务端其余零改动，CORS 已有全局中间件。

前提是先验证粘贴场景下 `<a>` 不被剥。若被剥，插件那边只能出不可点击的图，或引导手动插超链接。
