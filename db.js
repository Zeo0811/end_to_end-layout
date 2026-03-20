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
    created_at TEXT DEFAULT (datetime('now'))
  );

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

function addLog({ operator, url, title, accountName, status, errorMsg }) {
  return db.prepare(`
    INSERT INTO logs (operator, url, title, account_name, status, error_msg)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(operator || '', url || '', title || '', accountName || '', status || '', errorMsg || '');
}

function getLogs(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, offset);
  const { total } = db.prepare('SELECT COUNT(*) as total FROM logs').get();
  return { rows, total, page, pageSize };
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
  getLogs,
};
