const { test, after } = require('node:test');
const assert   = require('node:assert');
const { formatToWechat, buildRecommendBlock, buildMemberBlock, buildPrizeBlock, MEMBER_ARTICLE } = require('../formatter');
const { buildPrizeCardHtml, renderPrizeCard, PRIZE_COPY,
        PRIZE_HEIGHT_PT, CARD_WIDTH_PT, DPR } = require('../card-renderer');
const crawler = require('../parsers/crawler');

after(async () => { await crawler.closeBrowser(); });

const PRIZE  = { dataUri: 'data:image/jpeg;base64,PRZ' };
const MEMBER = { title: MEMBER_ARTICLE.title, url: MEMBER_ARTICLE.url, dataUri: 'data:image/jpeg;base64,MEM' };
const RECO   = [{ title: '推荐文章', url: 'https://mp.weixin.qq.com/s/x', dataUri: 'data:image/jpeg;base64,AAA' }];

// ── 板块 HTML ──

test('评论有奖是一张图，没有板块标题', () => {
  const h = buildPrizeBlock(PRIZE);
  assert.strictEqual((h.match(/<img /g) || []).length, 1, '一张卡片图');
  assert.ok(h.includes('data:image/jpeg;base64,PRZ'));
  assert.ok(!/border-bottom: 8px/.test(h), '卡片里已经写了「评论有奖」，不要 H1 式大标题');
});

test('不挂链接：下面紧接着就是评论区', () => {
  assert.ok(!buildPrizeBlock(PRIZE).includes('<a '));
});

test('alt 带上完整文案，图挂了也知道是什么', () => {
  const h = buildPrizeBlock(PRIZE);
  assert.match(h, /评论有奖/);
  assert.match(h, /随机抽取 1 位/);
});

test('卡片图样式与推荐阅读同一套 token', () => {
  const imgStyle = /<img[^>]+style="([^"]+)"/;
  assert.strictEqual(buildPrizeBlock(PRIZE).match(imgStyle)[1],
                     buildRecommendBlock(RECO).match(imgStyle)[1]);
});

test('没有卡片时返回空串', () => {
  assert.strictEqual(buildPrizeBlock(null), '');
  assert.strictEqual(buildPrizeBlock({}), '');
});

test('顺序：推荐阅读 → 会员群 → 评论有奖，都在最外层 wrapper 之内', () => {
  const parsed = { title: 'T', links: [], blocks: [{ type: 'paragraph', content: '正文' }] };
  const html = formatToWechat(parsed, {
    appendHtml: buildRecommendBlock(RECO) + buildMemberBlock(MEMBER) + buildPrizeBlock(PRIZE),
  });
  const reco = html.indexOf('推荐阅读'), mem = html.indexOf('加入会员群'), prz = html.indexOf('PRZ');
  assert.ok(reco > 0 && reco < mem && mem < prz);
  assert.ok(prz < html.lastIndexOf('</section>'));
});

// ── 卡片合成 ──

test('卡片高 92pt，比推荐阅读卡片矮得多', () => {
  assert.strictEqual(PRIZE_HEIGHT_PT, 92);
  const h = buildPrizeCardHtml({ hoodieDataUri: 'data:image/png;base64,X' });
  assert.ok(h.includes(`height: ${PRIZE_HEIGHT_PT}px`));
  assert.ok(h.includes(`width: ${CARD_WIDTH_PT}px`));
});

test('文案：随机抽取，不写「一件」', () => {
  const h = buildPrizeCardHtml({ hoodieDataUri: 'data:image/png;base64,X' });
  assert.match(h, /评论有奖！/);
  assert.match(h, /从评论区/);
  assert.match(h, /随机抽取 1 位/);
  assert.match(h, /「十字路口」/);
  assert.match(h, /Hands Dirty Club/);
  assert.ok(!h.includes('一件'));
  assert.ok(!h.includes('获赞'), '规则已改成随机抽取');
  assert.match(PRIZE_COPY, /随机抽取 1 位/);
});

test('与推荐阅读卡片同一套字体、字距、品牌绿', () => {
  const { WX_LS } = require('../formatter');
  const h = buildPrizeCardHtml({ hoodieDataUri: 'data:image/png;base64,X' });
  assert.ok(h.includes('data:font/woff2;base64,'));
  assert.ok(h.includes(`letter-spacing: ${WX_LS}`));
  assert.ok(h.includes('#327848'));
  assert.ok(!/border-radius/.test(h), '直角');
});

test('「Hands Dirty Club 卫衣」不被拆行', () => {
  const h = buildPrizeCardHtml({ hoodieDataUri: 'data:image/png;base64,X' });
  assert.match(h, /<span class="nw"><b>Hands Dirty Club<\/b> 卫衣<\/span>/);
  assert.ok(h.includes('white-space: nowrap'));
});

test('renderPrizeCard: 卫衣图随仓库提供，出 1125×276 的 JPEG', async () => {
  const uri = await renderPrizeCard();
  assert.ok(uri && uri.startsWith('data:image/jpeg;base64,'));
  const buf = Buffer.from(uri.split(',')[1], 'base64');
  let i = 2, w = 0, hgt = 0;
  while (i < buf.length && buf[i] === 0xFF) {
    const m = buf[i + 1];
    if (m === 0xC0 || m === 0xC2) { hgt = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  assert.strictEqual(w, CARD_WIDTH_PT * DPR);
  assert.strictEqual(hgt, PRIZE_HEIGHT_PT * DPR);
  require('node:fs').writeFileSync(require('node:path').join(__dirname, 'prize-preview.jpg'), buf);
});
