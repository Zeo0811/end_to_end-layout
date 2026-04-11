// Notion 页面 DOM 解析器
// 将 Notion DOM 结构转换为中间 JSON 表示
// 支持旧版 class 检测 + 新版 data-block-type 检测

function parseNotion() {
  const title = getNotionTitle();
  const links = [];

  // 新版 Notion 使用 data-content-editable-root 或 .notion-page-content
  const contentArea =
    document.querySelector('.notion-page-content') ||
    document.querySelector('[class*="notionPage"]') ||
    document.querySelector('[data-content-editable-root]') ||
    document.querySelector('[class*="layout-content"]') ||
    document.querySelector('main [class*="content"]') ||
    // Notion 公开页面 fallback
    document.querySelector('[class*="super-content"]') ||
    document.querySelector('[class*="page-body"]') ||
    document.querySelector('[data-block-id]')?.parentElement ||
    document.querySelector('main') ||
    document.querySelector('article');

  if (!contentArea) {
    // 调试信息：列出页面上的主要元素
    const bodyClasses = document.body.className || '';
    const mainEl = document.querySelector('main');
    const divCount = document.querySelectorAll('div[class]').length;
    const blockCount = document.querySelectorAll('[data-block-id]').length;
    throw new Error(`无法找到Notion页面内容。body.class="${bodyClasses}", main=${!!mainEl}, divs=${divCount}, blocks=${blockCount}, url=${location.href}`);
  }

  const blocks = parseNotionBlocks(Array.from(contentArea.children), links, 0);
  return { type: 'notion', title, blocks, links };
}

function getNotionTitle() {
  const candidates = [
    document.querySelector('.notion-page-block [data-content-editable-leaf]'),
    document.querySelector('.notion-title [data-content-editable-leaf]'),
    document.querySelector('[placeholder="Untitled"][contenteditable]'),
    document.querySelector('[data-block-type="page"] [data-content-editable-leaf]'),
    document.querySelector('.notion-page-block .notranslate'),
  ];

  for (const el of candidates) {
    if (el && el.textContent.trim()) return el.textContent.trim();
  }

  return document.title.replace(/ ?[–—-] ?Notion$/, '').replace(/ ?\| ?Notion$/, '').trim();
}

function parseNotionBlocks(elements, links, depth) {
  const blocks = [];
  let listBuffer = { type: null, items: [] };

  for (const el of elements) {
    const blockType = getNotionBlockType(el);
    if (!blockType) continue;

    const isList = blockType === 'bulleted_list' || blockType === 'numbered_list';

    if (isList) {
      if (listBuffer.type !== blockType) {
        if (listBuffer.items.length > 0) {
          blocks.push({ type: listBuffer.type, items: listBuffer.items });
          listBuffer = { type: null, items: [] };
        }
        listBuffer.type = blockType;
      }
      listBuffer.items.push(parseNotionListItem(el, blockType, links, depth));
    } else {
      if (listBuffer.items.length > 0) {
        blocks.push({ type: listBuffer.type, items: listBuffer.items });
        listBuffer = { type: null, items: [] };
      }
      const block = parseNotionBlock(el, blockType, links, depth);
      if (block) blocks.push(block);
    }
  }

  if (listBuffer.items.length > 0) {
    blocks.push({ type: listBuffer.type, items: listBuffer.items });
  }

  return blocks;
}

