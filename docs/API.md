# zeooo.cc 接口文档

服务地址：`https://zeooo.cc`

面向调用方（脚本 / agent）的完整接口说明。以实现为准，改动请同步这份文档。

---

## 通用约定

### 认证

除 `POST /api/login` 外，全部接口需要 Bearer token：

```
Authorization: Bearer <token>
```

token 从登录接口取，**有效期 24 小时**，过期返回 401。token 存在服务进程内存里，
所以服务重启（每次部署）后全部失效，需要重新登录。

### 返回格式

**所有 JSON 响应都带 `ok` 字段**，由中间件按 HTTP 状态码统一注入：

- `ok: true` — HTTP < 400
- `ok: false` — HTTP >= 400，同时带 `error`（人类可读的中文说明）

调用方只需判断一次：

```js
const r = await res.json();
if (!r.ok) throw new Error(r.error);
```

SSE 接口（`/api/prepare`、`/api/publish`）不走这条，见下方各自说明。

### 常见状态码

| 码 | 含义 |
|---|---|
| 200 | 成功 |
| 400 | 参数缺失或不合法 |
| 401 | 未登录 / token 过期 / 密码错 |
| 403 | 需要管理员权限 |
| 409 | 冲突（目前只有：文章已在库中） |
| 410 | prepare 结果已过期 |
| 500 | 服务端错误 |

---

## 认证

### POST /api/login

无需 token。

**请求**
```json
{ "username": "admin", "password": "..." }
```

**成功 200**
```json
{ "ok": true, "token": "64位十六进制", "user": { "username": "admin", "role": "admin" } }
```

**失败 401** — `{ "ok": false, "error": "用户名或密码错误" }`

### POST /api/logout

使当前 token 失效。返回 `{ "ok": true }`。

### GET /api/me

返回 `{ "ok": true, "user": { "id": 1, "username": "admin", "role": "admin" } }`。

---

## 文章库

推荐阅读的候选来源。**只有 `status = 'published'` 且 `url` 非空的文章会进推荐池**，
所以永远不会推出死链。

### 背景：为什么需要手动入库

本账号是个人主体，无法完成微信主体认证，「发布能力」接口组永远返回
`[48001] api unauthorized`，`freepublish/batchget` 读不到已发布列表。
永久素材接口（`material/batchget_material`）只覆盖 20 篇。

所以历史文章靠 `POST /api/import-articles` 从本地存档批量灌入，
增量靠 `POST /api/add-article` 贴链接补。

### POST /api/add-article

**贴一条已群发的文章链接，自动抓取标题、封面、发布时间、正文并入库。**
这是日常增量更新的主接口。

**请求**
```json
{
  "accountName": "十字路口Crossing",
  "url": "https://mp.weixin.qq.com/s?__biz=MzAxMDMxOTI2NA==&mid=2649111344&idx=1&sn=3a45b9...&chksm=8201498d..."
}
```

**两种链接形式都支持：**

| 形式 | 例子 | 来源 |
|---|---|---|
| 短链 | `https://mp.weixin.qq.com/s/iDE0Dj5xsiHAebhFIqjEZg` | 微信「复制链接」，最常见 |
| 长链 | `https://mp.weixin.qq.com/s?__biz=...&mid=...&sn=...&chksm=...` | 后台、存档导出 |

`from`、`scene`、`sessionid`、`#rd` 这类跟踪参数服务端会自己清掉，整条贴进来即可。

> **长链的 `chksm` 参数不能省。** 实测去掉它，微信只返回一段约 3.5KB 的 JS 壳，
> 拿不到正文；带上才是完整页面（约 3.5MB）。短链没有这个问题 ——
> 它本身就是永久规范链接。
>
> 另外 `__biz` 末尾的 `==` **不能被 URL 编码**。编码成 `%3D%3D` 微信会 302 到
> 「未知错误」页。用 `URLSearchParams.toString()` 拼参数会踩这个坑。

