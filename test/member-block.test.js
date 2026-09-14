const { test } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat, buildRecommendBlock, buildMemberBlock } = require('../formatter');

const CARDS = [{ title: '推荐文章', url: 'https://mp.weixin.qq.com/s/x', dataUri: 'data:image/jpeg;base64,AAA' }];

test('会员群板块含标题、引子、二维码、五条权益', () => {
  const h = buildMemberBlock();
  assert.match(h, /加入会员群/);
  assert.match(h, /创业者连接中枢/);
  assert.match(h, /<img[^>]+mmbiz/, '二维码是 mmbiz 原图，发布时由 processHtmlImages 转存');
  assert.match(h, /加入会员群后，你将获得/);
  assert.strictEqual((h.match(/<li /g) || []).length, 5, '五条权益');
  assert.match(h, /AI Hacker House/);
});

test('标题与文章 H1 同一套语汇', () => {
  const h = buildMemberBlock();
  for (const t of ['font-size: 24px', 'font-weight: bold', 'color: #327848',
                   'border-bottom: 8px solid #327848', 'width: fit-content', 'text-align: center']) {
    assert.ok(h.includes(t), `缺少 H1 的 ${t}`);
  }
});

test('字体字号字距与正文一致', () => {
  const { WX_FONT, WX_SIZE, WX_LS } = require('../formatter');
  const h = buildMemberBlock();
  assert.ok(h.includes(WX_FONT));
  assert.ok(h.includes(`font-size: ${WX_SIZE}`));
  assert.ok(h.includes(`letter-spacing: ${WX_LS}`));
});

test('有推荐阅读时，会员群排在它下面', () => {
  const parsed = { title: 'T', links: [], blocks: [{ type: 'paragraph', content: '正文' }] };
  const html = formatToWechat(parsed, { appendHtml: buildRecommendBlock(CARDS) + buildMemberBlock() });
  const reco = html.indexOf('推荐阅读');
  const mem  = html.indexOf('加入会员群');
  assert.ok(reco > 0 && mem > 0);
  assert.ok(reco < mem, '推荐阅读必须在会员群前面');
  assert.ok(mem < html.lastIndexOf('</section>'), '会员群要落在最外层 wrapper 之内');
});

test('没有推荐阅读时，会员群直接接在正文后', () => {
  const parsed = { title: 'T', links: [], blocks: [{ type: 'paragraph', content: '正文内容' }] };
  const html = formatToWechat(parsed, { appendHtml: buildMemberBlock() });
  assert.ok(!html.includes('推荐阅读'));
  assert.match(html, /加入会员群/);
  assert.ok(html.indexOf('正文内容') < html.indexOf('加入会员群'));
});

test('二维码地址集中在一处，换群只改一个常量', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'formatter.js'), 'utf8');
  assert.strictEqual((src.match(/const MEMBER_QR = /g) || []).length, 1);
});
