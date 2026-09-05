const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat, buildRecommendBlock } = require('../formatter');

const PARSED = { title: 'T', blocks: [{ type: 'paragraph', content: '正文内容' }], links: [] };

const CARDS = [
  { title: '文章一', url: 'https://mp.weixin.qq.com/s?__biz=A&sn=1', publishedAt: '2025-09-25 21:41:23' },
  { title: '文章二', url: 'https://mp.weixin.qq.com/s?__biz=A&sn=2', publishedAt: '2026-08-14' },
];

const CARDS_WITH_COVER = CARDS.map((c, i) => ({ ...c, thumbUrl: `https://mmbiz.qpic.cn/cover${i}/640?wx_fmt=jpeg` }));

test('formatToWechat: 不传 options 时行为不变', () => {
  const html = formatToWechat(PARSED);
  assert.ok(html.startsWith('<section style="'));
  assert.ok(html.endsWith('</section>'));
  assert.ok(html.includes('正文内容'));
});

test('formatToWechat: appendHtml 插在最外层 section 之内', () => {
  const html = formatToWechat(PARSED, { appendHtml: '<p>尾巴</p>' });
  assert.ok(html.endsWith('<p>尾巴</p></section>'), `实际结尾: ${html.slice(-60)}`);
});

test('formatToWechat: appendHtml 为空串时不影响输出', () => {
  assert.strictEqual(formatToWechat(PARSED, { appendHtml: '' }), formatToWechat(PARSED));
});

test('buildRecommendBlock: 空数组返回空串（板块整体不出现）', () => {
  assert.strictEqual(buildRecommendBlock([]), '');
  assert.strictEqual(buildRecommendBlock(null), '');
});

test('buildRecommendBlock: 每篇都能跳转', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('推荐阅读'));
  assert.ok(html.includes('文章一'));
  assert.ok(html.includes('文章二'));
  // 无封面时每篇两个链接（标题、日期），两篇共 4 个
  assert.strictEqual((html.match(/<a href="https:\/\/mp\.weixin\.qq\.com/g) || []).length, 4);
  // 两篇各自指向自己
  assert.ok(html.includes('sn=1') && html.includes('sn=2'));
});

test('buildRecommendBlock: 封面用原图直连，不再内嵌合成图', () => {
  const html = buildRecommendBlock(CARDS_WITH_COVER);
  assert.ok(html.includes('src="https://mmbiz'), '封面应直连原图，由 processHtmlImages 转存');
  assert.ok(!html.includes('data:image'), '不应再有内嵌合成图');
});

test('buildRecommendBlock: 没有封面时不渲染 img', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(!html.includes('<img'), '没封面就不该有 img 标签');
});

test('buildRecommendBlock: 三个方案的封面尺寸都写死，避免高度失控', () => {
  assert.ok(buildRecommendBlock(CARDS_WITH_COVER, 'a').includes('width: 90px; height: 90px'), 'A 是方图');
  assert.ok(buildRecommendBlock(CARDS_WITH_COVER, 'b').includes('height: 180px'), 'B 固定高');
  assert.ok(buildRecommendBlock(CARDS_WITH_COVER, 'c').includes('height: 180px'), 'C 固定高');
});

test('buildRecommendBlock: 日期取到天，格式 YYYY.MM.DD', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('2025.09.25'));
  assert.ok(html.includes('2026.08.14'));
  assert.ok(!html.includes('21:41:23'), '不应带时分秒');
});

test('buildRecommendBlock: 没有发布时间时不渲染日期行', () => {
  const html = buildRecommendBlock([{ title: 'x', url: 'https://mp/x', publishedAt: '' }]);
  assert.ok(html.includes('x'));
  assert.ok(!html.includes('recommend_card_meta'));
  assert.strictEqual((html.match(/8a998f/g) || []).length, 0, '日期样式不应出现');
});

test('buildRecommendBlock: 标题被转义', () => {
  const html = buildRecommendBlock([
    { title: '带"引号"的<标题>', url: 'https://mp.weixin.qq.com/s/x', publishedAt: '2026-01-01' },
  ]);
  assert.ok(html.includes('&lt;标题&gt;'));
  assert.ok(!html.includes('<标题>'));
});

