// WeChat 公众号 HTML 格式化器（Node.js 版本）
// 从 Layout-design/chrome-extension/popup/formatter.js 移植
// 变更：用 require('highlight.js') 替换浏览器全局 hljs

const hljs = require('highlight.js');

// ── 字体 ──
const FONT = "Optima-Regular, Optima, PingFangSC-light, PingFangTC-light, 'PingFang SC', Cambria, Cochin, Georgia, Times, 'Times New Roman', serif";
const MONO = 'Operator Mono, Consolas, Monaco, Menlo, monospace';

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
  'hljs-addition':          { color: '#397300' },
  'hljs-built_in':          { color: '#397300' },
  'hljs-bullet':            { color: '#397300' },
  'hljs-code':              { color: '#397300' },
  'hljs-meta':              { color: '#1f7199' },
  'hljs-emphasis':          { 'font-style': 'italic' },
  'hljs-strong':            { 'font-weight': '700' },
};

// ── 样式 ──
const S = {
  wrapper: `font-family: ${FONT}; font-size: 15px; color: rgb(63,63,63); line-height: 1.75; letter-spacing: 0.1em; word-wrap: break-word;`,

  h1: `display: block; line-height: 1.5; font-size: 24px; font-family: ${FONT}; font-weight: bold; margin: 80px auto 40px auto; width: fit-content; color: #407600; text-align: center; padding: 0 1em; border-bottom: 8px solid #407600;`,
  h2: `display: block; line-height: 1.5; font-family: ${FONT}; font-size: 20px; font-weight: bold; margin: 40px auto; width: fit-content; color: #222222; text-align: center; padding: 0 0.2em;`,
  h3: `display: block; line-height: 1.5; font-family: ${FONT}; font-size: 17px; font-weight: bold; margin: 40px 0; width: fit-content; color: #222222; text-align: left;`,
  h4: `display: block; line-height: 1.5; font-family: ${FONT}; font-size: 16px; font-weight: bold; margin: 1em 0 .5em; color: #222222;`,
  h5: `display: block; line-height: 1.5; font-family: ${FONT}; font-size: 15px; font-weight: bold; margin: .8em 0 .4em; color: #222222;`,
  h6: `display: block; line-height: 1.5; font-family: ${FONT}; font-size: 14px; font-weight: bold; margin: .7em 0 .35em; color: #555555;`,

  p: `text-align: left; line-height: 26px; font-family: ${FONT}; margin: 0; padding-bottom: 1em; letter-spacing: 0.1em; white-space: pre-line; color: rgb(63,63,63); font-size: 15px;`,

  strong: `word-break: break-all; font-weight: 600; color: #407600;`,
  em:     `font-style: italic;`,
  code_inline: `background: rgba(135,131,120,.15); border-radius: 4px; font-size: 85%; padding: 0.2em 0.4em; color: #222222; font-family: ${MONO};`,
  s: `text-decoration: line-through; color: #888888;`,

  blockquote_wrapper: `line-height: 26px; word-spacing: normal; hyphens: auto; text-align: left; outline: 0; max-width: 100%; border-top: none; border-right: none; border-bottom: none; display: block; overflow: auto; padding: 10px; margin: 20px 0; border-left: 8px solid #222222; background-color: #f5f5f5; font-family: ${FONT};`,
  blockquote_text: `text-align: left; line-height: 26px; font-family: ${FONT}; margin: 0; letter-spacing: 0.1em; color: #407600; font-size: 15px;`,

  callout_wrapper: `font-size: 15px; white-space: normal; margin: 20px 0; color: #3f3f3f; font-family: ${FONT}; line-height: 26px; letter-spacing: 0.1em; background-color: #f9fdf5; border: 1px solid #407600; border-radius: 8px; padding: 16px 20px;`,
  callout_content: ``,

  code_wrapper:  `margin: 20px 10px; display: block; width: calc(100% - 20px); box-sizing: border-box; font-size: 15px; padding: 10px; color: #333; position: relative; background-color: #fafafa; border: 1px solid #f0f0f0; border-radius: 5px; white-space: pre; box-shadow: rgba(0,0,0,.3) 0px 2px 10px; overflow-x: auto; text-align: left; font-family: ${MONO};`,
  code_lang_bar: `font-size: 11px; color: #999; font-family: ${MONO}; padding-bottom: 6px; letter-spacing: 0.5px; text-transform: uppercase; border-bottom: 1px solid #f0f0f0; margin-bottom: 8px;`,
  code_pre:      `margin: 0; padding: 0; overflow-x: auto; background: transparent;`,
  code_text:     `font-family: ${MONO}; font-size: 14px; line-height: 1.65; white-space: pre; word-break: normal; display: block; color: #333;`,

  hr: `border-style: solid; border-width: 1px 0 0; border-color: #797979; margin: 15px 0;`,

  ul: `padding-left: 1.5em; font-size: 15px; line-height: 1.75; font-family: ${FONT}; vertical-align: baseline; white-space: normal; color: rgb(63,63,63); margin-bottom: 8px; margin-top: 0;`,
  ol: `padding-left: 1.5em; font-size: 15px; line-height: 26px; font-family: ${FONT}; vertical-align: baseline; white-space: normal; color: rgb(63,63,63); margin-bottom: 8px; margin-top: 0;`,
  li_ul: `font-size: 15px; line-height: 26px; font-family: ${FONT}; list-style-position: outside; list-style-type: disc;`,
  li_ol: `font-size: 15px; line-height: 1.75; font-family: ${FONT}; list-style-position: outside; list-style-type: decimal;`,
  li_p:  `font-family: inherit; vertical-align: baseline; margin: 10px 0;`,

  img_wrapper: `margin: 15px 0; text-align: center;`,
  img:         `max-width: 100%; height: auto; border-radius: 10px; display: inline-block;`,
  img_caption: `font-size: 12px; color: #888888; margin-top: 5px; text-align: center;`,

  video_wrapper: `margin: 1em 0; background: #111; border-radius: 8px; padding: 28px 20px; text-align: center;`,
  video_label:   `color: rgba(255,255,255,.45); font-size: 14px;`,

  toggle_summary: `display:block;font-size:15px;font-weight:bold;color:#222222;margin:12px 0 5px;padding-left:15px;border-left:3px solid #222222;font-family:${FONT};`,
  toggle_content: `display:block;padding-left:15px;border-left:2px solid rgba(0,0,0,.15);margin-left:4px;`,

  table_wrapper: `overflow-x: auto; margin: 1em 0;`,
  table:         `border-collapse: collapse; width: 100%; font-size: 15px; line-height: 1.6; font-family: ${FONT};`,
  th:            `background: rgba(0,0,0,.05); padding: 7px 13px; border: 1px solid rgba(0,0,0,.15); font-weight: bold; text-align: left; color: #222222;`,
  td:            `padding: 7px 13px; border: 1px solid rgba(0,0,0,.15); color: #222222;`,
  td_even:       `padding: 7px 13px; border: 1px solid rgba(0,0,0,.15); color: #222222; background: rgba(0,0,0,.02);`,

  embed_wrapper: `margin: 1em 0; border: 1px solid rgba(0,0,0,.1); padding: 11px 15px;`,
  embed_label:   `font-size: 12px; color: #888888; margin-bottom: 4px;`,
  embed_link:    `font-size: 13px; text-decoration: none; color: #222222; border-bottom: 1px solid #222222; word-break: break-all;`,

  footnotes_wrapper: `margin-top: 30px; padding-top: 15px; border-top: 1px solid rgba(0,0,0,.15);`,
  footnotes_title:   `font-size: 12px; font-weight: bold; color: #888888; margin-bottom: .6em; text-transform: uppercase; letter-spacing: 1px;`,
  footnote_item:     `font-size: 12px; color: #555555; line-height: 1.7; margin: .3em 0; word-break: break-all;`,
  footnote_num:      `color: #222222; font-weight: bold; margin-right: 4px;`,
};