function getNotionBlockType(el) {
  if (!el) return null;

  // ── 新版 Notion：优先检查 data-block-type ──
  const dataType = el.getAttribute && el.getAttribute('data-block-type');
  if (dataType) {
    const dataMap = {
      'header': 'h1',
      'sub_header': 'h2',
      'sub_sub_header': 'h3',
      'text': 'paragraph',
      'quote': 'quote',
      'code': 'code',
      'callout': 'callout',
      'divider': 'divider',
      'bulleted_list': 'bulleted_list',
      'numbered_list': 'numbered_list',
      'image': 'image',
      'video': 'video',
      'toggle': 'toggle',
      'column_list': 'column_list',
      'bookmark': 'bookmark',
      'to_do': 'todo',
      'table': 'table',
      'embed': 'embed',
      'link_preview': 'embed',
      'synced_block': 'synced',
    };
    if (dataMap[dataType]) return dataMap[dataType];
  }

  // ── 旧版 Notion：通过 class 检测 ──
  const cls = typeof el.className === 'string' ? el.className : '';
  const typeMap = [
    ['notion-header-block', 'h1'],
    ['notion-sub_header-block', 'h2'],
    ['notion-sub_sub_header-block', 'h3'],
    ['notion-text-block', 'paragraph'],
    ['notion-quote-block', 'quote'],
    ['notion-code-block', 'code'],
    ['notion-callout-block', 'callout'],
    ['notion-divider-block', 'divider'],
    ['notion-bulleted_list-block', 'bulleted_list'],
    ['notion-numbered_list-block', 'numbered_list'],
    ['notion-image-block', 'image'],
    ['notion-video-block', 'video'],
    ['notion-toggle-block', 'toggle'],
    ['notion-column_list-block', 'column_list'],
    ['notion-bookmark-block', 'bookmark'],
    ['notion-to_do-block', 'todo'],
    ['notion-table-block', 'table'],
    ['notion-embed-block', 'embed'],
  ];

  for (const [clsCheck, type] of typeMap) {
    if (cls.includes(clsCheck)) return type;
  }
  return null;
}

function parseNotionBlock(el, blockType, links, depth) {
  switch (blockType) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return { type: blockType, content: extractNotionRichText(el, links) };

    case 'paragraph':
      return { type: 'paragraph', content: extractNotionRichText(el, links) };

    case 'quote':
      return { type: 'quote', content: extractNotionRichText(el, links) };

    case 'code':
      return parseNotionCodeBlock(el);

    case 'callout':
      return parseNotionCallout(el, links);

    case 'divider':
      return { type: 'divider' };

    case 'image':
      return parseNotionImage(el);

    case 'video':
      return parseNotionVideo(el);

    case 'toggle':
      return parseNotionToggle(el, links, depth);

    case 'bookmark':
      return parseNotionBookmark(el, links);

    case 'todo': {
      // 已勾选：Notion 给内容区加 notion-strikethrough-container class，
      // 同时 style 里有 text-decoration-line: line-through
      const isChecked =
        !!el.querySelector('.notion-strikethrough-container') ||
        !!el.querySelector('[class*="strikethrough"]') ||
        !!el.querySelector('[style*="line-through"]') ||
        !!el.querySelector('[aria-checked="true"]') ||
        !!el.querySelector('[data-checked="true"]') ||
        el.getAttribute('data-checked') === 'true' ||
        !!el.querySelector('input[type="checkbox"]:checked');
      return { type: 'todo', content: extractNotionRichText(el, links), checked: isChecked };
    }

    case 'table':
      return parseNotionTable(el, links);

    case 'embed':
      return parseNotionEmbed(el, links);

    case 'synced':
      // 同步块：递归解析内部内容
      return parseNotionSynced(el, links, depth);

    case 'column_list':
      return parseNotionColumnList(el, links, depth);

    default:
      return null;
  }
}

// 提取 Notion 块内的富文本（保留粗体、斜体、代码、链接）
function extractNotionRichText(blockEl, links) {
  // 必须用 [contenteditable="true"]，避免匹配 bullet 指示符的 contenteditable="false"
  const contentEl =
    blockEl.querySelector('[contenteditable="true"]') ||
    blockEl.querySelector('[data-content-editable-root]') ||
    (() => {
      // 退回到第一个叶子节点的父元素，确保包含所有兄弟叶子（含加粗 span）
      const leaf = blockEl.querySelector('[data-content-editable-leaf]');
      return leaf ? leaf.parentElement : null;
    })() ||
    blockEl;

  return convertNodeToHtml(contentEl, links);
}

