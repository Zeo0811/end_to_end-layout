// SQLite 数据库 — 账号管理 + 操作日志

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');
const db = new Database(dbPath);

// WAL 模式提高并发性能
db.pragma('journal_mode = WAL');

// ── 建表 ──
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    app_id     TEXT NOT NULL,
    app_secret TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    operator     TEXT,
    url          TEXT,
    title        TEXT,
    account_name TEXT,
    status       TEXT,
    error_msg    TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );
`);

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
      if (a.name && a.appId && a.appSecret) {
        upsert.run(a);
      }
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
  return db.prepare(
    'INSERT INTO accounts (name, app_id, app_secret) VALUES (?, ?, ?)'
  ).run(name, appId, appSecret);
}

function removeAccount(name) {
  return db.prepare('DELETE FROM accounts WHERE name = ?').run(name);
}

// ── 日志 ──

function addLog({ operator, url, title, accountName, status, errorMsg }) {
  return db.prepare(`
    INSERT INTO logs (operator, url, title, account_name, status, error_msg)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(operator || '', url || '', title || '', accountName || '', status || '', errorMsg || '');
}

function getLogs(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(
    'SELECT * FROM logs ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(pageSize, offset);
  const { total } = db.prepare('SELECT COUNT(*) as total FROM logs').get();
  return { rows, total, page, pageSize };
}

module.exports = {
  seedAccountsFromEnv,
  getAccounts,
  getAccountByName,
  addAccount,
  removeAccount,
  addLog,
  getLogs,
};
