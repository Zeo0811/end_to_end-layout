# 十字路口·公众号排版

端到端公众号排版工具 — 输入 Notion / 飞书链接，一键发布到微信公众号草稿箱。

## 功能

- **一键发布**：粘贴 Notion / 飞书公开链接 → 自动爬取解析 → 排版格式化 → 发布到公众号草稿箱
- **多公众号管理**：支持配置多个微信公众号，切换发布
- **用户权限**：管理员 / 普通用户角色，管理员可管理账号和用户
- **操作日志**：记录所有发布操作，支持删除草稿
- **样式预览**：查看所有排版元素（标题、段落、代码块、表格等）的实际渲染效果
- **实时进度**：SSE 流式推送发布进度，按钮进度条 + 实时日志

## 架构

```
Notion/飞书公开链接
    ↓
Playwright 无头浏览器打开页面
    ↓
注入 Parser 解析 DOM → 结构化 JSON blocks
    ↓
Formatter 格式化为公众号 HTML（内联样式 + 代码高亮）
    ↓
微信公众号 API → 上传图片/视频 → 创建草稿
```

## 技术栈

- **后端**：Node.js + Express
- **爬取**：Playwright（Chromium 无头浏览器）
- **数据库**：SQLite（better-sqlite3）
- **格式化**：highlight.js 代码高亮
- **部署**：Railway（Nixpacks）

## 部署

### Railway 部署

1. Fork 本仓库
2. Railway → New Project → Deploy from GitHub repo
3. 添加 Volume，Mount Path：`/data`
4. 配置环境变量：

| 变量 | 说明 | 必填 |
|------|------|------|
| `PORT` | 服务端口 | 是（Railway 默认 8080） |
| `ADMIN_PASSWORD` | 管理员初始密码 | 是 |
| `DATABASE_PATH` | 数据库路径 | 是（填 `/data/data.db`） |

5. 生成域名或绑定自定义域名
6. 登录后在管理后台添加公众号 AppID / AppSecret

### 本地开发

```bash
git clone https://github.com/Zeo0811/end_to_end-layout.git
cd end_to_end-layout
npm install
cp .env.example .env  # 编辑 .env 填入配置
npm start             # http://localhost:3000
```

默认管理员：`admin` / `admin123`（可通过 `ADMIN_PASSWORD` 环境变量修改）

## API

所有接口需要 `Authorization: Bearer <token>` 头，通过 `/api/login` 获取 token。

### 发布文章

```
POST /api/publish
Content-Type: application/json

{
  "url": "https://xxx.notion.site/xxx",
  "accountName": "公众号名称",
  "author": "作者（可选）",
  "digest": "摘要（可选）"
}
```

返回 SSE 流：
```
data: {"type":"progress","step":1,"percent":10,"msg":"正在打开页面..."}
data: {"type":"progress","step":2,"percent":35,"msg":"已解析「标题」12 个内容块"}
data: {"type":"progress","step":3,"percent":45,"msg":"正在排版格式化..."}
data: {"type":"progress","step":4,"percent":60,"msg":"正在上传图片到微信..."}
data: {"type":"progress","step":5,"percent":100,"msg":"发布成功！"}
data: {"type":"done","ok":true,"title":"文章标题","media_id":"xxx"}
```

### 其他接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/login` | POST | 登录，获取 token |
| `/api/me` | GET | 获取当前用户信息 |
| `/api/accounts` | GET | 获取公众号列表 |
| `/api/accounts` | POST | 添加公众号（管理员） |
| `/api/accounts/:name` | DELETE | 删除公众号（管理员） |
| `/api/users` | GET | 获取用户列表（管理员） |
| `/api/users` | POST | 添加用户（管理员） |
| `/api/users/:username` | DELETE | 删除用户（管理员） |
| `/api/delete-draft` | POST | 删除公众号草稿 |
| `/api/logs` | GET | 获取操作日志 |

## Agent Skill

本工具可作为 AI Agent 的 skill 使用，配置见 [`skill.json`](./skill.json)。

### 配置环境变量

```
SKILL_BASE_URL=https://your-domain.com
SKILL_USERNAME=admin
SKILL_PASSWORD=your-password
```

### 使用示例

Agent 可通过 API 调用以下能力：

- **发布文章**：传入 Notion/飞书链接 + 公众号名称，自动完成排版发布
- **查询公众号**：获取已配置的公众号列表
- **查看日志**：获取历史发布记录
- **删除草稿**：从公众号草稿箱中移除文章

## 微信公众号配置

1. 公众号后台 → 设置与开发 → 基本配置
2. 获取 AppID 和 AppSecret
3. IP 白名单中添加服务器出口 IP（Railway 部署日志中可见）
4. 在管理后台添加公众号信息

## 项目来源

从 [Layout-design](https://github.com/Zeo0811/Layout-design)（Chrome 插件版排版工具）演化而来，去掉了浏览器插件依赖，实现端到端自动化。