function convertNodeToHtml(node, links) {
  let html = '';

  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      html += escapeHtml(child.textContent);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();
    const style = child.getAttribute('style') || '';
    const innerHtml = convertNodeToHtml(child, links);

    if (tag === 'br') { html += '<br>'; continue; }

    if (tag === 'b' || tag === 'strong') {
      html += `<strong>${innerHtml}</strong>`;
      continue;
    }

    if (tag === 'em' || tag === 'i') {
      html += `<em>${innerHtml}</em>`;
      continue;
    }

    if (tag === 'code') {
      html += `<code>${escapeHtml(child.textContent)}</code>`;
      continue;
    }

    if (tag === 'a') {
      const href = child.getAttribute('href') || '';
      const text = child.textContent.trim();
      if (href && !href.startsWith('#') && text) {
        const existing = links.findIndex(l => l.url === href);
        const idx = existing >= 0 ? existing + 1 : (links.push({ text, url: href }), links.length);
        html += `${escapeHtml(text)}<sup>[${idx}]</sup>`;
      } else {
        html += escapeHtml(text);
      }
      continue;
    }

    if (tag === 'span') {
      const isBold =
        style.includes('font-weight:600') || style.includes('font-weight: 600') ||
        style.includes('font-weight:700') || style.includes('font-weight: 700') ||
        style.includes('font-weight:bold') || style.includes('font-weight: bold') ||
        child.classList.contains('notion-bold');
      const isItalic =
        style.includes('font-style:italic') || style.includes('font-style: italic') ||
        child.classList.contains('notion-italic');
      const isStrike =
        style.includes('line-through') || child.classList.contains('notion-strikethrough');
      const isUnder =
        (style.includes('underline') && !style.includes('line-through')) ||
        child.classList.contains('notion-underline');

      let result = innerHtml;
      if (isBold) result = `<strong>${result}</strong>`;
      if (isItalic) result = `<em>${result}</em>`;
      if (isStrike) result = `<s>${result}</s>`;
      if (isUnder) result = `<u>${result}</u>`;
      html += result;
      continue;
    }

    // Block-level elements: preserve line breaks and empty lines between them
    if (tag === 'div' || tag === 'p') {
      const stripped = innerHtml.replace(/<br\s*\/?>/g, '').trim();
      if (!stripped) {
        // Empty block = empty line
        html += '<br>';
      } else {
        if (html) html += '<br>';
        html += innerHtml;
      }
      continue;
    }

    html += innerHtml;
  }

  return html;
}

function parseNotionCodeBlock(el) {
  const langEl =
    el.querySelector('.notion-code-block-language') ||
    el.querySelector('[aria-label]') ||
    el.querySelector('select') ||
    el.querySelector('[class*="language"]');

  let language = 'plaintext';
  if (langEl) {
    language =
      langEl.getAttribute('aria-label') ||
      langEl.value ||
      langEl.textContent.trim() ||
      'plaintext';
  }

  const codeEl =
    el.querySelector('pre') ||
    el.querySelector('[spellcheck="false"]') ||
    el.querySelector('[contenteditable]');

  return { type: 'code', language, content: codeEl ? codeEl.textContent : '' };
}

function parseNotionCallout(el, links) {
  const iconEl =
    el.querySelector('.notion-record-icon') ||
    el.querySelector('[class*="icon"]') ||
    el.querySelector('[class*="emoji"]');
  const icon = iconEl ? iconEl.textContent.trim() : '💡';

  const clone = el.cloneNode(true);
  const cloneIcon =
    clone.querySelector('.notion-record-icon') ||
    clone.querySelector('[class*="icon"]');
  if (cloneIcon) cloneIcon.remove();

  return { type: 'callout', icon, content: convertNodeToHtml(clone, links) };
}

