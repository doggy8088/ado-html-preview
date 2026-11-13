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

  // 把來源文字裡的 HTML 實體（&amp; / &#169; / &copy;…）解成字元。
  // 瀏覽器內用 <textarea> 的 RCDATA 解析（只解實體、不建立任何元素、不執行任何東西）支援全部具名實體；
  // node（測試）沒有 DOM 時退回常見實體＋數字實體。
  let entityBox = null;
  const decodeEntities = (s) => {
    s = String(s);
    if (s.indexOf('&') === -1) return s;
    if (typeof document !== 'undefined' && document.createElement) {
      try {
        if (!entityBox) entityBox = document.createElement('textarea');
        entityBox.innerHTML = s.replace(/</g, '&lt;');
        return entityBox.value;
      } catch { /* 退回下面的簡易版 */ }
    }
    return s
      .replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; })
      .replace(/&#x([0-9a-f]+);/gi, (m, n) => { const c = parseInt(n, 16); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; })
      .replace(/&nbsp;/g, '\u00a0').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  };

  // 標題的純文字：直接走 marked 的 inline tokens，而不是對渲染後的 HTML 做 regex 去標籤
  // （屬性值裡的 > 會讓 /<[^>]*>/ 切錯位置）。inline HTML 標籤略過、標籤之間的文字保留；
  // withAlt 為 true 時圖片以 alt 文字代表（只有圖片的標題才不會變成空白目錄項）。
  function inlinePlainText(tokens, withAlt) {
    let out = '';
    for (const t of tokens || []) {
      if (!t) continue;
      if (t.type === 'image') { if (withAlt) out += t.text || ''; continue; }
      if (t.type === 'html') continue;
      if (t.type === 'br') { out += ' '; continue; }
      if (Array.isArray(t.tokens) && t.tokens.length) { out += inlinePlainText(t.tokens, withAlt); continue; }
      if (t.type === 'codespan' || t.type === 'escape') { out += t.text || ''; continue; } // 原始字元，不含實體
      out += decodeEntities(t.text != null ? t.text : (t.raw || ''));
    }
    return out;
  }
  const headingText = (tokens) => {
    const tidy = (s) => s.replace(/\s+/g, ' ').trim();
    return tidy(inlinePlainText(tokens, false)) || tidy(inlinePlainText(tokens, true));
  };

  // 標題錨點：保留中文 / 字母 / 數字，空白轉 -，其餘符號移除；重複時加 -1、-2
  // 輸入是純文字（headingText 的結果）
  function makeSlugger() {
    const used = new Set();
    return (text) => {
      let base = String(text).trim().toLowerCase()
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
  // 開頭圍籬依 CommonMark：最多 3 個前導空白；反引號圍籬的 info string 不可含反引號
  // （```inline``` 這種同一行內的程式碼片段不是圍籬，否則後面的 [[_TOC_]] / ::: mermaid 會全部失效）。
  // 結尾圍籬：同一種字元、長度不短於開頭、後面只能有空白。
  const FENCE_OPEN = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/;
  const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
  function outsideFences(md, fn) {
    const out = [];
    let buf = [];
    let fence = null;
    const flush = () => { if (buf.length) { out.push(fn(buf.join('\n'))); buf = []; } };
    for (const line of md.split('\n')) {
      if (fence) {
        out.push(line);
        const close = line.match(FENCE_CLOSE);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
        continue;
      }
      const open = line.match(FENCE_OPEN);
      if (open) {
        flush();
        fence = open[1] || open[2];
        out.push(line);
      } else {
        buf.push(line);
      }
    }
    flush();
    return out.join('\n');
  }

  // Azure DevOps Wiki 的 ::: mermaid … ::: 語法改寫成 ```mermaid 圍籬，交給 marked 處理
  // 只接受最多 3 個前導空白：縮 4 格以上（或 tab）是 CommonMark 的縮排程式碼區塊，裡面的標記要保留為文字
  function normalizeMermaidBlocks(md) {
    return md.replace(/^ {0,3}:::[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}:::[ \t]*$/gm, (_, code) => '```mermaid\n' + code + '\n```');
  }

  // [[_TOC_]] 若直接交給 marked 會被解析成 [[<em>TOC</em>]]，先換成 HTML 註解佔位（marked 會原樣保留），渲染後再換成目錄。
  // 用註解而不是 <div>：<div> 是 CommonMark 的 type-6 HTML block，會一路吃到下一個空行，
  // [[_TOC_]] 下一行直接接標題的常見寫法會整段消失；註解區塊在同一行就結束。
  const TOC_PLACEHOLDER = '<!--ado-md-toc-->';
  function normalizeToc(md) {
    return md.replace(/^ {0,3}\[\[_TOC_\]\][ \t]*$/gm, TOC_PLACEHOLDER);
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
        const plain = headingText(tokens);
        const id = slug(plain);
        // toc[].text 維持「可直接放進 HTML 的字串」（已轉義），tocHtml 與外部呼叫端都直接使用
        state.toc.push({ level: depth, id, text: escapeHtml(plain) });
        if (!state.title && depth === 1) state.title = plain;
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
        return `<div class="md-code"><div class="md-code-head">${label}<button type="button" class="md-copy" data-label="複製" data-done="已複製" aria-label="複製" title="複製"></button></div>` +
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

  // 表格外包一層可水平捲動的容器，寬表格不會把版面撐破。
  // 開頭標籤可帶屬性（Markdown 裡的原始 HTML：<table border="1">），大小寫不拘；
  // 開關標籤成對處理：只有配到開頭的 </table> 才補 </div>，沒關閉的表格在文末補上，不會產生落單的 </div>。
  const TABLE_TAG = /<(\/?)table\b((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/gi;
  function wrapTables(html) {
    let open = 0;
    html = html.replace(TABLE_TAG, (tag, close) => {
      if (!close) { open++; return '<div class="md-table-wrap">' + tag; }
      if (!open) return tag;
      open--;
      return tag + '</div>';
    });
    while (open-- > 0) html += '</table></div>';
    return html;
  }

  function postprocess(html, state) {
    html = wrapTables(html);
    // 工作清單項目加上 class，方便隱藏原生 bullet（鬆散清單的 checkbox 包在 <p> 裡）
    html = html.replace(/<li>(\s*(?:<p>\s*)?<input[^>]*type="checkbox")/g, '<li class="md-task">$1');
    // [[_TOC_]]（見 normalizeToc）
    html = html.split(TOC_PLACEHOLDER).join(tocHtml(state.toc, 'md-toc-inline'));
    return html;
  }

  // DOM clobbering 防護（SANITIZE_DOM 關閉的補強）：
  //   - document 的具名屬性（[LegacyOverrideBuiltIns]）會被 <img name="querySelector"> 這類元素蓋掉，
  //     bootstrap 依賴 document.querySelector / getElementById / body / head…；embed / form / iframe / object
  //     已整個禁止，剩下的入口是 img 的 name，所以 name 只留在 <a>（<a name="…"> 是常見的錨點寫法，不會蓋到 document）。
  //   - window 的具名屬性（id="mermaid"）不會蓋掉既有的屬性，只會冒充「尚未載入」的全域；
  //     bootstrap 改用 getMermaid() 檢查真的函式庫物件，不靠刪 id（標題「Mermaid」的錨點就是 id="mermaid"）。
  function dropClobberingName(node, data) {
    if (data.attrName === 'name' && node.nodeName !== 'A') data.keepAttr = false;
  }

  function sanitize(html) {
    const DOMPurify = root.DOMPurify;
    if (!DOMPurify || !DOMPurify.isSupported) return html;
    DOMPurify.addHook('uponSanitizeAttribute', dropClobberingName);
    try {
      return DOMPurify.sanitize(html, {
        ADD_TAGS: ['kbd', 'details', 'summary', 'mark', 'abbr', 'sup', 'sub', 'button'],
        ADD_ATTR: ['id', 'class', 'align', 'loading', 'open', 'scope', 'data-label', 'data-done', 'aria-label', 'checked', 'disabled', 'type'],
        // 標題 id 直接用標題文字（title / body / links…），SANITIZE_DOM 會把這類 id 當成 DOM clobbering 刪掉；
        // 文件跑在沒有 allow-same-origin 的 sandbox 內，bootstrap 只用捕獲的區域變數與 getMermaid() 的型別檢查，
        // 不信任可被具名元素冒充的 window.*；document 的冒充入口由 dropClobberingName 擋掉
        SANITIZE_DOM: false,
        FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'],
        FORBID_ATTR: ['style', 'onerror', 'onload'],
        ALLOW_UNKNOWN_PROTOCOLS: false,
      });
    } finally {
      // hook 掛在共用的 DOMPurify 實例上，用完就移除，不影響其他呼叫端
      if (DOMPurify.removeHook.length >= 2) DOMPurify.removeHook('uponSanitizeAttribute', dropClobberingName);
      else DOMPurify.removeHook('uponSanitizeAttribute');
    }
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
