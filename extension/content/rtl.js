// يضبط اتجاه النص العربي في الصفحة
// الفكرة: نحسب كلمات كل فقرة. إذا كانت الكلمات العربية أكثر أو مساوية للإنجليزية تصير الفقرة من اليمين
// وما نلمس أي شي الموقع ضابطه من نفسه

(() => {
  'use strict';

  if (window.__rtlEverywhere) return;
  window.__rtlEverywhere = true;

  const MARK = 'data-rtle';
  const ALIGN = 'data-rtle-align';
  const EDIT = 'data-rtle-edit';
  const STYLE_ID = 'rtle-style';

  const AR = /[֐-׿؀-ۿݐ-ݿࡰ-ࣿיִ-﷿ﹰ-﻿]/;
  const LAT = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

  // أماكن ما نلمسها أبدا
  const SKIP = [
    'pre', 'code', 'kbd', 'samp', 'script', 'style', 'noscript', 'textarea', 'input', 'select', 'svg', 'math',
    '.katex', '.MathJax', '.cm-editor', '.CodeMirror', '.monaco-editor', '.ace_editor', '[data-rtle-skip]'
  ].join(',');

  // محررات تبنيها مكتبات تعيد رسم النص بنفسها. هذي نضبطها بالتنسيق فقط بدون ما نعدل عناصرها
  const MANAGED_EDITORS = '.ProseMirror, [data-lexical-editor], [data-slate-editor], .ql-editor, .DraftEditor-root, .tiptap';

  const CSS = `
[${MARK}="rtl"] { direction: rtl; }
[${MARK}="ltr"] { direction: ltr; }
[${MARK}="plain"] { unicode-bidi: plaintext; }
[${ALIGN}] { text-align: right !important; }
table[${MARK}="rtl"] { margin-left: auto; }
[${MARK}="rtl"] :is(p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, td, th, div):not([${MARK}]) { unicode-bidi: plaintext; }
[${MARK}="rtl"] :is(li, td, th):not([${MARK}]) { text-align: right; }
[${MARK}] pre, [${MARK}] pre * { direction: ltr !important; text-align: left !important; unicode-bidi: isolate; }
[${MARK}] :is(code, kbd, samp) { direction: ltr; unicode-bidi: isolate; }
[${MARK}] :is(.katex, .MathJax, svg) { direction: ltr; unicode-bidi: isolate; }
[${MARK}] a { unicode-bidi: plaintext; }
[${EDIT}][contenteditable]:not([contenteditable="false"]),
[${EDIT}][contenteditable]:not([contenteditable="false"]) :is(p, div, li, h1, h2, h3, h4, h5, h6, blockquote),
[${EDIT}] [contenteditable]:not([contenteditable="false"]),
[${EDIT}] [contenteditable]:not([contenteditable="false"]) :is(p, div, li, h1, h2, h3, h4, h5, h6, blockquote) { unicode-bidi: plaintext; text-align: start; }
[${EDIT}] [contenteditable] :is(pre, code) { unicode-bidi: isolate; direction: ltr; text-align: left; }
`;

  // نعد الكلمات مو الحروف لأن الكلمة الإنجليزية حروفها أكثر وتظلم الفقرة العربية
  function count(text) {
    let ar = 0;
    let lat = 0;
    const words = text.slice(0, 4000).split(/\s+/);
    for (const w of words) {
      if (!w) continue;
      if (AR.test(w)) ar++;
      else if (LAT.test(w)) lat++;
    }
    return { ar, lat };
  }

  function isArabic(text) {
    const c = count(text);
    return c.ar > 0 && c.ar >= c.lat;
  }

  const originals = new WeakMap();
  let styleCache = new Map();
  let running = false;
  let observer = null;
  let timer = 0;
  let watch = 0;
  const pending = new Set();

  function cs(el) {
    let s = styleCache.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  }

  function remember(el) {
    if (!originals.has(el)) {
      originals.set(el, { dir: el.getAttribute('dir'), style: el.getAttribute('style') });
    }
  }

  function setDir(el, dir) {
    remember(el);
    el.setAttribute('dir', dir);
    el.setAttribute(MARK, dir);
  }

  function restore(el) {
    const o = originals.get(el);
    if (o) {
      if (o.dir === null) el.removeAttribute('dir');
      else el.setAttribute('dir', o.dir);
      if (o.style === null) el.removeAttribute('style');
      else el.setAttribute('style', o.style);
      originals.delete(el);
    } else {
      el.removeAttribute('dir');
    }
    el.removeAttribute(MARK);
    el.removeAttribute(ALIGN);
  }

  // أقرب عنصر كتلة يحتوي النص
  function blockOf(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    const root = document.body;
    while (el && el !== root && el !== document.documentElement) {
      const d = cs(el).display;
      if (d !== 'inline' && d !== 'contents' && !d.startsWith('ruby')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function skipped(el) {
    return !!el.closest(SKIP) || el.isContentEditable;
  }

  function evaluate(el) {
    if (!el || !el.isConnected || skipped(el)) return;
    const mine = el.getAttribute(MARK);
    const text = el.textContent || '';

    if (isArabic(text)) {
      if (mine === 'rtl' || mine === 'plain') return;
      // صف أزرار وعنوان مثل شريط النافذة: نقلبه يخرب ترتيب الأزرار فنضبط النص بس
      if (!mine && /flex|grid/.test(cs(el).display) && el.children.length > 1) {
        remember(el);
        el.setAttribute(MARK, 'plain');
        return;
      }
      // الموقع ضابطه من نفسه
      if (!mine && cs(el).direction === 'rtl' && !el.parentElement?.closest(`[${MARK}="rtl"]`)) return;
      setDir(el, 'rtl');
      if (cs(el).textAlign === 'left') el.setAttribute(ALIGN, '');
      fixList(el);
      fixTable(el);
    } else if (mine === 'rtl' || mine === 'plain') {
      restore(el);
    }
  }

  // القائمة نفسها لازم تنقلب عشان الأرقام والنقاط تصير يمين
  function fixList(el) {
    if (el.tagName !== 'LI') return;
    const list = el.parentElement;
    if (!list || !/^(UL|OL)$/.test(list.tagName) || list.getAttribute(MARK)) return;
    const items = [...list.children].filter((c) => c.tagName === 'LI');
    const ar = items.filter((li) => isArabic(li.textContent || '')).length;
    if (ar * 2 < items.length) return;
    if (cs(list).direction === 'rtl' && !list.parentElement?.closest(`[${MARK}="rtl"]`)) return;
    const s = cs(list);
    const pl = parseFloat(s.paddingLeft) || 0;
    const pr = parseFloat(s.paddingRight) || 0;
    setDir(list, 'rtl');
    // بعض المواقع حاطة المسافة يسار بشكل ثابت فننقلها يمين
    if (pl > pr) {
      list.style.paddingRight = pl + 'px';
      list.style.paddingLeft = pr + 'px';
    }
  }

  // الجدول ينقلب كامل إذا أغلب خلاياه عربي
  function fixTable(el) {
    if (el.tagName !== 'TD' && el.tagName !== 'TH') return;
    const table = el.closest('table');
    if (!table || table.getAttribute(MARK)) return;
    const cells = [...table.querySelectorAll('th, td')].slice(0, 300);
    let ar = 0;
    let lat = 0;
    for (const c of cells) {
      const n = count(c.textContent || '');
      if (n.ar > 0 && n.ar >= n.lat) ar++;
      else if (n.lat > 0) lat++;
    }
    if (ar === 0 || ar < lat) return;
    if (cs(table).direction === 'rtl' && !table.parentElement?.closest(`[${MARK}="rtl"]`)) return;
    setDir(table, 'rtl');
  }

  function scan(root) {
    const blocks = new Set();
    if (root.nodeType === 3) {
      const b = blockOf(root);
      if (b) blocks.add(b);
    } else if (root.nodeType === 1) {
      if (root.closest && root.closest(SKIP)) return blocks;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (AR.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
      });
      let n;
      while ((n = walker.nextNode())) {
        const b = blockOf(n);
        if (b) blocks.add(b);
      }
      markEditors(root);
    }
    return blocks;
  }

  function run(roots) {
    styleCache = new Map();
    const blocks = new Set();
    const edited = new Set();
    for (const r of roots) {
      if (!r.isConnected) continue;
      const el = r.nodeType === 3 ? r.parentElement : r;
      if (el && el.isContentEditable) {
        edited.add(el);
        continue;
      }
      for (const b of scan(r)) blocks.add(b);
      // النص اللي تغير ممكن يقلب فقرة كانت عربية
      const b = blockOf(r);
      if (b && b.getAttribute(MARK)) blocks.add(b);
    }
    for (const b of blocks) evaluate(b);
    for (const el of edited) if (el.isConnected) fixEditedNode(el);
    styleCache = new Map();
  }

  // ---------- مربعات الكتابة ----------

  function markEditors(root) {
    const eds = root.querySelectorAll ? root.querySelectorAll('[contenteditable]:not([contenteditable="false"])') : [];
    for (const ed of eds) {
      if (AR.test(ed.textContent || '')) markEditor(ed);
    }
  }

  function editorRoot(el) {
    let root = el;
    while (root.parentElement && root.parentElement.isContentEditable) root = root.parentElement;
    return root;
  }

  // نحط العلامة على العنصر اللي فوق المحرر عشان ما نعدل المحرر نفسه
  function markEditor(ed) {
    const root = editorRoot(ed);
    if (root.closest(SKIP)) return;
    const holder = root.parentElement || root;
    if (!holder.hasAttribute(EDIT)) holder.setAttribute(EDIT, '');
  }

  function caretBlock(root) {
    const host = root.getRootNode();
    const sel = (host && host.getSelection && host.getSelection()) || root.ownerDocument.getSelection();
    if (!sel || !sel.anchorNode) return null;
    let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if (!el || !root.contains(el)) return null;
    while (el !== root) {
      if (/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(el.tagName)) return el;
      el = el.parentElement;
    }
    return root;
  }

  // المحررات العادية مثل محرر البريد نكتب الاتجاه داخل الرسالة نفسها عشان توصل صح للطرف الثاني
  function fixEditable(target) {
    const root = editorRoot(target);
    if (root.closest(SKIP)) return;
    if (AR.test(root.textContent || '')) markEditor(root);
    if (root.closest(MANAGED_EDITORS) || root.querySelector(MANAGED_EDITORS)) return;
    setBlockDir(caretBlock(root));
  }

  // بعض المحررات تمنع الكتابة العادية وتكتب الحروف بنفسها فما يوصلنا خبر الكتابة
  // مثل بريد هوستنقر فنضبط السطر اللي تغير من التغيير نفسه
  function fixEditedNode(el) {
    const root = editorRoot(el);
    if (root.closest(SKIP)) return;
    if (AR.test(root.textContent || '')) markEditor(root);
    if (root.closest(MANAGED_EDITORS) || root.querySelector(MANAGED_EDITORS)) return;
    let b = el;
    while (b && b !== root && !/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(b.tagName)) b = b.parentElement;
    setBlockDir(b || root);
  }

  function setBlockDir(block) {
    if (!block) return;
    const text = block.textContent || '';
    if (isArabic(text)) {
      if (block.getAttribute('dir') !== 'rtl') {
        block.setAttribute('dir', 'rtl');
        block.style.textAlign = 'right';
      }
    } else if (count(text).lat > 0 && block.getAttribute('dir') === 'rtl') {
      block.setAttribute('dir', 'ltr');
      block.style.textAlign = 'left';
    }
  }

  const FIELD = 'textarea, input:not([type]), input[type="text"], input[type="search"]';

  function fixField(el) {
    const text = el.value || '';
    if (isArabic(text)) {
      if (el.getAttribute(MARK) !== 'rtl') setDir(el, 'rtl');
    } else if (el.getAttribute(MARK) === 'rtl') {
      restore(el);
    }
  }

  // العنصر الحقيقي حتى لو كان داخل مكون مغلق مثل بعض محررات البريد
  function realTarget(e) {
    const path = e.composedPath ? e.composedPath() : [];
    const t = path[0] || e.target;
    return t && t.nodeType === 3 ? t.parentElement : t;
  }

  function onInput(e) {
    const t = realTarget(e);
    if (!t || t.nodeType !== 1) return;
    shadowStyle(t);
    if (t.matches(FIELD)) fixField(t);
    else if (t.isContentEditable) fixEditable(t);
  }

  function onFocus(e) {
    const t = realTarget(e);
    if (t && t.nodeType === 1 && t.matches(FIELD) && t.value) fixField(t);
  }

  // التنسيق ما يدخل المكونات المغلقة فنحطه داخلها
  const styled = new WeakSet();
  let shadowStyles = [];
  function shadowStyle(el) {
    const r = el.getRootNode && el.getRootNode();
    if (!r || r.nodeType !== 11 || styled.has(r)) return;
    styled.add(r);
    const st = r.ownerDocument.createElement('style');
    st.setAttribute('data-rtle-style', '');
    st.textContent = CSS;
    r.appendChild(st);
    shadowStyles.push(st);
  }

  // ---------- الإطارات ----------
  // بعض المحررات تبني إطارها بعد ما يفتح المتصفح الصفحة فما تصله الإضافة
  // فنربطه من الصفحة الأم ما دام من نفس الموقع
  const linked = new WeakSet();
  function linkFrame(f) {
    let doc;
    try { doc = f.contentDocument; } catch (e) { return; }
    if (!doc || !doc.documentElement || linked.has(doc)) return;
    if (doc.getElementById(STYLE_ID)) return; // الإضافة شغالة فيه من نفسها
    linked.add(doc);
    const st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
    doc.addEventListener('input', onInput, true);
    doc.addEventListener('focusin', onFocus, true);
    if (doc.body && AR.test(doc.body.textContent || '')) markEditors(doc.body);
  }

  function linkFrames() {
    for (const f of document.querySelectorAll('iframe')) linkFrame(f);
  }

  // ---------- التشغيل والإيقاف ----------

  function flush() {
    timer = 0;
    const roots = [...pending];
    pending.clear();
    run(roots);
  }

  function queue(node) {
    pending.add(node);
  }

  // نضبط التغيير قبل ما يرسمه المتصفح عشان الرد اللي ينكتب يطلع من اليمين من أول حرف
  // ولو التغيير كبير جدا نأجله شوي عشان ما تعلق الصفحة
  function afterMutations() {
    if (!pending.size) return;
    if (pending.size > 400) {
      if (!timer) timer = setTimeout(flush, 60);
      return;
    }
    clearTimeout(timer);
    flush();
  }

  function start() {
    if (running || !document.body) return;
    running = true;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    }

    run([document.body]);

    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') queue(m.target);
        else for (const n of m.addedNodes) {
          if (n.nodeType === 1 || n.nodeType === 3) queue(n);
          if (n.nodeName === 'IFRAME' || (n.nodeType === 1 && n.querySelector && n.querySelector('iframe'))) setTimeout(linkFrames, 300);
        }
      }
      afterMutations();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    document.addEventListener('input', onInput, true);
    document.addEventListener('focusin', onFocus, true);
    linkFrames();
    // المحرر أحيانا يعيد بناء صفحته بعد ما بدأت الإضافة فنتأكد كل شوي
    watch = setInterval(() => {
      if (!document.getElementById(STYLE_ID) && document.body) {
        running = false;
        observer?.disconnect();
        start();
      }
      linkFrames();
    }, 1500);
  }

  function stop() {
    if (!running) return;
    running = false;
    observer?.disconnect();
    observer = null;
    clearTimeout(timer);
    timer = 0;
    pending.clear();
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('focusin', onFocus, true);
    clearInterval(watch);
    for (const st of shadowStyles) { st.getRootNode && styled.delete(st.getRootNode()); st.remove(); }
    shadowStyles = [];
    for (const f of document.querySelectorAll('iframe')) {
      let doc;
      try { doc = f.contentDocument; } catch (e) { continue; }
      if (!doc || !linked.has(doc)) continue;
      linked.delete(doc);
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('focusin', onFocus, true);
      doc.getElementById(STYLE_ID)?.remove();
      for (const el of doc.querySelectorAll(`[${EDIT}]`)) el.removeAttribute(EDIT);
    }
    for (const el of document.querySelectorAll(`[${MARK}]`)) restore(el);
    for (const el of document.querySelectorAll(`[${EDIT}]`)) el.removeAttribute(EDIT);
    document.getElementById(STYLE_ID)?.remove();
  }

  // اسم الموقع الأساسي حتى لو كنا داخل إطار داخلي مثل محرر البريد
  function siteKey() {
    try {
      const anc = location.ancestorOrigins;
      if (anc && anc.length) return new URL(anc[anc.length - 1]).hostname;
    } catch (e) { /* نكمل بالعنوان الحالي */ }
    return location.hostname;
  }

  const site = siteKey();

  function apply(off) {
    if ((off || []).includes(site)) stop();
    else start();
  }

  // للاختبار المحلي بدون متجر الإضافات
  const store = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  if (store) {
    store.get({ off: [] }, (v) => apply(v.off));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.off) apply(changes.off.newValue);
    });
  } else {
    start();
  }
})();