function parseNotionImage(el) {
  const imgEl = el.querySelector('img');
  if (!imgEl) return null;

  // currentSrc = 浏览器实际加载的 URL（经 srcset 选择后的绝对 URL）
  // img.src    = JS 属性，给出绝对 URL（比 getAttribute 更可靠）
  // 跳过 blob: 地址（本地缓存，无法被外部 fetch 重取）
  const current  = imgEl.currentSrc || '';
  const domSrc   = imgEl.src || '';
  const attrSrc  = imgEl.getAttribute('src') || '';
  const srcset   = imgEl.getAttribute('srcset') || imgEl.srcset || '';
  const srcsetFirst = srcset ? srcset.split(',')[0].trim().split(/\s+/)[0] : '';

  // 优先使用 data: URL（由 crawler 预转换），其次用 http URL，跳过 blob:
  const src = [current, domSrc, attrSrc, srcsetFirst]
    .find(s => s && !s.startsWith('blob:')) || '';

  if (!src) return null;

  const captionEl =
    el.querySelector('[placeholder="Add a caption"]') ||
    el.querySelector('[class*="caption"]');
  const caption = captionEl ? captionEl.textContent.trim() : '';

  return { type: 'image', url: src, caption };
}

function parseNotionVideo(el) {
  const videoEl = el.querySelector('video');
  const iframeEl = el.querySelector('iframe');
  let url = '', thumbnailUrl = '';

  if (videoEl) {
    // 优先用 .src（浏览器解析后的完整绝对 URL）
    url = videoEl.src || videoEl.getAttribute('src') || '';
    thumbnailUrl = videoEl.poster || videoEl.getAttribute('poster') || '';
  } else if (iframeEl) {
    url = iframeEl.getAttribute('src') || '';
  }

  const imgEl = el.querySelector('img');
  if (imgEl && !thumbnailUrl) thumbnailUrl = imgEl.getAttribute('src') || '';

  return { type: 'video', url, thumbnailUrl };
}

function parseNotionToggle(el, links, depth) {
  // aria-roledescription="toggle" 精准定位标题，避免匹配 contenteditable="false" 的箭头按钮
  const summaryEl =
    el.querySelector('[aria-roledescription="toggle"]') ||
    el.querySelector('[contenteditable="true"]') ||
    el.querySelector('[data-content-editable-leaf]');
  const summary = summaryEl ? convertNodeToHtml(summaryEl, links) : '';

  // 通过箭头按钮的 aria-controls 属性找到子内容容器（新版 Notion 使用动态 id）
  let childrenContainer = null;
  const btn = el.querySelector('[role="button"][aria-controls]');
  if (btn) {
    const childrenId = btn.getAttribute('aria-controls');
    // document.getElementById 不需要 CSS 转义，比 querySelector('#:ro5:') 更稳定
    const found = childrenId ? document.getElementById(childrenId) : null;
    childrenContainer = (found && el.contains(found)) ? found : null;
  }
  if (!childrenContainer) {
    childrenContainer =
      el.querySelector('[class*="toggle-content"]') ||
      el.querySelector('[class*="children"]');
  }

  let children = [];
  if (childrenContainer && depth < 5) {
    // 子容器内有一层 flex-direction:column 的 wrapper，取其子元素
    const innerCol =
      childrenContainer.querySelector('[style*="column"]') ||
      childrenContainer;
    children = parseNotionBlocks(Array.from(innerCol.children), links, depth + 1);
  }

  return { type: 'toggle', content: summary, children };
}

function parseNotionColumnList(el, links, depth) {
  const columns = el.querySelectorAll('[class*="notion-column-block"]');
  const columnBlocks = [];

  for (const col of columns) {
    columnBlocks.push(parseNotionBlocks(Array.from(col.children), links, depth + 1));
  }

  return { type: 'column_list', columns: columnBlocks };
}

