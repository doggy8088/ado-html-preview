// Azure DevOps Markdown Preview – 核心轉換（content script 與 Tampermonkey 共用）
// 依賴全域的 marked（必要）、hljs 與 DOMPurify（可選，缺少時自動略過語法上色 / 消毒）。
// render(md) 把 Markdown 轉成文章 HTML 片段，並回傳目錄、標題與是否含 mermaid 圖；
// 外層（md-shell.js）再把它包成完整的 HTML 文件。
//
// 支援的 Azure DevOps 慣用語法：
//   - YAML front matter（文件最前面的 --- 區塊）→ 摺疊的中繼資料表格
//   - [[_TOC_]] → 文內目錄
//   - ::: mermaid … ::: 與 ```mermaid → mermaid 圖（由 shell 的 bootstrap 於 iframe 內渲染）
//   - > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION] → 提示區塊
//   - GFM 表格、工作清單、刪除線、自動連結；換行視為 <br>（與 Azure DevOps 相同）

(function (root) {
  'use strict';

  const ALERT_TYPES = { NOTE: '附註', TIP: '提示', IMPORTANT: '重要', WARNING: '警告', CAUTION: '注意' };

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const stripTags = (html) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');

  const decodeEntities = (s) => s
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  // 標題錨點：保留中文 / 字母 / 數字，空白轉 -，其餘符號移除；重複時加 -1、-2
  function makeSlugger() {
    const used = new Set();
    return (text) => {
      let base = decodeEntities(stripTags(text)).trim().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}\-_]/gu, '')
        .replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!base) base = 'section';
      let id = base;
      for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      return id;
    };
  }

  // ---------- 前處理：front matter、::: mermaid ----------

  function splitFrontMatter(md) {
    const m = md.match(/^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    // 文件以 --- 分隔線開頭（而不是 front matter）時，區塊裡會有空行或沒有 key: value，這時不要吞掉內容
    if (!m || /\n[ \t]*\n/.test(m[1])) return { body: md, meta: null };
    const meta = [];
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([^\s:#][^:]*?)\s*:\s*(.*)$/);
      if (kv) meta.push([kv[1].trim(), kv[2].trim().replace(/^["']|["']$/g, '')]);
      else if (meta.length && /^\s+\S/.test(line)) meta[meta.length - 1][1] += (meta[meta.length - 1][1] ? ' ' : '') + line.trim();
    }
    if (!meta.length) return { body: md, meta: null };
    return { body: md.slice(m[0].length), meta };
  }

  // 把 Markdown 依 ``` / ~~~ 圍籬切段，只對圍籬「外」的文字套用 fn，
  // 避免示範 Azure DevOps 語法的程式碼區塊（例如 README 裡的 [[_TOC_]]、::: mermaid）被改寫
  function outsideFences(md, fn) {
    const out = [];
    let buf = [];
    let fence = null;
    const flush = () => { if (buf.length) { out.push(fn(buf.join('\n'))); buf = []; } };
    for (const line of md.split('\n')) {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        out.push(line);
        if (open && open[1][0] === fence[0] && open[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(line)) fence = null;
      } else if (open) {
        flush();
        fence = open[1];
        out.push(line);
      } else {
        buf.push(line);
      }
    }
    flush();
    return out.join('\n');
  }

  // Azure DevOps Wiki 的 ::: mermaid … ::: 語法改寫成 ```mermaid 圍籬，交給 marked 處理
  function normalizeMermaidBlocks(md) {
    return md.replace(/^[ \t]*:::[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*:::[ \t]*$/gm, (_, code) => '```mermaid\n' + code + '\n```');
  }

  // [[_TOC_]] 若直接交給 marked 會被解析成 [[<em>TOC</em>]]，先換成 HTML 註解佔位（marked 會原樣保留），渲染後再換成目錄。
  // 用註解而不是 <div>：<div> 是 CommonMark 的 type-6 HTML block，會一路吃到下一個空行，
  // [[_TOC_]] 下一行直接接標題的常見寫法會整段消失；註解區塊在同一行就結束。
  const TOC_PLACEHOLDER = '<!--ado-md-toc-->';
  function normalizeToc(md) {
    return md.replace(/^[ \t]*\[\[_TOC_\]\][ \t]*$/gm, TOC_PLACEHOLDER);
  }

  function frontMatterHtml(meta) {
    const rows = meta.map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('');
    return `<details class="md-frontmatter"><summary>文件資訊</summary><table>${rows}</table></details>\n`;
  }

  function tocHtml(toc, className) {
    if (!toc.length) return '';
    // 以最淺的層級為基準，讓只用 h2/h3 的文件也從第一層開始縮排
    // 子層的 <ul> 要放在父項目的 <li> 裡面（父 <li> 在子清單結束後才關閉），才是合法且語意正確的巢狀清單；
    // 層級跳躍（h1 直接接 h3）視為只深一層，避免產生沒有 <li> 的空殼 <ul>。
    const min = Math.min(...toc.map((t) => t.level));
    let html = '';
    let depth = 0;           // 目前打開的 <ul> 層數
    const liOpen = [];       // liOpen[d]：第 d 層目前是否有尚未關閉的 <li>
    for (const t of toc) {
      const level = Math.min(t.level - min + 1, depth + 1);
      while (depth > level) { if (liOpen[depth]) html += '</li>'; html += '</ul>'; liOpen[depth] = false; depth--; }
      if (depth === level && liOpen[depth]) html += '</li>';
      while (depth < level) { html += depth ? '<ul>' : `<ul class="${className}">`; depth++; liOpen[depth] = false; }
      html += `<li><a href="#${t.id}">${t.text}</a>`;
      liOpen[depth] = true;
    }
    while (depth > 0) { if (liOpen[depth]) html += '</li>'; html += '</ul>'; depth--; }
    return html;
  }

  // ---------- marked 設定 ----------

  function createMarked(state) {
    const marked = root.marked;
    if (!marked) throw new Error('marked 尚未載入');
    const hljs = root.hljs;
    const slug = makeSlugger();

    const renderer = {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slug(text);
        state.toc.push({ level: depth, id, text: stripTags(text) });
        if (!state.title && depth === 1) state.title = decodeEntities(stripTags(text));
        return `<h${depth} id="${id}"><a class="md-anchor" href="#${id}" aria-label="連結到此段落">#</a>${text}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
        if (language === 'mermaid') {
          state.hasMermaid = true;
          // 原始碼只放在 <pre> 文字裡（bootstrap 第一次渲染前會先把它存起來）：
          // 不放 data-source 屬性，因為 DOMPurify 的 SAFE_FOR_XML 會把含 --> 的屬性整個移除，流程圖會全部失敗
          return `<div class="md-mermaid"><pre class="mermaid">${escapeHtml(text)}</pre></div>\n`;
        }
        let body = null;
        if (hljs && language && hljs.getLanguage(language)) {
          try { body = hljs.highlight(text, { language, ignoreIllegals: true }).value; } catch { body = null; }
        }
        if (body == null) body = escapeHtml(text);
        const label = language ? `<span class="md-code-lang">${escapeHtml(language)}</span>` : '<span class="md-code-lang"></span>';
        return `<div class="md-code"><div class="md-code-head">${label}<button type="button" class="md-copy" data-label="複製" data-done="已複製">複製</button></div>` +
          `<pre><code class="hljs${language ? ` language-${escapeHtml(language)}` : ''}">${body}</code></pre></div>\n`;
      },
      blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        const m = body.match(/^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>\s*)?/i);
        if (m) {
          const type = m[1].toUpperCase();
          let rest = body.slice(m[0].length);
          if (/^<\/p>/.test(rest)) rest = rest.replace(/^<\/p>\s*/, ''); else rest = '<p>' + rest;
          return `<div class="md-alert md-alert-${type.toLowerCase()}"><p class="md-alert-title">${ALERT_TYPES[type]}</p>${rest}</div>\n`;
        }
        return `<blockquote>\n${body}</blockquote>\n`;
      },
      image({ href, title, text }) {
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text || '')}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`;
      },
    };

    const inst = new marked.Marked({ gfm: true, breaks: true, renderer });
    return inst;
  }

  // ---------- 後處理 ----------

  function postprocess(html, state) {
    // 表格外包一層可水平捲動的容器，寬表格不會把版面撐破
    html = html.replace(/<table>/g, '<div class="md-table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
    // 工作清單項目加上 class，方便隱藏原生 bullet
    html = html.replace(/<li>(\s*<input[^>]*type="checkbox")/g, '<li class="md-task">$1');
    // [[_TOC_]]（見 normalizeToc）
    html = html.split(TOC_PLACEHOLDER).join(tocHtml(state.toc, 'md-toc-inline'));
    return html;
  }

  function sanitize(html) {
    const DOMPurify = root.DOMPurify;
    if (!DOMPurify || !DOMPurify.isSupported) return html;
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['kbd', 'details', 'summary', 'mark', 'abbr', 'sup', 'sub', 'button'],
      ADD_ATTR: ['id', 'class', 'align', 'loading', 'open', 'scope', 'data-label', 'data-done', 'aria-label', 'checked', 'disabled', 'type'],
      // 標題 id 直接用標題文字（title / body / links…），SANITIZE_DOM 會把這類 id 當成 DOM clobbering 刪掉；
      // 文件跑在沒有 allow-same-origin 的 sandbox 內、bootstrap 不依賴 window.* 名稱，關掉無妨
      SANITIZE_DOM: false,
      FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'],
      FORBID_ATTR: ['style', 'onerror', 'onload'],
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
  }

  /**
   * @param {string} md 原始 Markdown
   * @returns {{ html: string, toc: Array<{level:number,id:string,text:string}>, title: string, hasMermaid: boolean }}
   */
  function render(md) {
    const state = { toc: [], title: '', hasMermaid: false };
    const { body, meta } = splitFrontMatter(md.replace(/\r\n?/g, '\n'));
    const src = outsideFences(body, (part) => normalizeToc(normalizeMermaidBlocks(part)));
    const html = createMarked(state).parse(src);
    const article = (meta ? frontMatterHtml(meta) : '') + postprocess(html, state);
    return { html: sanitize(article), toc: state.toc, title: state.title, hasMermaid: state.hasMermaid };
  }

  root.AdoMarkdown = { render, tocHtml, escapeHtml };
})(typeof globalThis !== 'undefined' ? globalThis : window);
