// WeChat 公众号 HTML 格式化器（Node.js 版本）
// 从 Layout-design/chrome-extension/popup/formatter.js 移植
// 变更：用 require('highlight.js') 替换浏览器全局 hljs

const hljs = require('highlight.js');

// ── 字体 ──
const FONT = "Optima-Regular, Optima, PingFangSC-light, PingFangTC-light, 'PingFang SC', Cambria, Cochin, Georgia, Times, 'Times New Roman', serif";
const MONO = 'Operator Mono, Consolas, Monaco, Menlo, monospace';
// 微信公众号「默认」正文样式（取自 mp.weixin.qq.com 阅读页与编辑器默认字体 span 的实际取值）
const WX_FONT = "mp-quote, 'PingFang SC', system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', Arial, sans-serif";
const WX_SIZE = '15px', WX_COLOR = 'rgb(51,51,51)', WX_LS = '0.034em', WX_LH = '1.6';
const WX_P_LH = '1.6em', WX_GAP = '30px';  // 正文行高用 em、块间距 30px

// ── 代码语法高亮色表 ──
const CODE_THEME = {
  'hljs-comment':           { color: '#697070' },
  'hljs-punctuation':       { color: '#444a' },
  'hljs-tag':               { color: '#444a' },
  'hljs-attribute':         { 'font-weight': '700' },
  'hljs-doctag':            { 'font-weight': '700' },
  'hljs-keyword':           { 'font-weight': '700' },
  'hljs-name':              { 'font-weight': '700' },
  'hljs-selector-tag':      { 'font-weight': '700' },
  'hljs-deletion':          { color: '#800' },
  'hljs-number':            { color: '#800' },
  'hljs-quote':             { color: '#800' },
  'hljs-selector-class':    { color: '#800' },
  'hljs-selector-id':       { color: '#800' },
  'hljs-string':            { color: '#800' },
  'hljs-template-tag':      { color: '#800' },
  'hljs-type':              { color: '#800' },
  'hljs-section':           { color: '#800', 'font-weight': '700' },
  'hljs-title':             { color: '#800', 'font-weight': '700' },
  'hljs-link':              { color: '#ab5656' },
  'hljs-operator':          { color: '#ab5656' },
  'hljs-regexp':            { color: '#ab5656' },
  'hljs-selector-attr':     { color: '#ab5656' },
  'hljs-selector-pseudo':   { color: '#ab5656' },
  'hljs-symbol':            { color: '#ab5656' },
  'hljs-template-variable': { color: '#ab5656' },
  'hljs-variable':          { color: '#ab5656' },
  'hljs-literal':           { color: '#695' },
  'hljs-addition':          { color: '#327848' },
  'hljs-built_in':          { color: '#327848' },
  'hljs-bullet':            { color: '#327848' },
  'hljs-code':              { color: '#327848' },
  'hljs-meta':              { color: '#1f7199' },
  'hljs-emphasis':          { 'font-style': 'italic' },
  'hljs-strong':            { 'font-weight': '700' },
};