test('buildRecommendBlock: 字体字号字距与正文一致', () => {
  const html = buildRecommendBlock(CARDS, 'a');
  assert.ok(html.includes('mp-quote'), '必须用正文字体栈');
  assert.ok(html.includes('font-size: 15px'), '卡片标题用正文字号');
  assert.ok(html.includes('letter-spacing: 0.034em'), '字距与正文一致');
});

test('buildRecommendBlock: 板块标题与文章 H1 逐项一致', () => {
  // 早先收成 20px + 4px 边框 + 6px 下内边距，想着别抢层级，
  // 结果在微信里看着就不像同一套排版。改为与 S.h1 完全相同。
  const html = buildRecommendBlock(CARDS);
  for (const token of [
    'font-size: 24px',
    'font-weight: bold',
    'color: #327848',
    'border-bottom: 8px solid #327848',
    'padding: 0 0.25em;',
    'width: fit-content',
    'text-align: center',
    'line-height: 1.5',
  ]) {
    assert.ok(html.includes(token), `板块标题缺少 H1 的 ${token}`);
  }
  assert.ok(!html.includes('padding: 0 0.25em 6px'), '不该有额外下内边距，会把下划线推开');
});

test('buildRecommendBlock: 方案 A 沿用 callout 语汇', () => {
  const html = buildRecommendBlock(CARDS, 'a');
  assert.ok(html.includes('#f7faf8'), 'callout 底色');
  assert.ok(html.includes('border: 1px solid #327848'), 'callout 绿边');
});

test('buildRecommendBlock: 默认方案 C —— 绿底白字', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('background-color: #327848'), '标题条用品牌绿');
  assert.ok(html.includes('color: #ffffff'), '标题用白字');
});

// ── 微信结构约束（实测 draft/get 取回的 HTML 得出）──

test('buildRecommendBlock: <a> 不能包块级元素', () => {
  // 微信编辑器不允许，会把它拆成每块一个独立 <a>，并给每段套 <span leaf="">。
  // 那个 span 继承外层 1.6em 行高，在卡片里撑出约 100px 空白。
  for (const v of ['a', 'b', 'c']) {
    const html = buildRecommendBlock(CARDS_WITH_COVER, v);
    assert.ok(!/<a[^>]*>\s*<section/.test(html), `方案 ${v}: <a> 直接包了 <section>`);
  }
});

test('buildRecommendBlock: 每张卡片的图和文字各自带链接', () => {
  const html = buildRecommendBlock([CARDS_WITH_COVER[0]], 'c');
  // 一张卡片三个链接：封面、标题、日期，都指向同一篇
  const links = html.match(/<a href="[^"]+"/g) || [];
  assert.strictEqual(links.length, 3, `实际 ${links.length} 个链接`);
  assert.ok(links.every(l => l === links[0]), '三个链接应指向同一篇文章');
});

test('buildRecommendBlock: 链接颜色写在 <a> 自身，不靠父级继承', () => {
  // 微信会给 <a> 强制加 color: rgb(51,51,51)，父级继承挡不住，
  // 绿底白字方案会变成绿底深灰字，几乎看不清
  const html = buildRecommendBlock(CARDS_WITH_COVER, 'c');
  assert.ok(/<a[^>]*color: #ffffff/.test(html), '标题链接必须自带白色');
  assert.ok(/<a[^>]*color: rgba\(255,255,255,\.72\)/.test(html), '日期链接必须自带颜色');
});

test('buildRecommendBlock: 链接用 line-height: inherit，避免 span 撑高', () => {
  const html = buildRecommendBlock(CARDS_WITH_COVER, 'c');
  assert.ok(html.includes('line-height: inherit'), '微信塞的 <span leaf=""> 会继承行高撑出空白');
});

test('buildRecommendBlock: 没有 undefined 漏进样式串', () => {
  for (const v of ['a', 'b', 'c']) {
    assert.ok(!buildRecommendBlock(CARDS_WITH_COVER, v).includes('undefined'), `方案 ${v} 有 undefined`);
  }
});
