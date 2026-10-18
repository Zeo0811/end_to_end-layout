// 列表排版：悬挂缩进、bullet 与文字间距、列表前后间距与段落一致
const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat } = require('../formatter');

const LONG = '这是一条很长的列表项，长到会在手机屏幕上自动折成两到三行';
const doc = (blocks) => ({ title: 'T', links: [], blocks });
const ul = (items) => ({ type: 'bulleted_list', items });
const ol = (items) => ({ type: 'numbered_list', items });
const itemP = (html, text) => html.match(new RegExp(`<p style="([^"]+)"><span style="([^"]+)">[^<]*</span>${text}`));

test('无序：悬挂缩进 1em，折行与首行文字对齐', () => {
  const m = itemP(formatToWechat(doc([ul([{ content: LONG }])])), LONG);
  assert.ok(m[1].includes('padding-left: 1em') && m[1].includes('text-indent: -1em'), m[1]);
  assert.ok(m[2].includes('width: 1em') && m[2].includes('text-indent: 0'), m[2]);
  assert.ok(!m[2].includes('margin-right'), 'bullet 后不再额外加边距');
});

test('有序：数字比圆点宽，用 1.3em', () => {
  const m = itemP(formatToWechat(doc([ol([{ content: LONG }])])), LONG);
  assert.ok(m[1].includes('padding-left: 1.3em') && m[1].includes('text-indent: -1.3em'), m[1]);
  assert.ok(m[2].includes('width: 1.3em'));
});

test('嵌套每层多缩 1.5em', () => {
  const h = formatToWechat(doc([ul([{ content: '父', children: [ul([{ content: '子项' }])] }])]));
  assert.ok(itemP(h, '子项')[1].includes('padding-left: 2.5em'));
});

test('整项加粗时 bullet 仍是绿色加粗，且同样悬挂缩进', () => {
  const m = itemP(formatToWechat(doc([ul([{ content: '<strong>全粗</strong>' }])])), '<strong');
  assert.ok(m[2].includes('font-weight: 600') && m[2].includes('#327848'));
  assert.ok(m[2].includes('width: 1em') && m[2].includes('text-indent: 0'));
});

test('顶层列表收尾补到 30px（5 + 25），列表开头不再多 5px', () => {
  const h = formatToWechat(doc([ul([{ content: 'a' }, { content: 'b' }])]));
  assert.ok(h.includes('<section style="padding-bottom: 25px;"><p'));
  assert.ok(!h.includes('margin-bottom: 1em;'), '旧的 1em 收尾去掉');
  assert.ok(itemP(h, 'a')[1].includes('margin: 0 0 5px'));
});