function applyS(key, content, defaultTag = 'section') {
  const val = S[key] || '';
  if (val.includes('{{content}}')) return val.replace('{{content}}', content);
  return `<${defaultTag} style="${val}">${content}</${defaultTag}>`;
}

function formatToWechat(parsedData) {
  if (!parsedData || !parsedData.blocks) {
    return '<p style="color:red">解析数据为空，请重试</p>';
  }
  const { blocks, links = [] } = parsedData;
  let html = '';
  for (const block of blocks) html += renderBlock(block, links, 0);
  if (links.length > 0) html += renderFootnotes(links);
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
      if (!text) return '<br>';
      return applyS('p', pi(block.content), 'p');
    }

    case 'quote': {
      const bwVal = S.blockquote_wrapper || '';
      if (bwVal.includes('{{content}}')) return bwVal.replace('{{content}}', pi(block.content));
      return `<section style="${bwVal}"><p style="${S.blockquote_text}">${pi(block.content)}</p></section>`;
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
      return `<p style="${S.p}"><a href="${escAttr(block.url)}" style="text-decoration:none;color:#222222;border-bottom:1px solid #222222;word-break:break-all;">${escHtml(block.text || block.url)}</a><sup style="color:#222222;font-size:.7em;font-weight:bold;line-height:0;">[${block.linkIndex}]</sup></p>`;

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
  return `<section style="${S.callout_wrapper}">${pi(block.content)}</section>`;
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

function renderList(items, isOrdered, depth) {
  if (!items || items.length === 0) return '';
  const indent = depth > 0 ? `padding-left: ${depth * 1.5}em;` : '';
  const baseStyle = `text-align: left; line-height: 26px; font-family: ${FONT}; margin: 5px 0; letter-spacing: 0.1em; color: rgb(63,63,63); font-size: 15px; ${indent}`;
  const markerStyle = `display: inline-block; min-width: 1.5em; margin-right: 0.3em;`;

  let html = '';
  items.forEach((item, index) => {
    const marker = isOrdered ? `${index + 1}.` : '\u2022';
    let nested = '';
    if (item.children && item.children.length > 0) {
      for (const child of item.children) nested += renderBlock(child, [], depth + 1);
    }
    html += `<p style="${baseStyle}"><span style="${markerStyle}">${marker}</span>${pi(item.content)}</p>${nested}`;
  });
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
    .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
      `<a href="$1" style="text-decoration:none;color:#222222;border-bottom:1px solid #222222;word-break:break-all;">$2</a>`)
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

module.exports = { formatToWechat };