// ── 样式 ──
const S = {
  wrapper: `font-family: ${WX_FONT}; font-size: ${WX_SIZE}; color: ${WX_COLOR}; line-height: ${WX_LH}; letter-spacing: ${WX_LS}; word-wrap: break-word;`,

  h1: `display: block; line-height: 1.5; font-size: 24px; font-family: ${WX_FONT}; font-weight: bold; margin: 80px auto 40px auto; max-width: 100%; width: fit-content; color: #327848; text-align: center; padding: 0 0.25em; border-bottom: 8px solid #327848; word-break: normal; overflow-wrap: normal;`,
  h2: `display: block; line-height: 1.5; font-family: ${WX_FONT}; font-size: 20px; font-weight: bold; margin: 40px auto; max-width: 100%; width: fit-content; color: #222222; text-align: center; padding: 0 0.2em; word-break: normal; overflow-wrap: normal;`,
  h3: `display: block; line-height: 1.5; font-family: ${WX_FONT}; font-size: 17px; font-weight: bold; margin: 40px 0; width: fit-content; color: #222222; text-align: left;`,
  h4: `display: block; line-height: 1.5; font-family: ${WX_FONT}; font-size: 16px; font-weight: bold; margin: 1em 0 .5em; color: #222222;`,
  h5: `display: block; line-height: 1.5; font-family: ${WX_FONT}; font-size: 15px; font-weight: bold; margin: .8em 0 .4em; color: #222222;`,
  h6: `display: block; line-height: 1.5; font-family: ${WX_FONT}; font-size: 14px; font-weight: bold; margin: .7em 0 .35em; color: #555555;`,

  p: `text-align: left; line-height: ${WX_P_LH}; font-family: ${WX_FONT}; margin: 0; padding-bottom: ${WX_GAP}; letter-spacing: ${WX_LS}; white-space: pre-line; color: ${WX_COLOR}; font-size: ${WX_SIZE};`,

  strong: `word-break: normal; overflow-wrap: break-word; font-weight: 600; color: #327848;`,
  em:     `font-style: italic;`,
  code_inline: `background: rgba(135,131,120,.15); border-radius: 4px; font-size: 85%; padding: 0.2em 0.4em; color: #222222; font-family: ${MONO};`,
  s: `text-decoration: line-through; color: #888888;`,

  blockquote_wrapper: `line-height: ${WX_P_LH}; word-spacing: normal; hyphens: auto; text-align: left; outline: 0; max-width: 100%; border-top: none; border-right: none; border-bottom: none; display: block; overflow: auto; padding: 10px; margin: 0 0 30px; border-left: 2px solid #327848; background-color: #f5f5f5; font-family: ${WX_FONT}; letter-spacing: ${WX_LS}; color: #327848; font-size: ${WX_SIZE};`,

  callout_wrapper: `font-size: ${WX_SIZE}; white-space: normal; margin: 0 0 30px; color: ${WX_COLOR}; font-family: ${WX_FONT}; line-height: ${WX_P_LH}; letter-spacing: ${WX_LS}; background-color: #f7faf8; border: 1px solid #327848; padding: 16px 20px;`,
  callout_content: ``,

  code_wrapper:  `margin: 0 10px 30px; display: block; width: calc(100% - 20px); box-sizing: border-box; font-size: 15px; padding: 10px; color: #333; position: relative; background-color: #fafafa; border: 1px solid #f0f0f0; border-radius: 5px; white-space: pre; box-shadow: rgba(0,0,0,.3) 0px 2px 10px; overflow-x: auto; text-align: left; font-family: ${MONO};`,
  code_lang_bar: `font-size: 11px; color: #999; font-family: ${MONO}; padding-bottom: 6px; letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1px solid #f0f0f0; margin-bottom: 8px;`,
  code_pre:      `margin: 0; padding: 0; overflow-x: auto; background: transparent;`,
  code_text:     `font-family: ${MONO}; font-size: 14px; line-height: 1.65; white-space: pre; word-break: normal; display: block; color: #333;`,

  hr: `border-style: solid; border-width: 1px 0 0; border-color: #797979; margin: 0 0 30px;`,

  ul: `padding-left: 1.5em; font-size: ${WX_SIZE}; line-height: ${WX_P_LH}; font-family: ${WX_FONT}; vertical-align: baseline; white-space: normal; color: ${WX_COLOR}; margin-bottom: 30px; margin-top: 0;`,
  ol: `padding-left: 1.5em; font-size: ${WX_SIZE}; line-height: ${WX_P_LH}; font-family: ${WX_FONT}; vertical-align: baseline; white-space: normal; color: ${WX_COLOR}; margin-bottom: 30px; margin-top: 0;`,
  li_ul: `font-size: ${WX_SIZE}; line-height: ${WX_P_LH}; font-family: ${WX_FONT}; list-style-position: outside; list-style-type: disc;`,
  li_ol: `font-size: ${WX_SIZE}; line-height: ${WX_P_LH}; font-family: ${WX_FONT}; list-style-position: outside; list-style-type: decimal;`,
  li_p:  `font-family: inherit; vertical-align: baseline; margin: 10px 0;`,

  img_wrapper: `margin: 0 0 30px; text-align: center;`,
  img:         `max-width: 100%; height: auto; display: inline-block;`,
  img_caption: `font-size: 12px; color: #888888; margin-top: 5px; text-align: center;`,

  video_wrapper: `margin: 0 0 30px; background: #111; border-radius: 8px; padding: 28px 20px; text-align: center;`,
  video_label:   `color: rgba(255,255,255,.45); font-size: 14px;`,

  toggle_summary: `display:block;font-size:15px;font-weight:bold;color:#222222;margin:12px 0 5px;padding-left:15px;border-left:3px solid #222222;font-family:${WX_FONT};`,
  toggle_content: `display:block;padding-left:15px;border-left:2px solid rgba(0,0,0,.15);margin-left:4px;`,

  table_wrapper: `overflow-x: auto; margin: 0 0 30px;`,
  table:         `border-collapse: collapse; width: 100%; font-size: ${WX_SIZE}; line-height: ${WX_LH}; letter-spacing: ${WX_LS}; font-family: ${WX_FONT};`,
  th:            `background: rgba(0,0,0,.05); padding: 7px 13px; border: 1px solid rgba(0,0,0,.15); font-weight: bold; text-align: left; color: ${WX_COLOR};`,
  td:            `padding: 7px 13px; border: 1px solid rgba(0,0,0,.15); color: ${WX_COLOR};`,
  td_even:       `padding: 7px 13px; border: 1px solid rgba(0,0,0,.15); color: ${WX_COLOR}; background: rgba(0,0,0,.02);`,

  embed_wrapper: `margin: 0 0 30px; border: 1px solid rgba(0,0,0,.1); padding: 11px 15px;`,
  embed_label:   `font-size: 12px; color: #888888; margin-bottom: 4px;`,
  embed_link:    `font-size: 13px; text-decoration: none; color: #222222; border-bottom: 1px solid #222222; word-break: normal; overflow-wrap: break-word;`,

  footnotes_wrapper: `margin-top: 30px; padding-top: 15px; border-top: 1px solid rgba(0,0,0,.15);`,
  footnotes_title:   `font-size: 12px; font-weight: bold; color: #888888; margin-bottom: .6em; text-transform: uppercase; letter-spacing: 1px;`,
  footnote_item:     `font-size: 12px; color: #555555; line-height: 1.7; margin: .3em 0; word-break: normal; overflow-wrap: break-word;`,
  footnote_num:      `color: #222222; font-weight: bold; margin-right: 4px;`,

  // 文末「推荐阅读」。板块标题与文章 H1 逐项一致；
  // 卡片本身是合成图，样式在 card-renderer.js 里。
  recommend_wrapper: `display: block; margin: 0; padding-top: 30px; border-top: 1px solid rgba(0,0,0,.08);`,
  recommend_title:   `display: block; line-height: 1.5; font-size: 24px; font-family: ${WX_FONT}; font-weight: bold; margin: 40px auto 40px auto; max-width: 100%; width: fit-content; color: #327848; text-align: center; padding: 0 0.25em; border-bottom: 8px solid #327848; word-break: normal; overflow-wrap: normal;`,
  recommend_img:     `width: 100%; max-width: 100%; height: auto; display: block; margin: 0 0 14px;`,
};

