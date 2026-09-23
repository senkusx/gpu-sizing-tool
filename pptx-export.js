/* PowerPoint export of the guided results page, in the Radian Arc "InferX
   Platform Model" template.

   The template's geometry, colours and typefaces were measured from the
   sales-enablement deck: a full-bleed teal wash behind every content slide, the
   wordmark top right, a monospace kicker, a regular-weight title over a bold
   teal strapline and a short lime-to-teal rule, content between 2.3" and 5.2",
   an optional bold takeaway line, and a CONFIDENTIAL / [n] footer. The title
   slide carries the photo mosaic, the app icon and the coloured squares.

   Slides are built from the results the page has already rendered — one per
   card, tables paginated, notes carried across — plus the rack drawings
   rasterised from their SVGs. Source citations are left out of the deck.

   PptxGenJS (vendor/) generates the file; the brand artwork lives in
   assets/deck-assets.js. Both load on the first export, not with the page. */
window.PPTXExport = (function () {
  'use strict';

  const LIBS = ['vendor/pptxgen.bundle.js', 'assets/deck-assets.js'];

  /* ---------- template ---------- */
  const T = {
    black: '000000', body: '595959', bodyDark: '404040', label: '44546A', border: 'DDDDDD',
    teal: '0AA597', tealDark: '0A7F75', tealTint: 'EEFAF6', tealLine: '9ADCCF',
    lime: 'B0F26A', green: '58E294', aqua: '00D3BF', yellow: 'FCCE03', pink: 'FC2797', grey: 'E7E6E6',
  };
  const FONT_T = 'Inter Tight', FONT_M = 'Space Mono', FONT_L = 'Roboto Mono', FONT = 'Arial', MONO = 'Courier New';

  // The page's CSS variables as they should read on a white slide. The chart
  // series map onto the template palette; the rack drawings keep their own.
  const CSS_VARS = {
    '--text-primary': '#1c1917', '--text-secondary': '#57534e', '--text-muted': '#78716c',
    '--border': '#e7e5e4', '--border-strong': '#d6d3d1', '--surface': '#f5f5f4', '--surface-2': '#e7e6e6',
    '--page': '#ffffff', '--accent': '#0aa597', '--series-1': '#0aa597', '--series-2': '#fcce03',
    '--series-3': '#b0f26a', '--good': '#0aa597', '--warning': '#b58900', '--critical': '#fc2797', '--info': '#0aa597',
  };

  // Slide geometry, inches, as measured from the template.
  // Slide is 10 × 5.625 (LAYOUT_16x9).
  const MX = 0.62, CW = 8.879;                 // content column
  const TOP = 2.29, BOTTOM = 5.2;              // content band
  const TAKE_Y = 4.953, TAKE_H = 0.273;        // takeaway strip; content ends above it when present
  const LOGO = { x: 8.595, y: 0.279, w: 1.189, h: 0.152, sq: { x: 9.743, y: 0.194, s: 0.069 } };

  /* ---------- text helpers ---------- */
  const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const cssColor = (v) => {
    v = collapse(v);
    const m = /^var\((--[\w-]+)\)/.exec(v);
    if (m) v = CSS_VARS[m[1]] || '#000000';
    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    if (rgb) return [rgb[1], rgb[2], rgb[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.slice(1).toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(v)) return v.slice(1).split('').map((c) => c + c).join('').toUpperCase();
    return '000000';
  };
  // Background colour of an element, from its inline style when it carries a
  // CSS variable (the page's swatches do) and the computed style otherwise.
  const bgOf = (el) => {
    if (!el) return T.grey;
    const inline = el.style && (el.style.background || el.style.backgroundColor || el.style.getPropertyValue('--c'));
    if (inline) return cssColor(inline);
    return cssColor(getComputedStyle(el).backgroundColor);
  };
  // Text of an element with a space before any <small>/<span class="unit">, so
  // "1,234" + "tok/s" reads as two words rather than one.
  const textOf = (el) => {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('small, .unit').forEach((s) => s.insertAdjacentText('afterbegin', ' '));
    return collapse(c.textContent);
  };
  // Rich runs from an element's children: links become hyperlinks, <strong>
  // bold, <em> italic; everything else is plain text.
  const runsOf = (el) => {
    const runs = [];
    const walk = (node, opts) => {
      if (node.nodeType === 3) { const t = node.textContent.replace(/\s+/g, ' '); if (t) runs.push({ text: t, options: { ...opts } }); return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'BR') { runs.push({ text: '', options: { breakLine: true } }); return; }
      const next = { ...opts };
      if (tag === 'STRONG' || tag === 'B') next.bold = true;
      if (tag === 'EM' || tag === 'I') next.italic = true;
      if (tag === 'CODE') next.fontFace = MONO;
      if (tag === 'A' && node.href) next.hyperlink = { url: node.href };
      if (tag === 'SMALL' || node.classList.contains('unit')) runs.push({ text: ' ', options: {} });
      node.childNodes.forEach((n) => walk(n, next));
    };
    el.childNodes.forEach((n) => walk(n, {}));
    if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ''); runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, ''); }
    return runs.filter((r) => r.text !== '' || r.options.breakLine);
  };
  // The deck carries no source citations: a note that is one is dropped, and
  // a trailing "Source: …" sentence is cut from the rest.
  const stripSources = (runs) => {
    const text = runs.map((r) => r.text).join('');
    if (/^(Part numbers?|Sources?)\b/i.test(text)) return [];
    const out = [];
    for (const r of runs) {
      const i = r.text.search(/(^|\s)Sources?:/);
      if (i < 0) { out.push(r); continue; }
      const head = r.text.slice(0, i).replace(/\s+$/, '');
      if (head) out.push({ ...r, text: head });
      break;
    }
    return out;
  };

  // Rough Arial metrics for pagination: characters per inch and line height.
  const cpi = (pt) => 130 / pt;
  const lineH = (pt) => (pt * 1.25) / 72;
  const linesFor = (text, widthIn, pt) => Math.max(1, Math.ceil(collapse(text).length / Math.max(4, Math.floor(widthIn * cpi(pt)))));
  // Largest size at which a bold headline fits one line, within limits.
  const fitPt = (text, widthIn, max, min) => Math.min(max, Math.max(min, Math.floor((widthIn * 112) / Math.max(1, text.length))));

  /* ---------- library loading ---------- */
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Could not load ${src}`));
        document.head.appendChild(s);
      }).catch((e) => { delete loaded[src]; throw e; });
    }
    return loaded[src];
  }
  async function loadLibs() {
    await Promise.all(LIBS.map(loadScript));
    if (!window.PptxGenJS) throw new Error('PptxGenJS did not initialise');
    if (!window.DECK_ASSETS) throw new Error('Deck artwork did not load');
    return window.PptxGenJS;
  }

  /* ---------- rasterisation ---------- */
  // The drawings reference the page's CSS variables for labels and boxes, which
  // a standalone SVG cannot resolve, so they are substituted before rendering.
  function svgToPng(svgMarkup, scale) {
    let svg = svgMarkup.replace(/var\((--[\w-]+)\)/g, (_, v) => CSS_VARS[v] || '#000000');
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const w = vb ? +vb[1] : 800, h = vb ? +vb[2] : 600;
    const s = Math.min(scale, 3200 / Math.max(w, h));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve({ data: c.toDataURL('image/png'), w, h });
      };
      img.onerror = () => reject(new Error('SVG could not be rasterised'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  // The short rule under the strapline is a lime-to-teal gradient, which the
  // generator cannot fill natively, so it is a tiny image.
  function rulePng() {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 4;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 320, 0);
    g.addColorStop(0, '#' + T.lime); g.addColorStop(0.5, '#' + T.green); g.addColorStop(1, '#' + T.aqua);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 320, 4);
    return c.toDataURL('image/png');
  }

  /* ---------- deck ---------- */
  function Deck(pptx, meta, assets) {
    this.pptx = pptx;
    this.meta = meta;
    this.assets = assets;
    this.rule = rulePng();
    this.count = 0;
    pptx.layout = 'LAYOUT_16x9';
    pptx.author = 'InferX solution sizing tool';
    pptx.title = meta.title;
    // Content chrome: the wash, the wordmark and the footer label.
    pptx.defineSlideMaster({
      title: 'CONTENT',
      background: { data: assets.bg },
      objects: [
        { image: { x: LOGO.x, y: LOGO.y, w: LOGO.w, h: LOGO.h, data: assets.logo } },
        { rect: { x: LOGO.sq.x, y: LOGO.sq.y, w: LOGO.sq.s, h: LOGO.sq.s, fill: { color: T.black } } },
        { text: { text: 'CONFIDENTIAL', options: { x: MX, y: 5.321, w: 2.344, h: 0.152, fontFace: FONT_M, fontSize: 8, color: T.body, valign: 'middle', margin: 0 } } },
      ],
    });
    pptx.defineSlideMaster({
      title: 'TITLE',
      background: { color: 'FFFFFF' },
      objects: [
        { image: { x: LOGO.x, y: LOGO.y, w: LOGO.w, h: LOGO.h, data: assets.logo } },
        { rect: { x: LOGO.sq.x, y: LOGO.sq.y, w: LOGO.sq.s, h: LOGO.sq.s, fill: { color: T.black } } },
      ],
    });
    this.slide = null;
    this.y = TOP;
    this.title = '';
    this.sub = '';
    this.bottom = BOTTOM;
  }

  Deck.prototype.pageNumber = function () {
    this.count++;
    this.slide.addText(`[${this.count}]`, { x: 9.068, y: 5.321, w: 0.495, h: 0.152, fontFace: FONT_M, fontSize: 8, color: T.body, align: 'right', valign: 'middle', margin: 0 });
  };

  /* A content slide: kicker, title, teal strapline, rule. `takeaway` fills the
     strip above the footer with a bold teal line and shortens the band. */
  Deck.prototype.newSlide = function (title, sub, opts = {}) {
    this.slide = this.pptx.addSlide({ masterName: 'CONTENT' });
    this.title = title; this.sub = sub;
    const kicker = this.meta.kicker + (opts.continued ? ' · CONTINUED' : '');
    this.slide.addText(kicker, { x: 0.652, y: 0.625, w: 6, h: 0.338, fontFace: FONT_M, fontSize: 12, color: T.black, valign: 'middle', margin: 0 });
    this.slide.addText(title, { x: MX, y: 0.98, w: CW, h: 0.47, fontFace: FONT_T, fontSize: fitPt(title, CW, 32, 22), color: T.black, valign: 'middle', margin: 0 });
    if (sub) this.slide.addText(sub, { x: MX, y: 1.42, w: CW, h: 0.47, fontFace: FONT_T, fontSize: fitPt(sub, CW, 32, 18), bold: true, color: T.teal, valign: 'middle', margin: 0 });
    this.slide.addImage({ data: this.rule, x: 0.652, y: 2.103, w: 1.079, h: 0.013 });
    this.pageNumber();
    this.y = TOP;
    this.bottom = opts.takeaway ? TAKE_Y - 0.08 : BOTTOM;
    if (opts.takeaway) this.takeaway(opts.takeaway);
    return this.slide;
  };

  Deck.prototype.takeaway = function (text) {
    this.slide.addText(text, { x: MX, y: TAKE_Y, w: 8.703, h: TAKE_H, fontFace: FONT_T, fontSize: fitPt(text, 8.703, 14, 10), bold: true, color: T.tealDark, valign: 'middle', margin: 0 });
  };

  // Room for a block of the given height, continuing onto a new slide when
  // the current one is full.
  Deck.prototype.need = function (h) {
    if (this.y + h > this.bottom && this.y > TOP + 0.01) this.newSlide(this.title, this.sub, { continued: true });
    return this.y;
  };

  Deck.prototype.addNote = function (runs, pt = 9) {
    runs = stripSources(runs);
    if (!runs.length) return;
    const text = runs.map((r) => r.text).join('');
    const h = linesFor(text, CW, pt) * lineH(pt) + 0.08;
    const y = this.need(h + 0.1);
    this.slide.addText(runs.map((r) => ({ text: r.text, options: { ...r.options } })),
      { x: MX, y: y + 0.06, w: CW, h, fontFace: FONT, fontSize: pt, color: T.body, valign: 'top', paraSpaceAfter: 2, margin: 0 });
    this.y = y + h + 0.14;
  };

  Deck.prototype.addBullets = function (items, pt = 11) {
    const paras = [];
    let lines = 0;
    items.forEach((it) => {
      const runs = it.runs.length ? it.runs : [{ text: it.text, options: {} }];
      runs.forEach((r, i) => paras.push({ text: r.text, options: { ...r.options, bullet: i === 0 ? true : undefined, breakLine: i === runs.length - 1 } }));
      lines += linesFor(runs.map((r) => r.text).join(''), CW - 0.3, pt);
    });
    const h = lines * lineH(pt) + items.length * 0.06 + 0.1;
    const y = this.need(Math.min(h, this.bottom - TOP));
    this.slide.addText(paras, { x: MX, y, w: CW, h: Math.min(h, this.bottom - y), fontFace: FONT, fontSize: pt, color: T.body, valign: 'top', paraSpaceAfter: 4, margin: 0 });
    this.y = y + h + 0.1;
  };

  /* Stat tiles in the template's card idiom: thin teal frame, bold value,
     monospace label. */
  Deck.prototype.addTiles = function (tiles) {
    const perRow = tiles.length <= 4 ? tiles.length : tiles.length <= 6 ? 3 : 4;
    const gap = 0.2, bw = (CW - gap * (perRow - 1)) / perRow, bh = 0.72;
    const rows = Math.ceil(tiles.length / perRow);
    const y0 = this.need(rows * (bh + gap) - gap + 0.1);
    tiles.forEach((t, i) => {
      const r = Math.floor(i / perRow), c = i % perRow;
      const x = MX + c * (bw + gap), y = y0 + r * (bh + gap);
      this.slide.addShape(this.pptx.ShapeType.rect, { x, y, w: bw, h: bh, fill: { color: 'FFFFFF' }, line: { color: T.tealLine, width: 0.75 } });
      this.slide.addText(t.v, { x: x + 0.12, y: y + 0.08, w: bw - 0.24, h: 0.36, fontFace: FONT_T, fontSize: fitPt(t.v, bw - 0.24, 16, 10), bold: true, color: T.black, valign: 'middle', margin: 0 });
      this.slide.addText(t.k.toUpperCase(), { x: x + 0.12, y: y + 0.44, w: bw - 0.24, h: 0.22, fontFace: FONT_L, fontSize: 7, color: T.label, valign: 'middle', margin: 0 });
    });
    this.y = y0 + rows * (bh + gap) - gap + 0.18;
  };

  Deck.prototype.addBar = function (segs) {
    const y = this.need(0.5);
    const known = segs.filter((s) => s.w != null).reduce((a, s) => a + s.w, 0);
    let x = MX;
    segs.forEach((s) => {
      const pct = s.w != null ? s.w : Math.max(0, 100 - known);
      const w = (pct / 100) * CW;
      if (w <= 0.005) return;
      this.slide.addShape(this.pptx.ShapeType.rect, { x, y, w, h: 0.28, fill: { color: s.color }, line: { color: 'FFFFFF', width: 0.5 } });
      x += w;
    });
    this.y = y + 0.36;
  };

  Deck.prototype.addLegend = function (items, fixedY) {
    const pt = 8.5;
    const widths = items.map((it) => Math.min(CW, it.text.length / cpi(pt) + 0.35));
    const rows = [[]];
    let x = 0;
    widths.forEach((w, i) => {
      if (x + w > CW && rows[rows.length - 1].length) { rows.push([]); x = 0; }
      rows[rows.length - 1].push(i); x += w + 0.15;
    });
    const y0 = fixedY != null ? fixedY : this.need(rows.length * 0.24 + 0.05);
    rows.forEach((row, r) => {
      let cx = MX;
      row.forEach((i) => {
        const it = items[i], y = y0 + r * 0.24;
        if (it.line) this.slide.addShape(this.pptx.ShapeType.line, { x: cx, y: y + 0.1, w: 0.22, h: 0, line: { color: it.color, width: 1.5, dashType: it.dashed ? 'dash' : 'solid' } });
        else this.slide.addShape(this.pptx.ShapeType.rect, { x: cx, y: y + 0.045, w: 0.12, h: 0.12, fill: { color: it.color }, line: { color: T.border, width: 0.5 } });
        this.slide.addText(it.text, { x: cx + (it.line ? 0.28 : 0.18), y, w: widths[i], h: 0.2, fontFace: FONT, fontSize: pt, color: T.body, valign: 'middle', margin: 0 });
        cx += widths[i] + 0.15;
      });
    });
    if (fixedY == null) this.y = y0 + rows.length * 0.24 + 0.1;
  };

  /* Tables paginate by row: each row's height is estimated from its wrapped
     text, rows are dealt onto slides until the band is full, and the header
     repeats on every continuation. */
  Deck.prototype.addTable = function (tbl) {
    const cols = tbl.cols;
    const pt = tbl.body.length > 14 || cols > 4 ? 8 : 9;
    const maxLen = [...Array(cols)].map((_, c) => Math.max(...[tbl.head, ...tbl.body].map((r) => (r[c] ? collapse(r[c].text).length : 0))));
    const weights = maxLen.map((l, c) => (tbl.numeric[c] ? Math.min(l, 16) : Math.min(l, 48)) + 6);
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => Math.max(0.85, (w / total) * CW));
    const scale = CW / widths.reduce((a, b) => a + b, 0);
    const colW = widths.map((w) => w * scale);

    const cell = (c, ci, head) => ({
      text: collapse(c.text),
      options: {
        fontFace: c.mono ? MONO : FONT, fontSize: pt, bold: head || c.bold,
        color: head ? T.tealDark : c.bold ? T.black : T.bodyDark,
        align: tbl.numeric[ci] && !c.span ? 'right' : 'left', valign: 'middle',
        fill: { color: head ? T.tealTint : c.highlight ? 'F5F5F5' : 'FFFFFF' },
        border: { type: 'solid', color: T.border, pt: 0.5 },
        colspan: c.span || undefined, margin: [2, 4, 2, 4],
      },
    });
    const rowH = (r) => {
      let lines = 1;
      r.forEach((c, ci) => {
        const w = c.span ? colW.slice(ci, ci + c.span).reduce((a, b) => a + b, 0) : colW[ci];
        lines = Math.max(lines, linesFor(c.text, w - 0.12, pt));
      });
      return lines * lineH(pt) + 0.09;
    };
    const headRow = tbl.head.length ? tbl.head.map((c, ci) => cell(c, ci, true)) : null;
    const headH = headRow ? rowH(tbl.head) : 0;

    let i = 0;
    while (i < tbl.body.length) {
      const y = this.need(headH + rowH(tbl.body[i]) + 0.1);
      const rows = headRow ? [headRow] : [];
      const hs = headRow ? [headH] : [];
      let used = headH;
      while (i < tbl.body.length) {
        const h = rowH(tbl.body[i]);
        if (y + used + h > this.bottom && rows.length > (headRow ? 1 : 0)) break;
        rows.push(tbl.body[i].map((c, ci) => cell(c, ci, false)));
        hs.push(h); used += h; i++;
      }
      this.slide.addTable(rows, { x: MX, y, w: CW, colW, rowH: hs, autoPage: false });
      this.y = y + used + 0.15;
    }
  };

  Deck.prototype.addImage = function (img, box) {
    const ar = img.w / img.h;
    let w = box.w, h = w / ar;
    if (h > box.h) { h = box.h; w = h * ar; }
    const x = box.x + (box.align === 'center' ? (box.w - w) / 2 : 0);
    this.slide.addImage({ data: img.data, x, y: box.y, w, h });
    return { x, y: box.y, w, h };
  };

  /* ---------- reading the rendered cards ---------- */
  function parseTable(t) {
    const head = [...t.querySelectorAll('thead th')].map((th) => ({ text: textOf(th), num: th.classList.contains('num') }));
    const body = [...t.querySelectorAll('tbody tr')].map((tr) => {
      const highlight = tr.classList.contains('highlight');
      return [...tr.children].map((td) => ({
        text: textOf(td), highlight, num: td.classList.contains('num'),
        bold: highlight || !!td.querySelector('strong') || /600|700|bold/.test(td.style.fontWeight),
        mono: !!td.querySelector('code') && textOf(td) === textOf(td.querySelector('code')),
        span: td.colSpan > 1 ? td.colSpan : 0,
      }));
    });
    const cols = Math.max(head.length, ...body.map((r) => r.reduce((a, c) => a + (c.span || 1), 0)));
    const numeric = [...Array(cols)].map((_, c) => {
      if (head[c]) return head[c].num;
      const cells = body.map((r) => r[c]).filter((x) => x && !x.span);
      return cells.length > 0 && cells.every((x) => x.num);
    });
    return { head, body, cols, numeric };
  }

  function legendItems(el) {
    return [...el.querySelectorAll('.legend-item')].map((li) => {
      const sw = li.querySelector('.swatch, .line, .ra-line');
      const line = !!(sw && (sw.classList.contains('line') || sw.classList.contains('ra-line')));
      return { text: textOf(li), color: bgOf(sw), line, dashed: !!(sw && sw.classList.contains('dashed')) };
    });
  }

  function blocksOf(card) {
    const blocks = [];
    [...card.children].forEach((el) => {
      const cls = el.classList;
      if (el.tagName === 'H2' || cls.contains('view-toggle') || cls.contains('ra-overview') || cls.contains('ra-rack-row') || cls.contains('ra-topology')) return;
      if (cls.contains('tiles')) blocks.push({ type: 'tiles', tiles: [...el.querySelectorAll('.tile')].map((t) => ({ v: textOf(t.querySelector('.v')), k: textOf(t.querySelector('.k')) })) });
      else if (cls.contains('stackbar')) blocks.push({ type: 'bar', segs: [...el.children].map((d) => ({ w: d.style.width ? parseFloat(d.style.width) : null, color: bgOf(d) })) });
      else if (cls.contains('legend')) blocks.push({ type: 'legend', items: legendItems(el) });
      else if (cls.contains('card-note') || cls.contains('disclaimer')) blocks.push({ type: 'note', runs: runsOf(el) });
      else if (cls.contains('check-item')) {
        const level = ['critical', 'warning', 'info'].find((l) => cls.contains(l)) || 'info';
        blocks.push({ type: 'check', level, text: textOf(el) });
      } else if (el.tagName === 'UL') blocks.push({ type: 'bullets', items: [...el.querySelectorAll(':scope > li')].map((li) => ({ text: textOf(li), runs: runsOf(li) })) });
      else el.querySelectorAll('table').forEach((t) => blocks.push({ type: 'table', ...parseTable(t) }));
    });
    // Consecutive design checks become one bullet list.
    const out = [];
    blocks.forEach((b) => {
      if (b.type === 'check') {
        const color = { critical: T.pink, warning: 'B58900', info: T.teal }[b.level];
        const item = { text: b.text, runs: [{ text: `${b.level.toUpperCase()}  `, options: { bold: true, color, fontFace: FONT_L, fontSize: 9 } }, { text: b.text, options: {} }] };
        if (out.length && out[out.length - 1].checks) out[out.length - 1].items.push(item);
        else out.push({ type: 'bullets', checks: true, items: [item] });
      } else out.push(b);
    });
    return out;
  }

  /* ---------- slides ---------- */
  function titleSlide(deck, meta, assets) {
    const slide = deck.pptx.addSlide({ masterName: 'TITLE' });
    deck.slide = slide;
    deck.count++;
    const sq = (x, y, w, h, color) => slide.addShape(deck.pptx.ShapeType.rect, { x, y, w, h, fill: { color }, line: { color, width: 0 } });
    // Photo mosaic, then the squares and white knock-outs the template lays over it.
    slide.addImage({ data: assets.mosaic, x: 3.377, y: 1.023, w: 6.623, h: 4.092 });
    [[3.377, 4.093, 3.045, 1.03], [8.459, 1.003, 0.521, 0.536], [0, 2.5, 0.62, 0.625]].forEach(([x, y, w, h]) => sq(x, y, w, h, 'FFFFFF'));
    [[5.91, 3.579], [0, 0.004], [6.931, 0.516], [6.413, 0.004], [3.351, 0.004], [3.351, 0.518]].forEach(([x, y]) => sq(x, y, 0.513, 0.512, T.yellow));
    [[0.51, 0.501], [3.865, 0.004], [1.727, 1.835]].forEach(([x, y]) => sq(x, y, 0.513, 0.512, T.pink));
    sq(0.19, 5.362, 0.069, 0.069, T.yellow);
    // App icon, divider, title and subtitle.
    slide.addImage({ data: assets.icon, x: 0.47, y: 4.246, w: 0.831, h: 0.831 });
    slide.addShape(deck.pptx.ShapeType.line, { x: 1.566, y: 4.27, w: 0, h: 0.85, line: { color: 'BFBFBF', width: 0.75 } });
    slide.addText(meta.title, { x: 1.774, y: 4.4, w: 4.6, h: 0.5, fontFace: FONT_T, fontSize: 28, color: T.black, valign: 'middle', margin: 0 });
    slide.addText(`${meta.subtitle} · ${meta.date}`, { x: 1.774, y: 4.86, w: 4.6, h: 0.3, fontFace: FONT_M, fontSize: 10, color: T.body, valign: 'middle', margin: 0 });
  }

  /* The five service-layer cards of the template, carrying the solution's
     headline figures. */
  function glanceSlide(deck, meta) {
    deck.newSlide(meta.glance.title, meta.glance.sub, { takeaway: meta.glance.takeaway });
    const cards = meta.cards.slice(0, 5);
    const cw = 1.578, gap = 0.203, y = 2.312, h = 2.55;
    const x0 = MX + (CW - (cards.length * cw + (cards.length - 1) * gap)) / 2;
    cards.forEach((c, i) => {
      const x = x0 + i * (cw + gap);
      deck.slide.addShape(deck.pptx.ShapeType.rect, { x, y, w: cw, h, fill: { color: c.highlight ? T.tealTint : 'FFFFFF' }, line: { color: c.highlight ? T.teal : T.tealLine, width: c.highlight ? 1.5 : 0.75 } });
      const ix = x + 0.109, iw = cw - 0.218;
      deck.slide.addText(c.n, { x: ix, y: y + 0.1, w: iw, h: 0.17, fontFace: FONT_L, fontSize: 8, color: T.teal, valign: 'middle', margin: 0 });
      deck.slide.addText(c.title, { x: ix, y: y + 0.33, w: iw, h: 0.5, fontFace: FONT_T, fontSize: 14, bold: true, color: T.black, valign: 'top', margin: 0 });
      deck.slide.addText(c.status.toUpperCase(), { x: ix, y: y + 0.9, w: iw, h: 0.24, fontFace: FONT_L, fontSize: 7, color: T.label, valign: 'middle', margin: 0 });
      deck.slide.addText(c.value, { x: ix, y: y + 1.2, w: iw, h: 0.34, fontFace: FONT_T, fontSize: fitPt(c.value, iw, 13, 9), bold: true, color: T.black, valign: 'middle', margin: 0 });
      const paras = c.body.split('\n').map((t, j, a) => ({ text: t, options: { breakLine: j < a.length - 1 } }));
      deck.slide.addText(paras, { x: ix, y: y + 1.58, w: iw, h: h - 1.66, fontFace: FONT, fontSize: 8.5, color: T.body, valign: 'top', paraSpaceAfter: 4, margin: 0 });
    });
  }

  function cardSlides(deck, card, meta) {
    const heading = textOf(card.querySelector('h2'));
    const c = meta.copy(heading);
    deck.newSlide(c.title, c.sub, { takeaway: c.takeaway });
    blocksOf(card).forEach((b) => {
      if (b.type === 'tiles') deck.addTiles(b.tiles);
      else if (b.type === 'bar') deck.addBar(b.segs);
      else if (b.type === 'legend') deck.addLegend(b.items);
      else if (b.type === 'note') deck.addNote(b.runs);
      else if (b.type === 'bullets') deck.addBullets(b.items);
      else if (b.type === 'table') deck.addTable(b);
    });
  }

  async function rackSlides(deck, figures, card, meta) {
    const c = meta.copy(textOf(card.querySelector('h2')));

    // Deployment overview, with the class legend beneath the drawing.
    deck.newSlide('Deployment Overview', c.sub, { takeaway: c.takeaway });
    const ov = await svgToPng(figures.overview, 3);
    const box = deck.addImage(ov, { x: MX, y: TOP, w: CW, h: 1.95, align: 'center' });
    deck.addLegend(figures.overviewLegend, box.y + box.h + 0.1);

    // Elevations: as many racks per slide as fit the content band.
    for (const side of ['front', 'rear']) {
      const imgs = [];
      for (let i = 0; i < figures.groups.length; i++) imgs.push(await svgToPng(figures.rack(figures.groups[i], side, i), 2));
      const title = side === 'front' ? 'Rack Elevations' : 'Rear Elevations and Cabling';
      const sub = side === 'front' ? 'Front, drawn to the real unit' : 'Ports, ribbons and trunks per plane';
      const capH = 0.24, gap = 0.18, keyY = 4.7;
      const boxH = (side === 'rear' ? keyY - 0.08 : BOTTOM) - TOP - capH;
      let i = 0;
      while (i < imgs.length) {
        deck.newSlide(title, sub);
        if (side === 'rear') deck.addLegend(figures.cableLegend, keyY);
        let x = MX;
        const y = TOP + capH;
        while (i < imgs.length) {
          const img = imgs[i];
          const w = Math.min(boxH * (img.w / img.h), CW);
          if (x + w > MX + CW + 0.01 && x > MX) break;
          const g = figures.groups[i];
          const placed = deck.addImage(img, { x, y, w, h: boxH });
          deck.slide.addText(`${g.rack.name.replace(/ \d+$/, '')}${g.count > 1 ? ` × ${g.count}` : ''}`,
            { x, y: y - capH, w: placed.w, h: capH - 0.02, fontFace: FONT_T, fontSize: 9, bold: true, color: T.black, align: 'center', valign: 'middle', margin: 0 });
          x += placed.w + gap; i++;
        }
      }
    }

    // Fabric topology, one plane per slide.
    for (const plane of figures.planes) {
      deck.newSlide('Fabric Topology', plane.title);
      const topo = await svgToPng(figures.topology([plane.key]), 2);
      deck.addImage(topo, { x: MX, y: TOP, w: CW, h: BOTTOM - TOP, align: 'center' });
    }
  }

  /* ---------- entry point ---------- */
  /* `figures` supplies the rack drawings: { groups, rack(group, side, i),
     overview, topology(only), planes, overviewLegend, cableLegend }. `meta`
     carries the copy: title, subtitle, kicker, cards, glance, copy(heading). */
  async function exportDeck({ results, figures, meta }) {
    const PptxGenJS = await loadLibs();
    const pptx = new PptxGenJS();
    const deck = new Deck(pptx, meta, window.DECK_ASSETS);
    titleSlide(deck, meta, window.DECK_ASSETS);
    glanceSlide(deck, meta);
    for (const card of [...results.querySelectorAll('.card')]) {
      const heading = textOf(card.querySelector('h2'));
      if (card.querySelector('.hero') || /^Sources/i.test(heading)) continue;
      if (card.querySelector('.ra-overview')) await rackSlides(deck, figures, card, meta);
      else cardSlides(deck, card, meta);
    }
    await pptx.writeFile({ fileName: meta.fileName });
  }

  return { exportDeck, svgToPng };
})();