function parseNotionBookmark(el, links) {
  const linkEl = el.querySelector('a');
  if (!linkEl) return null;

  const url = linkEl.getAttribute('href') || '';
  const titleEl =
    el.querySelector('[class*="title"]') ||
    el.querySelector('strong') ||
    el.querySelector('[class*="bookmark-title"]');
  const text = titleEl ? titleEl.textContent.trim() : url;

  if (url) {
    links.push({ text, url });
    return { type: 'bookmark', text, url, linkIndex: links.length };
  }
  return null;
}

// ── 新增：表格解析 ─────────────────────────────────────────────────────────

function parseNotionTable(el, links) {
  const rows = [];

  // 优先从真实 <table><tr><td> 结构中取，避免 [class*="cell"] 匹配到多层嵌套元素
  const tableEl = el.querySelector('table');
  const rowEls = tableEl
    ? Array.from(tableEl.querySelectorAll('tr'))
    : Array.from(el.querySelectorAll('tr.notion-table-row, [data-block-type="table_row"]'));

  rowEls.forEach((rowEl, rowIndex) => {
    const cellEls = rowEl.querySelectorAll('td, th');
    if (cellEls.length === 0) return;
    const cells = [];
    cellEls.forEach(cellEl => {
      // 取单元格内的 contenteditable 文本节点
      const textEl =
        cellEl.querySelector('[contenteditable="true"]') ||
        cellEl.querySelector('[class*="table-cell-text"]');
      cells.push(textEl ? convertNodeToHtml(textEl, links) : cellEl.textContent.trim());
    });
    rows.push({ cells, isHeader: rowIndex === 0 });
  });

  return rows.length > 0 ? { type: 'table', rows } : null;
}

// ── 新增：嵌入/数据库块解析 ────────────────────────────────────────────────

function parseNotionEmbed(el, links) {
  const linkEl = el.querySelector('a');
  const iframeEl = el.querySelector('iframe');
  const url = (linkEl && linkEl.getAttribute('href')) ||
               (iframeEl && iframeEl.getAttribute('src')) || '';

  const titleEl = el.querySelector('[class*="title"]') || el.querySelector('strong');
  const title = titleEl ? titleEl.textContent.trim() : '嵌入内容';

  return url ? { type: 'embed', url, title } : null;
}

// ── 新增：同步块解析 ─────────────────────────────────────────────────────

function parseNotionSynced(el, links, depth) {
  if (depth >= 5) return null;
  const inner = el.querySelector('[class*="synced-block"]') || el;
  const children = parseNotionBlocks(Array.from(inner.children), links, depth + 1);
  // 扁平化同步块内容
  return children.length > 0 ? children[0] : null;
}

function parseNotionListItem(el, listType, links, depth) {
  const listSelector =
    '.notion-bulleted_list-block, .notion-numbered_list-block, ' +
    '[data-block-type="bulleted_list"], [data-block-type="numbered_list"]';

  // 克隆元素并移除嵌套列表块，避免其文字污染当前项
  const clone = el.cloneNode(true);
  Array.from(clone.querySelectorAll(listSelector)).forEach(n => n.remove());

  let content = extractNotionRichText(clone, links);
  if (!content || !content.trim()) {
    content = escapeHtml(clone.textContent.replace(/\n+/g, ' ').trim());
  }

  // 找"直属于当前项"的嵌套列表块（过滤掉更深层嵌套 + 无内容的 UI 占位元素）
  let children = [];
  if (depth < 4) {
    const nestedEls = Array.from(el.querySelectorAll(listSelector)).filter(n => {
      const nearest = n.parentElement && n.parentElement.closest(listSelector);
      return nearest === el && n.textContent.trim().length > 0;
    });
    if (nestedEls.length > 0) {
      children = parseNotionBlocks(nestedEls, links, depth + 1);
    }
  }

  return { content, children };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
