#!/usr/bin/env node

// MCP Server — 让 AI Agent 通过标准协议调用公众号排版 API
// 用法：在 Claude Code settings 中添加 mcpServers 配置

const BASE_URL = process.env.WECHAT_PUBLISHER_URL || 'https://zeooo.cc';
const USERNAME = process.env.WECHAT_PUBLISHER_USER || 'admin';
const PASSWORD = process.env.WECHAT_PUBLISHER_PASS || '';

let cachedToken = null;

async function getToken() {
  if (cachedToken) return cachedToken;
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error('登录失败: ' + (data.error || '未知错误'));
  cachedToken = data.token;
  return cachedToken;
}

async function apiCall(method, path, body) {
  const token = await getToken();
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const timeout = path === '/api/publish' ? 300000 : 30000;
  const res = await fetch(`${BASE_URL}${path}`, { ...opts, signal: AbortSignal.timeout(timeout) });

  // SSE 流式响应（publish 接口）
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    const events = text.split('\n').filter(l => l.startsWith('data: ')).map(l => {
      try { return JSON.parse(l.slice(6)); } catch { return null; }
    }).filter(Boolean);
    const done = events.find(e => e.type === 'done');
    const progress = events.filter(e => e.type === 'progress').map(e => e.msg);
    return { progress, result: done };
  }

  return res.json();
}

// ── MCP 协议处理 ──

const tools = [
  {
    name: 'publish_to_wechat',
    description: '将 Notion 或飞书公开链接的文档发布到微信公众号草稿箱。需要提供文档的公开分享链接和目标公众号名称。注意：此操作涉及页面解析、图片上传等步骤，通常需要 1-3 分钟完成，请耐心等待结果返回，切勿因等待时间长而重复调用。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Notion 或飞书的公开分享链接' },
        accountName: { type: 'string', description: '目标公众号名称' },
        author: { type: 'string', description: '文章作者（可选）' },
        digest: { type: 'string', description: '文章摘要（可选）' },
      },
      required: ['url', 'accountName'],
    },
  },
  {
    name: 'list_wechat_accounts',
    description: '获取已配置的微信公众号列表',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_publish_logs',
    description: '获取公众号文章发布的历史操作日志',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: '页码，默认 1' },
      },
    },
  },
  {
    name: 'delete_wechat_draft',
    description: '从微信公众号草稿箱中删除指定文章',
    inputSchema: {
      type: 'object',
      properties: {
        accountName: { type: 'string', description: '公众号名称' },
        mediaId: { type: 'string', description: '草稿的 media_id' },
        logId: { type: 'number', description: '日志 ID（可选）' },
      },
      required: ['accountName', 'mediaId'],
    },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'publish_to_wechat': {
      const data = await apiCall('POST', '/api/publish', {
        url: args.url,
        accountName: args.accountName,
        author: args.author || '',
        digest: args.digest || '',
      });
      if (data.result?.ok) {
        return `发布成功！文章「${data.result.title}」已保存到草稿箱 (media_id: ${data.result.media_id})\n\n进度:\n${data.progress.join('\n')}`;
      }
      return `发布失败: ${data.result?.error || JSON.stringify(data)}`;
    }
    case 'list_wechat_accounts': {
      const data = await apiCall('GET', '/api/accounts');
      if (!data.accounts?.length) return '暂无配置的公众号';
      return '已配置的公众号:\n' + data.accounts.map(a => `- ${a.name}`).join('\n');
    }
    case 'get_publish_logs': {
      const data = await apiCall('GET', `/api/logs?page=${args.page || 1}&pageSize=10`);
      if (!data.rows?.length) return '暂无发布记录';
      return data.rows.map(r =>
        `[${r.created_at}] ${r.operator} → ${r.title || '-'} → ${r.account_name} (${r.status})`
      ).join('\n');
    }
    case 'delete_wechat_draft': {
      const data = await apiCall('POST', '/api/delete-draft', {
        accountName: args.accountName,
        mediaId: args.mediaId,
        logId: args.logId,
      });
      return data.ok ? '草稿已删除' : `删除失败: ${data.error}`;
    }
    default:
      return `未知工具: ${name}`;
  }
}

// ── stdio JSON-RPC ──

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  // 支持两种格式：Content-Length framing 和 NDJSON（换行分隔）
  while (true) {
    if (buffer.includes('\r\n\r\n')) {
      // Content-Length framing（旧格式）
      const headerEnd = buffer.indexOf('\r\n\r\n');
      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
      const len = parseInt(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + len) break;
      const body = buffer.slice(bodyStart, bodyStart + len);
      buffer = buffer.slice(bodyStart + len);
      handleMessage(JSON.parse(body));
    } else {
      // NDJSON（新格式，换行分隔）
      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) handleMessage(JSON.parse(line));
    }
  }
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleMessage(msg) {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'wechat-publisher', version: '1.0.0' },
      },
    });
  } else if (msg.method === 'notifications/initialized') {
    // no-op
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  } else if (msg.method === 'tools/call') {
    try {
      const text = await handleToolCall(msg.params.name, msg.params.arguments || {});
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } });
    } catch (e) {
      send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true } });
    }
  } else if (msg.id) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
}
