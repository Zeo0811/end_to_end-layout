// 现在的 notion.site 公开页在 .notion-page-content 和内容块之间多套了好几层 div，
// 解析器原来只遍历直接子元素，一个块都认不出来，发布出去正文为空。
const { test, after } = require('node:test');
const assert  = require('node:assert');
const fs      = require('node:fs');
const path    = require('node:path');
const crawler = require('../parsers/crawler');

after(async () => { await crawler.closeBrowser(); });
const CODE = fs.readFileSync(path.join(__dirname, '..', 'parsers', 'notion-parser.js'), 'utf8');

const text = (id, t) => `<div data-block-id="${id}" data-block-type="text"><div data-content-editable-leaf="true">${t}</div></div>`;
const li   = (id, t) => `<div data-block-id="${id}" data-block-type="bulleted_list"><div data-content-editable-leaf="true">${t}</div></div>`;

async function parse(bodyHtml) {
  const browser = await crawler.ensureBrowser();
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  try {
    await page.setContent(`<html><head><title>T | Notion</title></head><body>${bodyHtml}</body></html>`);
    return await page.evaluate(code => { eval(code); return parseNotion(); }, CODE);
  } finally { await ctx.close(); }
}

test('内容块被多层 div 包着（notion.site 现状）也能解析出来，顺序不变', async () => {
  const wrap = h => `<div><div>${h}</div></div>`;
  const r = await parse(`<div class="notion-page-content"><div><div>
    ${wrap(text('a', '第一段'))}${wrap(li('b', '列表一'))}${wrap(li('c', '列表二'))}${wrap(text('d', '第二段'))}
  </div></div></div>`);
  assert.deepStrictEqual(r.blocks.map(b => b.type), ['paragraph', 'bulleted_list', 'paragraph']);
  assert.strictEqual(r.blocks[0].content, '第一段');
  assert.strictEqual(r.blocks[1].items.length, 2);
  assert.strictEqual(r.blocks[2].content, '第二段');
});

test('内容块是直接子元素（老结构）结果不变', async () => {
  const r = await parse(`<div class="notion-page-content">${text('a', '第一段')}${li('b', '列表一')}</div>`);
  assert.deepStrictEqual(r.blocks.map(b => b.type), ['paragraph', 'bulleted_list']);
});