**成功 200 — 新增**
```json
{
  "ok": true,
  "mode": "added",
  "article": {
    "id": 566,
    "title": "Physical Intelligence 联创 Chelsea Finn：物理 AI 已经走到自己的 GPT 时刻",
    "url": "https://mp.weixin.qq.com/s?__biz=...&chksm=...",
    "thumbUrl": "https://mmbiz.qpic.cn/sz_mmbiz_jpg/.../0?wx_fmt=jpeg",
    "publishedAt": "2026-09-04 09:00:00"
  },
  "stats": { "total": 566, "published": 566, "pending": 9, "usable": 563 }
}
```

**成功 200 — 回填**

`"mode": "backfilled"`。这篇是经 zeooo.cc 发的草稿，库里已有一条 `pending` 记录，
现在认领它并补上永久链接。此时**保留 crawler 从源文档抽出的正文和实体**
（比从微信 HTML 反解的准），只更新链接类字段。

**重复 409**
```json
{
  "ok": false,
  "mode": "duplicate",
  "error": "这篇已在库中：「Physical Intelligence 联创 Chelsea Finn…」",
  "article": { "id": 566, "title": "…", "url": "…", "publishedAt": "…", "status": "published" },
  "stats": { … }
}
```

带跟踪参数的同一篇链接也认得出来（链接会先归一化再比对）。

**失败 400**

| error | 原因 |
|---|---|
| `请选择公众号` | 缺 `accountName` |
| `请提供文章链接` | 缺 `url` |
| `不是有效的公众号文章链接。支持两种形式：…` | URL 格式不对 |
| `抓取失败：HTTP 404` | 文章已删除或链接失效 |
| `页面里没找到文章标题。请确认链接完整（保留 chksm 参数）且文章未被删除` | 多半是链接缺 `chksm` |

**调用示例**

```bash
TOKEN=$(curl -s -X POST https://zeooo.cc/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"你的密码"}' | jq -r .token)

curl -s -X POST https://zeooo.cc/api/add-article \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"accountName":"十字路口Crossing","url":"https://mp.weixin.qq.com/s?__biz=...&chksm=..."}' | jq
```

### POST /api/import-articles

批量导入，**内容由调用方提供**（不抓取）。用于从本地存档一次性灌历史文章。

**请求**
```json
{
  "accountName": "十字路口Crossing",
  "articles": [
    {
      "title":       "文章标题",              // 必填
      "url":         "https://mp.weixin.qq.com/s?...", // 必填，缺了这条会被跳过
      "thumbUrl":    "https://mmbiz.qpic.cn/...",      // 选填，没有则不会进推荐池
      "bodyText":    "正文纯文本",             // 选填，用于抽实体，建议给前 2000 字
      "digest":      "摘要",                  // 选填
      "publishedAt": "2026-09-04 09:00:00"    // 选填
    }
  ]
}
```

**单批最多 200 篇**，超了返回 400。

**成功 200**
```json
{ "ok": true, "imported": 50, "skipped": 0, "failed": 0, "errors": [], "stats": { … } }
```

- `skipped` — 缺 `title` 或 `url` 被跳过的
- `errors` — 最多返回前 5 条错误说明

**按 `url` 幂等。** 重复导入不会产生重复行，已存在的会被更新。
存档刷新后直接重跑即可。

**配套脚本**：`scripts/import-archive.js` 解析本地 HTML 存档并调用本接口。

```bash
node scripts/import-archive.js --user admin --pass '密码' --account '十字路口Crossing'
node scripts/import-archive.js --dry            # 只解析不上传，看解析结果
node scripts/import-archive.js --limit 20       # 先小批量试跑
node scripts/import-archive.js --dir ~/path     # 指定存档目录，默认 ~/Downloads/html
```

### GET /api/index-stats?accountName=...

`accountName` 需 URL 编码。

```json
{
  "ok": true,
  "total": 575,        // 全部记录
  "published": 566,    // 已发布
  "pending": 9,        // 等待回填永久链接
  "usable": 563,       // 真正能进推荐池的：已发布 + 有链接 + 有封面
  "lastSyncedAt": "2026-09-05T01:09:24.703Z"
}
```

> **看 `usable` 而不是 `published`。** 没封面的文章不会出现在推荐里，
> 两者的差就是缺封面的数量。

