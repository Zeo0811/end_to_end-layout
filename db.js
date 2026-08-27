// SQLite 数据库 — 用户管理 + 账号管理 + 操作日志

const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ── 建表 ──
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    app_id     TEXT NOT NULL,
    app_secret TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', '+8 hours'))
  );

  CREATE TABLE IF NOT EXISTS logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    operator     TEXT,
    url          TEXT,
    title        TEXT,
    account_name TEXT,
    media_id     TEXT,
    status       TEXT,
    error_msg    TEXT,
    created_at   TEXT DEFAULT (datetime('now', '+8 hours'))
  );

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
`);

// ── 密码哈希 ──

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return test === hash;
}

// ── 初始化默认管理员 ──

function ensureAdmin() {
  const admin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!admin) {
    const pw = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)').run(
      'admin', hashPassword(pw), 'admin'
    );
    console.log(`[DB] 默认管理员已创建 (admin / ${pw})`);
  }
}

// ── 用户 CRUD ──

function getUsers() {
  return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function addUser(username, password, role = 'user') {
  return db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(
    username, hashPassword(password), role
  );
}

function removeUser(username) {
  if (username === 'admin') throw new Error('不能删除默认管理员');
  return db.prepare('DELETE FROM users WHERE username = ?').run(username);
}

function authenticate(username, password) {
  const user = getUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.password)) return null;
  return { id: user.id, username: user.username, role: user.role };
}

// ── 从环境变量种子账号 ──

function seedAccountsFromEnv() {
  const raw = (process.env.WECHAT_ACCOUNTS || '').trim();
  if (!raw) return;
  try {
    const accounts = JSON.parse(raw);
    const upsert = db.prepare(`
      INSERT INTO accounts (name, app_id, app_secret)
      VALUES (@name, @appId, @appSecret)
      ON CONFLICT(name) DO UPDATE SET app_id = @appId, app_secret = @appSecret
    `);
    for (const a of accounts) {
      if (a.name && a.appId && a.appSecret) upsert.run(a);
    }
    console.log(`[DB] 从环境变量导入 ${accounts.length} 个公众号账号`);
  } catch (e) {
    console.error('[DB] 解析 WECHAT_ACCOUNTS 失败:', e.message);
  }
}

// ── 账号 CRUD ──

function getAccounts() {
  return db.prepare('SELECT id, name, created_at FROM accounts ORDER BY id').all();
}

function getAccountByName(name) {
  return db.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
}

function addAccount(name, appId, appSecret) {
  return db.prepare('INSERT INTO accounts (name, app_id, app_secret) VALUES (?, ?, ?)').run(name, appId, appSecret);
}

function removeAccount(name) {
  return db.prepare('DELETE FROM accounts WHERE name = ?').run(name);
}

// ── 日志 ──

function addLog({ operator, url, title, accountName, mediaId, status, errorMsg }) {
  return db.prepare(`
    INSERT INTO logs (operator, url, title, account_name, media_id, status, error_msg)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(operator || '', url || '', title || '', accountName || '', mediaId || '', status || '', errorMsg || '');
}

function updateLogStatus(id, status, errorMsg) {
  return db.prepare('UPDATE logs SET status = ?, error_msg = ? WHERE id = ?').run(status, errorMsg || '', id);
}

function getLogById(id) {
  return db.prepare('SELECT * FROM logs WHERE id = ?').get(id);
}

function getLogs(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, offset);
  const { total } = db.prepare('SELECT COUNT(*) as total FROM logs').get();
  return { rows, total, page, pageSize };
}

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
    // COALESCE：新值为 null/空串时保留旧值，避免回填时把好数据覆盖成空
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
      SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
      -- 能进推荐池的：已发布 + 有链接 + 有封面。缺封面的合不出卡片会被静默跳过，
      -- 所以这个数才是真正可用的候选量。
      SUM(CASE WHEN status = 'published' AND url IS NOT NULL AND url != ''
                AND thumb_url IS NOT NULL AND thumb_url != '' THEN 1 ELSE 0 END) AS usable
    FROM articles WHERE account_name = ?
  `).get(accountName);
  return {
    total: row.total || 0,
    published: row.published || 0,
    pending: row.pending || 0,
    usable: row.usable || 0,
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

module.exports = {
  ensureAdmin,
  seedAccountsFromEnv,
  getUsers,
  getUserByUsername,
  addUser,
  removeUser,
  authenticate,
  getAccounts,
  getAccountByName,
  addAccount,
  removeAccount,
  addLog,
  updateLogStatus,
  getLogById,
  getLogs,
  upsertArticle,
  setArticleEntities,
  getArticleEntities,
  listPublishedArticles,
  getEntityDocFreq,
  findPendingByTitle,
  getIndexStats,
  setSyncMeta,
  getSyncMeta,
};
