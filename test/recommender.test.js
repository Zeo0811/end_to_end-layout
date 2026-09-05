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

// ── 噪声实体过滤 ──

test('looksLikeGarbage: 图片 URL / 追踪 ID 残留被识别', () => {
  const { looksLikeGarbage } = require('../recommender');
  assert.strictEqual(looksLikeGarbage('brwkusp51itvvmbpcxncz1'), true, '长乱码串');
  assert.strictEqual(looksLikeGarbage('ffcnsoq3kicszsk'), true, '无元音长串');
  assert.strictEqual(looksLikeGarbage('cursor'), false);
  assert.strictEqual(looksLikeGarbage('gpt-5'), false);
  assert.strictEqual(looksLikeGarbage('manus'), false);
  assert.strictEqual(looksLikeGarbage('deepseek'), false);
});

test('extractEntities: 乱码串不入库', () => {
  const e = extractEntities('标题', '图片 brwkusp51itvvmbpcxncz1 在这里');
  assert.strictEqual(e['brwkusp51itvvmbpcxncz1'], undefined);
});

test('extractEntities: 两字母缩写不入库（噪声远多于信号）', () => {
  const e = extractEntities('AB CD 测试', '');
  assert.deepStrictEqual(e, {});
});

test('extractEntities: 停用词在抽取阶段就被挡掉', () => {
  const e = extractEntities('聊聊 AI 和 App', '');
  assert.strictEqual(e.ai, undefined);
  assert.strictEqual(e.app, undefined);
});

test('extractEntities: 正常产品名不受影响', () => {
  const e = extractEntities('Cursor 与 DeepSeek 对比', 'Manus 也参战了');
  assert.strictEqual(e.cursor, 3);
  assert.strictEqual(e.deepseek, 3);
  assert.strictEqual(e.manus, 2);
});

test('recommend: 标题相同的候选被排除（重发旧文场景）', () => {
  const out = recommend({
    current: { entities: { cursor: 3 }, summaryText: 'x', url: '', sourceUrl: '', title: '同一篇' },
    candidates: [
      { id: 1, title: '同一篇', url: 'https://mp/1', thumbUrl: 't', entities: { cursor: 3 }, summaryText: 'x', publishedAt: '2026-01-01' },
      { id: 2, title: '另一篇', url: 'https://mp/2', thumbUrl: 't', entities: { cursor: 3 }, summaryText: 'x', publishedAt: '2026-01-01' },
    ],
    docFreq: { cursor: 5 }, totalDocs: 1000, limit: 8,
  });
  assert.deepStrictEqual(out.map(x => x.id), [2]);
});

// ── 展示顺序：最新发布的在上面 ──

test('recommend: 结果按发布时间倒序展示', () => {
  const base = { entities: { cursor: 3 }, summaryText: 'x', thumbUrl: 't' };
  const out = recommend({
    current: { entities: { cursor: 3 }, summaryText: 'x', url: '', sourceUrl: '' },
    candidates: [
      { id: 1, title: '2024 年的', url: 'https://mp/1', publishedAt: '2024-03-11', ...base },
      { id: 2, title: '2026 年的', url: 'https://mp/2', publishedAt: '2026-08-14', ...base },
      { id: 3, title: '2025 年的', url: 'https://mp/3', publishedAt: '2025-09-25', ...base },
    ],
    docFreq: { cursor: 5 }, totalDocs: 1000, limit: 8,
  });
  assert.deepStrictEqual(out.map(x => x.id), [2, 3, 1], '应是 2026 → 2025 → 2024');
});

test('recommend: 先按相关度截到 limit，再按时间排——不能让旧的高相关被新的低相关挤掉', () => {
  const mk = (id, ents, at) => ({ id, title: 't' + id, url: 'https://mp/' + id,
    thumbUrl: 't', entities: ents, summaryText: 'x', publishedAt: at });
  const out = recommend({
    current: { entities: { cursor: 3, manus: 3 }, summaryText: 'x', url: '', sourceUrl: '' },
    candidates: [
      mk(1, { cursor: 3, manus: 3 }, '2024-01-01'),  // 最相关但最旧
      mk(2, { cursor: 1 },           '2026-01-01'),  // 最新但只沾一点
      mk(3, { cursor: 1 },           '2026-02-01'),
    ],
    docFreq: { cursor: 5, manus: 5 }, totalDocs: 1000, limit: 2,
  });
  // 相关度选出 1 和 3（1 共享两个实体分最高，3 比 2 新），再按时间倒序
  assert.strictEqual(out.length, 2);
  assert.ok(out.some(x => x.id === 1), '最相关的那篇不能因为旧就被挤掉');
  assert.deepStrictEqual(out.map(x => x.id), [3, 1], '展示顺序仍是新在前');
});

test('recommend: 没有发布时间的排在有时间的后面', () => {
  const base = { entities: { cursor: 3 }, summaryText: 'x', thumbUrl: 't' };
  const out = recommend({
    current: { entities: { cursor: 3 }, summaryText: 'x', url: '', sourceUrl: '' },
    candidates: [
      { id: 1, title: '无日期', url: 'https://mp/1', publishedAt: '', ...base },
      { id: 2, title: '有日期', url: 'https://mp/2', publishedAt: '2026-01-01', ...base },
    ],
    docFreq: { cursor: 5 }, totalDocs: 1000, limit: 8,
  });
  assert.deepStrictEqual(out.map(x => x.id), [2, 1]);
});