### GET /api/pending-articles?accountName=...

列出经 zeooo.cc 发过草稿、但还没拿到永久链接的文章。这些是待你贴链接回填的。

```json
{ "ok": true, "rows": [ { "id": 12, "title": "…", "mediaId": "…", "sourceUrl": "https://notion.so/…", "createdAt": "2026-09-04 18:30:00" } ] }
```

### POST /api/sync-articles

从微信接口同步已群发文章。**本账号权限不足，实际只能拿到永久素材里的约 20 篇**，
留着以备将来账号完成认证后使用。

```json
{ "accountName": "十字路口Crossing" }
```

成功返回 `{ ok, added, updated, total, pages, remoteTotal, source, stats }`，
`source` 是 `"freepublish"` 或 `"material"`，表明实际走的哪个接口。

### POST /api/probe-wechat

诊断接口权限，把微信那边的真实返回原样打出来，用于排查而非日常调用。

```json
{ "accountName": "十字路口Crossing" }
```

返回 `{ ok: true, accountName, probe: { "发布能力": {…}, "素材数量": {…}, "素材图文首页": {…}, "素材图文次页": {…} } }`，
每项形如 `{ ok: true, data: {…} }` 或 `{ ok: false, error: "…" }`。

---

## 发布

发布是两段式：先 `prepare` 拿候选，人工勾选后再 `publish`。
两者都是 **SSE（`text/event-stream`）**，不是普通 JSON。

### SSE 读法

每行形如 `data: {...}`，两类事件：

```json
{ "type": "progress", "step": 2, "percent": 55, "msg": "已解析「标题」42 个内容块" }
{ "type": "done", "ok": true,  ... }
{ "type": "done", "ok": false, "error": "页面加载超时，请检查链接是否可正常访问" }
```

**流结束却没收到 `done` 事件 = 服务端崩了**（通常是内存不足），要当失败处理。

### POST /api/prepare

爬取源文档、排版、算推荐候选。**不发布。**

```json
{ "url": "https://www.notion.so/...", "accountName": "十字路口Crossing" }
```

`done` 事件：

```json
{
  "type": "done", "ok": true,
  "prepareId": "32位十六进制",
  "title": "解析出的文章标题",
  "candidates": [
    { "id": 123, "title": "相关的历史文章", "url": "https://mp.weixin.qq.com/s?...",
      "thumbUrl": "https://mmbiz…", "score": 18.4, "sharedEntities": ["cursor", "devin"] }
  ]
}
```

- `candidates` 最多 8 条，按相关度降序
- **一篇都没匹配上时返回空数组**，这是正常的（宁缺毋滥：只有共享具体实体才算相关）
- `sharedEntities` 是命中的共同对象，可以直接展示给用户看「凭什么推荐这篇」

`prepareId` **15 分钟内有效**，同时最多保留 20 份。TTL 短是因为 Notion 图片是
签名 URL、约 1 小时过期，缓存久了后续上传会拿到 403。

> 缩略图 `thumbUrl` 直接在浏览器里显示会被 mmbiz 防盗链拦截，
> 需要给 `<img>` 加 `referrerpolicy="no-referrer"`。

### POST /api/publish

合成推荐板块、上传图片、建微信草稿。

```json
{
  "prepareId": "上一步拿到的 id",
  "selectedIds": [123, 456],
  "author": "作者名",
  "digest": "摘要"
}
```

- `selectedIds` — 从 `candidates` 里挑的 `id`，**空数组表示不加推荐板块**
- 带 `prepareId` 时复用缓存的解析结果，不会重新爬取
- **`prepareId` 过期返回 HTTP 410**（普通 JSON，不是 SSE）

**兼容旧用法**：不传 `prepareId`，改传 `url` + `accountName`，会走一次性流程
（爬取 + 排版 + 发布），行为与改造前一致。`mcp-server.js` 用的就是这条路径。

`done` 事件：`{ "type": "done", "ok": true, "title": "…", "media_id": "…" }`

### POST /api/delete-draft

```json
{ "accountName": "…", "mediaId": "…", "logId": 12 }
```