function applyS(key, content, defaultTag = 'section') {
  const val = S[key] || '';
  if (val.includes('{{content}}')) return val.replace('{{content}}', content);
  return `<${defaultTag} style="${val}">${content}</${defaultTag}>`;
}

function formatToWechat(parsedData, options = {}) {
  if (!parsedData || !parsedData.blocks) {
    return '<p style="color:red">解析数据为空，请重试</p>';
  }
  const { blocks, links = [] } = parsedData;

  // 跳过开头的空块（空段落、空行），避免文章顶部出现多余空白
  let startIndex = 0;
  while (startIndex < blocks.length) {
    const b = blocks[startIndex];
    if (b.type === 'paragraph') {
      const text = (b.content || '').replace(/\u200b/g, '').trim();
      if (!text) { startIndex++; continue; }
    }
    break;
  }

  let html = '';
  for (let i = startIndex; i < blocks.length; i++) html += renderBlock(blocks[i], links, 0);
  if (links.length > 0) html += renderFootnotes(links);
  // appendHtml 必须落在 wrapper 之内，否则丢掉基础字体与字色
  html += options.appendHtml || '';
  return `<section style="${S.wrapper}">${html}</section>`;
}

function renderBlock(block, links, depth) {
  if (!block) return '';
  switch (block.type) {
    case 'h1': return applyS('h1', pi(block.content));
    case 'h2': return applyS('h2', pi(block.content));
    case 'h3': return applyS('h3', pi(block.content));
    case 'h4': return applyS('h4', pi(block.content));
    case 'h5': return applyS('h5', pi(block.content));
    case 'h6': return applyS('h6', pi(block.content));

    case 'paragraph': {
      const text = (block.content || '').replace(/\u200b/g, '').trim();
      // 空行直接丢弃：段间距一律由 p 的 padding-bottom(30px) 决定
      if (!text) return '';
      return applyS('p', pi(block.content), 'p');
    }

    case 'quote': {
      const bwVal = S.blockquote_wrapper || '';
      const content = pi(block.content).replace(/^(<br\s*\/?>)+|(<br\s*\/?>)+$/g, '');
      if (bwVal.includes('{{content}}')) return bwVal.replace('{{content}}', content);
      return `<section style="${bwVal}">${content}</section>`;
    }

    case 'callout':
      return renderCallout(block);

    case 'code':
      return renderCodeBlock(block);

    case 'divider':
      return applyS('hr', '');

    case 'bulleted_list':
      return renderList(block.items, false, depth);

    case 'numbered_list':
      return renderList(block.items, true, depth);

    case 'image':
      return renderImage(block);

    case 'video':
      return renderVideo(block);

    case 'toggle':
      return renderToggle(block, links, depth);

    case 'bookmark':
      return `<p style="${S.p}"><a href="${escAttr(block.url)}" style="text-decoration:none;color:#222222;border-bottom:1px solid #222222;word-break:normal;overflow-wrap:break-word;">${escHtml(block.text || block.url)}</a><sup style="color:#222222;font-size:.7em;font-weight:bold;line-height:0;">[${block.linkIndex}]</sup></p>`;

    case 'todo':
      if (block.checked) {
        return `<p style="${S.p}">${escHtml('\u2705')} <span style="text-decoration:line-through;color:#aaaaaa;">${pi(block.content)}</span></p>`;
      }
      return `<p style="${S.p}">${escHtml('\u2610')} ${pi(block.content)}</p>`;

    case 'table':
      return renderTable(block);

    case 'embed':
      return `<section style="${S.embed_wrapper}"><p style="${S.embed_label}">${escHtml('\uD83D\uDCCE')} ${escHtml(block.title || '嵌入内容')}</p>${block.url ? `<p style="${S.embed_link}">${escHtml(block.url)}</p>` : ''}</section>`;

    case 'column_list':
      if (!block.columns) return '';
      return block.columns.map(col => col.map(b => renderBlock(b, links, depth)).join('')).join('');

    default:
      return '';
  }
}

