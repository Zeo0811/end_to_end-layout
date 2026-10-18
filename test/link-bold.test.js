// 链接里的加粗不能丢：Notion 里「先加链接再加粗」时 DOM 是 <a><span 加粗>…</span></a>，
// 解析器原来直接取 a.textContent，加粗被吃掉，成品里变成黑色细体。
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const CONTENT = path.join(__dirname, '..', 'parsers');

// 解析器只用到这几样 DOM 接口，搭个最小假 DOM，免得为测试引入 jsdom
const Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
const text = s => ({ nodeType: 3, textContent: s, childNodes: [] });
const el = (tag, attrs, ...children) => ({
  nodeType: 1, tagName: tag.toUpperCase(), childNodes: children,
  getAttribute: k => (k in attrs ? attrs[k] : null),
  classList: { contains: c => (attrs.class || '').split(/\s+/).includes(c) },
  get textContent() { return children.map(c => c.textContent).join(''); },
});
const bold = (...c) => el('span', { style: 'font-weight:600' }, ...c);
const a    = (href, ...c) => el('a', { href }, ...c);
const root = (...c) => el('div', {}, ...c);

function load(file, fn) {
  const ctx = vm.createContext({ Node, console });
  vm.runInContext(fs.readFileSync(path.join(CONTENT, file), 'utf8'), ctx);
  return ctx[fn];
}

for (const [file, fn] of [['notion-parser.js', 'convertNodeToHtml'], ['feishu-parser.js', 'convertFeishuNodeToHtml']]) {
  const convert = load(file, fn);

  test(`${file}: 链接在外、加粗在里 → 保留加粗`, () => {
    const links = [];
    const h = convert(root(text('用了 '), a('https://b.example', bold(text('Claude Code'))), text(' 写代码')), links);
    assert.strictEqual(h, '用了 <strong>Claude Code</strong><sup>[1]</sup> 写代码');
    // links 里的对象建在 vm 沙箱里，原型不同，按 JSON 比
    assert.strictEqual(JSON.stringify(links), JSON.stringify([{ text: 'Claude Code', url: 'https://b.example' }]), '参考资料里仍是纯文本');
  });

  test(`${file}: 链接里只有部分加粗 → 只加粗那部分`, () => {
    const h = convert(root(a('https://c.example', text('官方文档的'), bold(text('安装章节')))), []);
    assert.strictEqual(h, '官方文档的<strong>安装章节</strong><sup>[1]</sup>');
  });

  test(`${file}: 加粗在外、链接在里 → 行为不变`, () => {
    const h = convert(root(bold(a('https://a.example', text('Claude Code')))), []);
    assert.strictEqual(h, '<strong>Claude Code<sup>[1]</sup></strong>');
  });

  test(`${file}: 普通链接 → 行为不变`, () => {
    assert.strictEqual(convert(root(a('https://d.example', text('官方文档'))), []), '官方文档<sup>[1]</sup>');
  });

  test(`${file}: 链接文字仍做转义`, () => {
    assert.strictEqual(convert(root(a('https://e.example', text('<x>'))), []), '&lt;x&gt;<sup>[1]</sup>');
  });
}

// callout 里的公众号链接直接渲染成 <a>（不进参考资料），里面的加粗同样要保留
for (const [file, fn] of [['notion-parser.js', 'convertNodeToHtml'], ['feishu-parser.js', 'convertFeishuNodeToHtml']]) {
  const convert = load(file, fn);
  test(`${file}: callout 内公众号链接保留加粗`, () => {
    const links = [];
    const h = convert(root(a('https://mp.weixin.qq.com/s/abc', bold(text('往期文章')))), links, 'callout');
    assert.match(h, /^<a href="https:\/\/mp\.weixin\.qq\.com\/s\/abc" data-wechat-callout="1"><strong>往期文章<\/strong><\/a>$/);
    assert.strictEqual(links.length, 0);
  });
}
