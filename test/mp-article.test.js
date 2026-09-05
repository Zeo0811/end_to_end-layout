const { test } = require('node:test');
const assert   = require('node:assert');
const { canonicalUrl, parseArticlePage, htmlToText } = require('../mp-article');

test('canonicalUrl: 保留 chksm —— 去掉它 mp 只返回 JS 壳，拿不到正文', () => {
  const raw = 'https://mp.weixin.qq.com/s?__biz=MzAx==&mid=123&idx=1&sn=abc&chksm=def&scene=126&sessionid=999';
  const out = canonicalUrl(raw);
  assert.ok(out.includes('chksm=def'), 'chksm 必须保留');
  assert.ok(!out.includes('scene='), 'scene 是跟踪参数，必须清掉');
  assert.ok(!out.includes('sessionid='), 'sessionid 必须清掉');
});

test('canonicalUrl: __biz 末尾的 == 不能被编码', () => {
  const out = canonicalUrl('https://mp.weixin.qq.com/s?__biz=MzAxMDMxOTI2NA==&mid=1&idx=1&sn=a&chksm=b');
  assert.ok(out.includes('__biz=MzAxMDMxOTI2NA=='), `编码成 %3D%3D 微信会 302 到错误页，实际: ${out}`);
  assert.ok(!out.includes('%3D'));
});

test('canonicalUrl: 同一篇文章的不同分享链接归一到同一个 url', () => {
  const base = 'https://mp.weixin.qq.com/s?__biz=A==&mid=1&idx=1&sn=x&chksm=y';
  assert.strictEqual(canonicalUrl(base + '&scene=126&sessionid=111'), canonicalUrl(base + '&scene=21&sessionid=222'));
});

test('canonicalUrl: 非公众号链接返回 null', () => {
  assert.strictEqual(canonicalUrl('https://example.com/a'), null);
  assert.strictEqual(canonicalUrl(''), null);
  assert.strictEqual(canonicalUrl('随便一段话'), null);
});

test('canonicalUrl: 兼容 HTML 转义过的 &amp;', () => {
  const out = canonicalUrl('https://mp.weixin.qq.com/s?__biz=A==&amp;mid=1&amp;idx=1&amp;sn=x&amp;chksm=y');
  assert.ok(out.includes('mid=1') && out.includes('sn=x') && out.includes('chksm=y'));
});

test('parseArticlePage: 解析标题、封面、发布时间', () => {
  const html = `
    <script>
      var msg_title = '实测 Cursor 2.0'.html(false);
      var msg_cdn_url = "https://mmbiz.qpic.cn/abc/640?wx_fmt=jpeg";
      var ct = "1757059200";
    </script>
    <div id="js_content" style="visibility: hidden;"><p>正文第一段</p><p>第二段</p></div>`;
  const a = parseArticlePage(html);
  assert.strictEqual(a.title, '实测 Cursor 2.0');
  assert.strictEqual(a.thumbUrl, 'https://mmbiz.qpic.cn/abc/640?wx_fmt=jpeg');
  assert.ok(a.publishedAt.startsWith('2025-09-05'), `实际 ${a.publishedAt}`);
});

test('parseArticlePage: 正文不含容器自身的属性', () => {
  const html = `<script>var msg_title = 'T';</script>
    <div id="js_content" style="visibility: hidden; opacity: 0;"><p>真正的正文</p></div>`;
  const a = parseArticlePage(html);
  assert.ok(a.bodyText.startsWith('真正的正文'), `实际开头: ${a.bodyText.slice(0, 40)}`);
  assert.ok(!a.bodyText.includes('visibility'), '容器属性不该混进正文');
});

test('parseArticlePage: 没有 js_content 时正文为空而不是抛错', () => {
  const a = parseArticlePage(`<script>var msg_title = 'T';</script><body>壳</body>`);
  assert.strictEqual(a.title, 'T');
  assert.strictEqual(a.bodyText, '');
});

test('htmlToText: 剥标签、解实体、压空白', () => {
  const t = htmlToText('<p>你好&nbsp;世界</p><script>var a=1</script><p>第二段</p>');
  assert.ok(t.includes('你好 世界'));
  assert.ok(t.includes('第二段'));
  assert.ok(!t.includes('var a=1'));
  assert.ok(!t.includes('<'));
});

// ── 短链 /s/<hash> ──
// 从微信「复制链接」拿到的就是这种，也是最常见的形式。
// 早先 canonicalUrl 只认长链，短链因为没有查询参数被直接判无效。

test('canonicalUrl: 短链原样保留', () => {
  const u = 'https://mp.weixin.qq.com/s/iDE0Dj5xsiHAebhFIqjEZg';
  assert.strictEqual(canonicalUrl(u), u);
});

test('canonicalUrl: 短链的跟踪参数和锚点被清掉', () => {
  const want = 'https://mp.weixin.qq.com/s/iDE0Dj5xsiHAebhFIqjEZg';
  assert.strictEqual(canonicalUrl(want + '?from=timeline&isappinstalled=0'), want);
  assert.strictEqual(canonicalUrl(want + '#rd'), want);
  assert.strictEqual(canonicalUrl(want + '?from=groupmessage#rd'), want);
});

test('canonicalUrl: 同一篇短链的不同分享形式归一到同一个 url', () => {
  const base = 'https://mp.weixin.qq.com/s/AbCdEf123456';
  assert.strictEqual(canonicalUrl(base + '?from=timeline'), canonicalUrl(base + '?from=singlemessage'));
});

test('canonicalUrl: 短链不需要 chksm（它本身就是永久规范链接）', () => {
  const out = canonicalUrl('https://mp.weixin.qq.com/s/iDE0Dj5xsiHAebhFIqjEZg');
  assert.ok(out);
  assert.ok(!out.includes('chksm'), '短链不该被要求带 chksm');
});

test('canonicalUrl: 长链仍然照常工作', () => {
  const out = canonicalUrl('https://mp.weixin.qq.com/s?__biz=MzAx==&mid=1&idx=1&sn=abc&chksm=d&scene=126');
  assert.ok(out.includes('__biz=MzAx=='));
  assert.ok(out.includes('chksm=d'));
  assert.ok(!out.includes('scene='));
});

test('canonicalUrl: 路径像短链但太短的不认', () => {
  assert.strictEqual(canonicalUrl('https://mp.weixin.qq.com/s/abc'), null);
});