function renderCallout(block) {
  const content = pi(block.content).replace(/^(<br\s*\/?>)+|(<br\s*\/?>)+$/g, '');
  return `<section style="${S.callout_wrapper}">${content}</section>`;
}

function applyHljsStyles(html) {
  return html.replace(/<span class="([^"]+)">/g, (_, classStr) => {
    const styles = {};
    for (const cls of classStr.split(' ')) {
      if (CODE_THEME[cls]) Object.assign(styles, CODE_THEME[cls]);
    }
    const s = Object.entries(styles).map(([k, v]) => `${k}:${v}`).join(';');
    return s ? `<span style="${s}">` : '<span>';
  });
}

function renderCodeBlock(block) {
  const rawLang = (block.language || '').toLowerCase().trim();
  const lang    = (rawLang === 'plaintext' || rawLang === 'plain text') ? '' : rawLang;
  const rawCode = block.content || '';

  let codeHtml;
  try {
    if (lang && hljs.getLanguage(lang)) {
      codeHtml = applyHljsStyles(hljs.highlight(rawCode, { language: lang }).value);
    } else {
      codeHtml = applyHljsStyles(hljs.highlightAuto(rawCode).value);
    }
  } catch (_) {
    codeHtml = escHtml(rawCode);
  }

  const dot = (color) => `<section style="width:10px;height:10px;border-radius:50%;background-color:${color};font-size:0;line-height:0;overflow:hidden;">&nbsp;</section>`;
  const topBar = `<section style="display:flex;flex-direction:row;align-items:center;column-gap:6px;margin-bottom:4px;">${dot('#ed6c60')}${dot('#f7c151')}${dot('#64c856')}</section>`;
  const langBar = lang ? `<div style="${S.code_lang_bar}">${escHtml(lang)}</div>` : '';
  return `<section style="${S.code_wrapper}">${topBar}${langBar}<pre style="${S.code_pre}"><code style="${S.code_text}">${codeHtml}</code></pre></section>`;
}