`logId` 选填，给了会把对应日志标记为 `deleted`。

---

## 账号与用户

### GET /api/accounts

`{ "ok": true, "accounts": [ { "id": 1, "name": "十字路口Crossing", "created_at": "…" } ] }`

不返回 appSecret。

### POST /api/accounts — 管理员

`{ "name": "...", "appId": "wx...", "appSecret": "..." }`

### DELETE /api/accounts/:name — 管理员

### GET /api/users — 管理员

`{ "ok": true, "users": [ { "id": 1, "username": "admin", "role": "admin", "created_at": "…" } ] }`

### POST /api/users — 管理员

`{ "username": "...", "password": "...", "role": "user" }`，`role` 为 `user` 或 `admin`。

### DELETE /api/users/:username — 管理员

不能删除 `admin`。

### GET /api/logs?page=1&pageSize=20

发布日志。

```json
{ "ok": true, "rows": [ { "id": 1, "operator": "admin", "url": "…", "title": "…",
  "account_name": "…", "media_id": "…", "status": "success", "error_msg": "",
  "created_at": "2026-09-04 06:52:56" } ], "total": 128, "page": 1, "pageSize": 20 }
```

`status` 取值：`success` / `error` / `deleted`。

---

## 推荐算法

理解 `candidates` 为什么是这些文章。

**召回是硬门槛**：候选必须与当前文章**共享至少一个有区分度的实体**。
没有共享实体的一律不出现，不做主题相似度兜底。

**实体**从标题和正文抽取，三个来源：拉丁词（`Cursor`、`Manus`）、
中文专名词典、书名号与直角引号内的短串。权重：标题 3、正文首段 2、其余 1，
同一实体取最大值不累加。

**泛词自动剔除**：出现在超过 15% 文章里的实体没有区分度，不作为召回依据。
`ai`（516 篇）、`koji`、`ncon`、`十字路口` 这些会自动出局，不用手工维护词表。
文章总数 < 50 时 df 不稳，改用内置停用词表（134 个，含英文虚词和泛技术词）。

**排序**：`Σ(共享实体权重积 × idf) + 0.3 × bigram余弦`。bigram 只在已召回的
候选之间决定先后，不参与召回。同分时新文章优先。

**排除**：自己（同 url / 同 sourceUrl / 同标题）、无 url 的、非 published 的。

---

## 数据库

SQLite，Railway 挂载卷 `/data`，`DATABASE_PATH=/data/data.db`。

启动日志里有一行 `[DB] 数据库位置: /data/data.db` —— **这是确认卷挂载生效的唯一证据**。
若后面跟着「（未设 DATABASE_PATH，部署后数据会丢失）」，说明数据库落在容器里，
每次部署清零。表会自动重建、admin 会自动种回，从界面上完全看不出来。

主要表：

- `articles` — 文章库，`status` 为 `pending` / `published` / `deleted`
- `article_entities` — 实体倒排，`(article_id, entity, weight)`
- `sync_meta` — 各账号上次同步时间
- `users` / `accounts` / `logs`

---

## 排版样式

文末「推荐阅读」板块目前用**方案 C（绿底白字）**。三个方案并存于
`formatter.js` 的 `buildRecommendBlock(cards, variant)`：

| variant | 形态 | 封面 |
|---|---|---|
| `a` | 左图右字，callout 底 + 绿边 | 90×90 方图 |
| `b` | 上图下字，白底黑字 + 绿边 | 全宽固定 180px 高 |
| `c` | 上图下字，绿底白字（**当前默认**） | 全宽固定 180px 高 |

封面尺寸全部写死。不裁的话遇到竖版封面会撑到一屏半，三篇读者根本翻不到底。
`object-fit` 万一被微信剥掉，图会被压扁但版面不塌。

字体、字号、字距、行高、颜色与正文严格一致（`mp-quote` 字体栈 / 15px /
`0.034em` / `1.6em` / `rgb(51,51,51)`），仅卡片标题字重为 600
（与正文 `strong` 同值）。板块标题沿用 H1 语汇但收到 20px + 4px 下边框，
不与文章真正的 H1 抢层级。
