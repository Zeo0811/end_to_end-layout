const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat } = require('../formatter');

const LINKS = [
  { text: '支持开源模型的公开信', url: 'https://images.nvidia.com/pdf/Open-Weights.pdf' },
  { text: 'Packy McCormick',    url: 'https://x.com/packyM/status/2080660505811669274?s=20' },
];
const parsed = { title: 'T', blocks: [{ type: 'paragraph', content: '正文' }], links: LINKS };

test('脚注显式左对齐 —— 否则会继承两端对齐，短标签被拉满整行', () => {
  const html = formatToWechat(parsed);
  // 从脚注容器起切，否则会把「参考资料」标题自己的样式漏在外面
  const seg = html.slice(html.indexOf('border-top: 1px solid rgba(0,0,0,.15)'));
  // 标题和每一条都要有
  assert.strictEqual((seg.match(/text-align: left/g) || []).length, LINKS.length + 1,
    '「参考资料」标题和每条脚注都该显式左对齐');
  assert.ok(!seg.includes('text-align: justify'));
});

test('脚注内容完整：编号、说明、链接', () => {
  const html = formatToWechat(parsed);
  assert.ok(html.includes('参考资料'));
  assert.ok(html.includes('[1]') && html.includes('[2]'));
  assert.ok(html.includes('支持开源模型的公开信'));
  assert.ok(html.includes('https://x.com/packyM/status/2080660505811669274?s=20'));
});

test('没有链接时不渲染参考资料整段', () => {
  const html = formatToWechat({ title: 'T', blocks: [{ type: 'paragraph', content: '正文' }], links: [] });
  assert.ok(!html.includes('参考资料'));
});