function isAllBold(content) {
  if (!content) return false;
  const trimmed = String(content).trim();
  if (!trimmed) return false;
  // Strip <strong>...</strong> wrappers, then strip remaining inline tags (br, sup, etc.)
  const stripped = trimmed.replace(/<strong>[\s\S]*?<\/strong>/g, '');
  const remaining = stripped.replace(/<[^>]+>/g, '').trim();
  return !remaining;
}

function renderList(items, isOrdered, depth) {
  if (!items || items.length === 0) return '';
  const indent = depth > 0 ? `padding-left: ${depth * 1.5}em;` : '';
  const baseStyle = `text-align: left; line-height: ${WX_P_LH}; font-family: ${WX_FONT}; margin: 5px 0; letter-spacing: ${WX_LS}; color: ${WX_COLOR}; font-size: ${WX_SIZE}; ${indent}`;
  const markerStyle = `display: inline-block; min-width: 1.5em; margin-right: 0.3em;`;
  const boldMarkerStyle = `${markerStyle} font-weight: 600; color: #327848;`;

  let html = '';
  items.forEach((item, index) => {
    const marker = isOrdered ? `${index + 1}.` : '\u2022';
    const itemMarkerStyle = isAllBold(item.content) ? boldMarkerStyle : markerStyle;
    let nested = '';
    if (item.children && item.children.length > 0) {
      for (const child of item.children) nested += renderBlock(child, [], depth + 1);
    }
    html += `<p style="${baseStyle}"><span style="${itemMarkerStyle}">${marker}</span>${pi(item.content)}</p>${nested}`;
  });

  // Top-level lists need extra bottom spacing to match paragraph padding
  if (depth === 0) {
    return `<section style="margin-bottom: 1em;">${html}</section>`;
  }
  return html;
}

function renderImage(block) {
  const src = block.base64 || block.url;
  if (!src) return '';
  const cap = block.caption ? `<p style="${S.img_caption}">${escHtml(block.caption)}</p>` : '';
  return `<section style="${S.img_wrapper}"><img src="${escAttr(src)}" style="${S.img}" alt="${escAttr(block.caption || '图片')}" />${cap}</section>`;
}

function renderVideo(block) {
  const videoUrl = escAttr(block.url || '');
  const thumbSrc = block.thumbnailUrl ? escAttr(block.thumbnailUrl) : '';
  const cookiesAttr = block._cookies ? ` data-video-cookies="${escAttr(block._cookies)}"` : '';
  if (thumbSrc) {
    return `<section data-video-src="${videoUrl}" data-video-thumb="${thumbSrc}"${cookiesAttr} style="${S.img_wrapper}"><img src="${thumbSrc}" style="${S.img}" alt="视频封面" /><p style="${S.img_caption}">${escHtml('\uD83D\uDCF9')} 视频内容请前往原文查看</p></section>`;
  }
  return `<section data-video-src="${videoUrl}"${cookiesAttr} style="${S.video_wrapper}"><p style="${S.video_label}">${escHtml('\uD83D\uDCF9')} 视频内容请前往原文查看</p></section>`;
}

