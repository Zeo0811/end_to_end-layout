const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat, buildRecommendBlock } = require('../formatter');

const PARSED = { title: 'T', blocks: [{ type: 'paragraph', content: '正文内容' }], links: [] };


// 卡片是合成好的图，buildRecommendBlock 只负责套 <a> 和 <img>
const CARDS = [
  { title: '文章一', url: 'https://mp.weixin.qq.com/s?__biz=A&sn=1', dataUri: 'data:image/jpeg;base64,AAA' },
  { title: '文章二', url: 'https://mp.weixin.qq.com/s?__biz=A&sn=2', dataUri: 'data:image/jpeg;base64,BBB' },
];

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









test('buildRecommendBlock: 每张卡片一张图配一个链接', () => {
  const html = buildRecommendBlock(CARDS);
  assert.ok(html.includes('推荐阅读'));
  assert.strictEqual((html.match(/<a [^>]*href="https:\/\/mp\.weixin\.qq\.com/g) || []).length, 2);
  assert.strictEqual((html.match(/<img /g) || []).length, 2);
  assert.ok(html.includes('data:image/jpeg;base64,AAA'));
  assert.ok(html.includes('data:image/jpeg;base64,BBB'));
});

test('buildRecommendBlock: <a> 里只有 <img>，没有块级元素', () => {
  // 微信会拆开跨块级的 <a>，并给文字链接自动加小图标
  const html = buildRecommendBlock(CARDS);
  assert.ok(!/<a[^>]*>\s*<section/.test(html), '<a> 不能包 section');
  assert.ok(/<a[^>]*>\s*<img/.test(html), '<a> 里应直接是 img');
});

test('buildRecommendBlock: alt 用标题且被转义', () => {
  const html = buildRecommendBlock([{ title: '带<尖括号>的标题', url: 'https://mp/x', dataUri: 'data:image/jpeg;base64,X' }]);
  assert.ok(html.includes('&lt;尖括号&gt;'));
  assert.ok(!html.includes('<尖括号>'));
});

test('buildRecommendBlock: 板块标题与文章 H1 逐项一致', () => {
  const html = buildRecommendBlock(CARDS);
  for (const t of ['font-size: 24px', 'font-weight: bold', 'color: #327848',
                   'border-bottom: 8px solid #327848', 'padding: 0 0.25em;',
                   'width: fit-content', 'text-align: center', 'line-height: 1.5']) {
    assert.ok(html.includes(t), `缺少 H1 的 ${t}`);
  }
});

// ── 微信内链形态 ──
//
// 背景：微信群发时会把它不认识的 <a> 换成 <span leaf="">，链接就没了。
// 草稿和预览不走这道处理，所以只在发布后暴露。实测网页端发布正常、
// 手机端被剥，抓回网页端发出来的文章可以看到微信把 <a> 补成了
// 「一套内链属性 + 带 scene=21#wechat_redirect 的规范长链」。

const { planVariants, wxCanonicalHref, buildMemberBlock } = require('../formatter');

const LONG  = 'https://mp.weixin.qq.com/s?__biz=MzAxMDMxOTI2NA==&mid=2649104479&idx=1&sn=358e909&chksm=82fbedb5';
const SHORT = 'https://mp.weixin.qq.com/s/CqviSY5cyyT6Rj';

test('wxCanonicalHref: 长链补上 scene=21 和 #wechat_redirect', () => {
  assert.strictEqual(wxCanonicalHref(LONG), LONG + '&scene=21#wechat_redirect');
});

test('wxCanonicalHref: 短链没有这两段可补，原样返回', () => {
  assert.strictEqual(wxCanonicalHref(SHORT), SHORT);
});

test('wxCanonicalHref: 已经带 #wechat_redirect 的不重复追加', () => {
  const done = LONG + '&scene=21#wechat_redirect';
  assert.strictEqual(wxCanonicalHref(done), done);
});

test('wxCanonicalHref: 已有 scene 参数时不再塞一个', () => {
  const withScene = LONG + '&scene=27';
  assert.strictEqual(wxCanonicalHref(withScene), withScene + '#wechat_redirect');
});

test('wxCanonicalHref: 非微信链接不动', () => {
  assert.strictEqual(wxCanonicalHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
});

test('href 里的 & 一律转义成 &amp;', () => {
  // 长链带 &mid=，而 mid 是个合法 HTML 实体名，不转义有被解析器吃掉的风险。
  // 微信自己生成的链接也是 &amp; 形式。
  const html = buildRecommendBlock([{ title: 'T', url: LONG, dataUri: 'data:image/jpeg;base64,A' }]);
  const href = html.match(/href="([^"]+)"/)[1];
  assert.ok(href.includes('&amp;mid='), `href 未转义: ${href}`);
  assert.ok(!/&(?!amp;)/.test(href), `href 里还有裸 &: ${href}`);
});

test('buildMemberBlock: 带全套微信内链属性', () => {
  const html = buildMemberBlock({ title: '入群', url: SHORT, dataUri: 'data:image/jpeg;base64,D' });
  for (const attr of ['target="_blank"', 'textvalue=""', 'linktype="text"', 'data-linktype="2"']) {
    assert.ok(html.includes(attr), `会员群卡片缺少 ${attr}`);
  }
});

test('planVariants: 三张长链把三种写法排满', () => {
  assert.deepStrictEqual(
    [...planVariants([LONG, LONG, LONG])].sort(),
    ['attrs-only', 'bare', 'href-only'],
  );
});

test('planVariants: 长短混排时 href-only 落在长链上', () => {
  // href-only 落在短链上和对照组完全一样，那一格就白占了
  const plan = planVariants([SHORT, LONG, SHORT]);
  assert.strictEqual(plan[1], 'href-only');
  assert.deepStrictEqual([...plan].sort(), ['attrs-only', 'bare', 'href-only']);
});

test('planVariants: 全是短链时不排 href-only', () => {
  assert.ok(!planVariants([SHORT, SHORT]).includes('href-only'));
});

test('planVariants: 每张卡片都拿到一种写法，不留空', () => {
  for (const urls of [[LONG], [SHORT], [LONG, SHORT], [LONG, LONG, SHORT, LONG]]) {
    const plan = planVariants(urls);
    assert.strictEqual(plan.length, urls.length);
    assert.ok(plan.every(Boolean), `有卡片没分到写法: ${JSON.stringify(plan)}`);
  }
});