function renderToggle(block, links, depth) {
  const summaryHtml = depth === 0
    ? `<section style="${S.toggle_summary}">${escHtml('\u25B6')} ${pi(block.content)}</section>`
    : `<p style="${S.p}">${pi(block.content)}</p>`;
  let html = summaryHtml;
  if (block.children && block.children.length > 0) {
    html += `<section style="${S.toggle_content}">${block.children.map(b => renderBlock(b, links, depth + 1)).join('')}</section>`;
  }
  return html;
}

function renderTable(block) {
  if (!block.rows || block.rows.length === 0) return '';
  let rows = '';
  block.rows.forEach((row, ri) => {
    const isHeader = row.isHeader || ri === 0;
    const cells = (row.cells || []).map(cell => {
      const style = isHeader ? S.th : (ri % 2 === 0 ? S.td_even : S.td);
      return `<td style="${style}">${pi(cell)}</td>`;
    }).join('');
    rows += `<tr>${cells}</tr>`;
  });
  return `<section style="${S.table_wrapper}"><table style="${S.table}">${rows}</table></section>`;
}

function renderFootnotes(links) {
  const items = links.map((link, i) =>
    `<p style="${S.footnote_item}"><span style="${S.footnote_num}">[${i + 1}]</span>${escHtml(link.text)}：<span style="color:#888888">${escHtml(link.url)}</span></p>`
  ).join('');
  return `<section style="${S.footnotes_wrapper}"><p style="${S.footnotes_title}">参考资料</p>${items}</section>`;
}

function pi(html) {
  if (!html) return '';
  return html
    .replace(/<strong>([\s\S]*?)<\/strong>/g, (_, inner) => {
      const val = S.strong || '';
      if (val.includes('{{content}}')) return val.replace('{{content}}', inner);
      return `<strong style="${val}">${inner}</strong>`;
    })
    .replace(/<em>([\s\S]*?)<\/em>/g,
      `<em style="${S.em}">$1</em>`)
    .replace(/<code>([\s\S]*?)<\/code>/g,
      `<code style="${S.code_inline}">$1</code>`)
    .replace(/<s>([\s\S]*?)<\/s>/g,
      `<s style="${S.s}">$1</s>`)
    .replace(/<a\s+href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (_, href, attrs, text) => {
      // callout 内公众号跳转链接：不加下划线
      if (attrs.includes('data-wechat-callout')) {
        return `<a href="${href}" style="text-decoration:none;color:#222222;word-break:normal;overflow-wrap:break-word;">${text}</a>`;
      }
      return `<a href="${href}" style="text-decoration:none;color:#222222;border-bottom:1px solid #222222;word-break:normal;overflow-wrap:break-word;">${text}</a>`;
    })
    .replace(/<sup>\[(\d+)\]<\/sup>/g,
      `<sup style="font-size:.7em;color:#222222;font-weight:bold;line-height:0;vertical-align:super;">[$1]</sup>`);
}

function escHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(text) {
  return String(text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// publishedAt 存的是 '2025-09-25 21:41:23' 或 '2025-09-25'，只取日期
function pickDate(raw) {
  const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
}

// 文末「推荐阅读」板块。cards 为空时返回空串，整个板块不出现。
//
// 每张卡片是一张合成好的 JPEG（card-renderer.js 出的 data URI），外面套一个 <a>。
// 这是微信唯一不会改的结构。纯 HTML 方案试过，微信会：
//   1. 给文字链接自动加一个小图标
//   2. 给每段套 <span leaf="">，继承行高撑出多余空白
//   3. 强制给 <a> 加 color: rgb(51,51,51)，绿底白字被覆盖成深灰
// 三条都没法从我们这边关掉。
//
// data URI 交给 publishArticle 的 processHtmlImages 自动上传并换成 mmbiz 地址。
function buildRecommendBlock(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return '';

  const items = cards.map(c =>
    `<a href="${escAttr(c.url)}">`
    + `<img src="${escAttr(c.dataUri)}" alt="${escHtml(c.title)}" style="${S.recommend_img}">`
    + `</a>`
  ).join('');

  return `<section style="${S.recommend_wrapper}">`
    + `<section style="${S.recommend_title}">推荐阅读</section>`
    + items
    + `</section>`;
}


module.exports = { formatToWechat, buildRecommendBlock };
