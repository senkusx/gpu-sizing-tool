/* Reference-architecture rack elevations.

   Draws the full solution — management, GPU compute, switch fabric and storage
   racks — in the same flat VisioCafe / VSD Grafx stencil idiom as rack.js, but
   for InferX equipment. Self-contained under window.RARack so it can share a
   page with the storage renderer without colliding on globals.

   Faceplates are drawn to the real unit: a DGX B300 is 10U with its PSU bank
   above the GPU tray, a Supermicro 8U HGX chassis carries a front GPU tray over
   an NVMe bank, and a WEKApod Nitro is a 2U four-node chassis rather than four
   separate 1U boxes. */
window.RARack = (function () {
  'use strict';

  /* Face geometry, drawn to scale. A 19" rack face is 482.6 mm wide and a
     rack unit is 44.45 mm tall, so at the 530 px the full face occupies here
     (500 px of equipment between two 15 px rails) one millimetre is 1.098 px
     and one unit is 48.8 px. Using 49 makes the elevation metrically correct:
     a 1U switch is as flat against a 19" face as it is in the room, which is
     what makes a device recognisable from its proportions alone. */
  const G = { U: 49, EQ_W: 500, RAIL: 15, TOP: 18, EAR: 13, LBL: 176, CH: 132 };
  G.RACK_W = G.EQ_W + G.RAIL * 2;
  // Cable channel to the right of the rack: one lane per plane, node links
  // innermost, leaf-to-spine uplinks outermost.
  G.LANE = { ew: 12, ns: 40, oob: 68, up: 100 };

  /* The three fabric planes. Colours are shared by the cabling, the deployment
     overview and the topology drawing so a reader can follow one plane across
     all three. */
  const ROLES = {
    ew: { name: 'east-west', title: 'East-west compute fabric', colour: '#2a78d6' },
    ns: { name: 'north-south', title: 'North-south fabric — storage and in-band', colour: '#eb6834' },
    oob: { name: 'out-of-band', title: 'Out-of-band management', colour: '#1baf7a' },
  };
  const ROLE_ORDER = ['ew', 'ns', 'oob'];

  const C = {
    frame: '#3c3c40', frameEdge: '#232326', railFace: '#4a4a4f', railHole: '#1b1b1e', uText: '#b9b9be',
    f1: '#55555a', f2: '#37373b', fEdge: '#1a1a1d',
    bay1: '#76767c', bay2: '#5c5c62', bayEdge: '#2a2a2e', handle: '#8e8e95',
    r1: '#e8e8ea', r2: '#cfcfd3', rEdge: '#4d4d52',
    psu: '#f2f2f4', psuEdge: '#5a5a60', latch: '#b0316f',
    port: '#17171a', portEdge: '#2f2f34', card: '#f6f6f8',
    green: '#35c759', amber: '#f0a020', nv: '#76b900',
    // DGX livery from RA-11337-001 Fig 2.1: a large brushed gold panel with a
    // lighter bezel, on a black chassis.
    dgxGold: '#a98f5c', dgxGoldLo: '#8d7647', dgxBezel: '#c9b482',
    // NVIDIA Spectrum switches ship in a tan/khaki chassis (Fig 4.6, Fig 4.10).
    nvTan: '#c3b795', nvTanLo: '#a89c7c', nvTanEdge: '#6d6448',
    blank: '#33333a', blankEdge: '#26262b',
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rect = (x, y, w, h, fill, stroke, rx = 0) =>
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="0.7"` : ''}${rx ? ` rx="${rx}"` : ''}/>`;
  const text = (x, y, s, fill, size = 8, anchor = 'start', weight = 400) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" font-family="system-ui,-apple-system,sans-serif">${esc(s)}</text>`;
  const circ = (cx, cy, r, fill) => `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}"/>`;
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

  function defs(uid) {
    return `<defs>
      <linearGradient id="fg${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.f1}"/><stop offset="0.55" stop-color="${C.f2}"/><stop offset="1" stop-color="${C.f1}"/></linearGradient>
      <linearGradient id="bg${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.bay1}"/><stop offset="1" stop-color="${C.bay2}"/></linearGradient>
      <linearGradient id="rg${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.r1}"/><stop offset="1" stop-color="${C.r2}"/></linearGradient>
      <pattern id="pf${uid}" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect x="0.8" y="0.8" width="2.1" height="2.1" fill="#9a9aa1" rx="0.4"/></pattern>
      <pattern id="pd${uid}" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect x="0.8" y="0.8" width="2.1" height="2.1" fill="#232326" rx="0.4"/></pattern>
      <linearGradient id="gold${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.dgxBezel}"/><stop offset="0.45" stop-color="${C.dgxGold}"/><stop offset="1" stop-color="${C.dgxGoldLo}"/></linearGradient>
      <linearGradient id="tan${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.nvTan}"/><stop offset="1" stop-color="${C.nvTanLo}"/></linearGradient>
      <pattern id="hc${uid}" width="7" height="6" patternUnits="userSpaceOnUse">
        <path d="M3.5 0 L7 1.7 L7 4.3 L3.5 6 L0 4.3 L0 1.7 Z" fill="none" stroke="#2a2a2e" stroke-width="0.6"/></pattern>
      <pattern id="hl${uid}" width="7" height="6" patternUnits="userSpaceOnUse">
        <path d="M3.5 0 L7 1.7 L7 4.3 L3.5 6 L0 4.3 L0 1.7 Z" fill="none" stroke="#3f3f45" stroke-width="0.6"/></pattern>
      <pattern id="hx${uid}" width="9" height="7.8" patternUnits="userSpaceOnUse">
        <path d="M4.5 0 L9 2.2 L9 5.6 L4.5 7.8 L0 5.6 L0 2.2 Z" fill="#1d1d20" stroke="#3a3a40" stroke-width="0.5"/></pattern>
      <pattern id="lat${uid}" width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 4 L4 0 L8 4 L4 8 Z" fill="none" stroke="#00000030" stroke-width="0.8"/></pattern>
    </defs>`;
  }

  /* ---------- stencil primitives ----------
     The parts every face is assembled from, drawn the way the VisioCafe
     stencils draw them: flat and front-on, with the latches, LEDs, grilles and
     handles that identify a part at a glance. Sizes are face pixels, 22 per U. */

  // Rack ears with a thumbscrew per U.
  function ears(w, h, dark) {
    const face = dark ? C.f1 : C.psu, edge = dark ? C.fEdge : C.rEdge;
    let s = rect(0, 0, G.EAR, h, face, edge) + rect(w - G.EAR, 0, G.EAR, h, face, edge);
    const n = Math.max(1, Math.round(h / G.U));
    for (let i = 0; i < n; i++) {
      const cy = (i + 0.5) * (h / n);
      [G.EAR / 2, w - G.EAR / 2].forEach((cx) => {
        s += circ(cx, cy, 2.3, dark ? '#6c6c73' : '#b9b9bf') + circ(cx, cy, 1.1, dark ? '#2a2a2e' : '#8d8d94');
      });
    }
    return s;
  }

  /* Hot-swap fan module, drawn as the switch stencils draw one: a hex-mesh
     grille behind a vertical pull handle, with the module's index beside it.
     `col` keeps the caller's tint so a dark chassis and a light one both
     read correctly. */
  /* Square call sites pass (x, y, size) or (x, y, size, colour); the wide ones
     pass an explicit height, so a string in the height slot means the short
     form and the arguments shift along. */
  function fan(x, y, w, h, col = '#3a3a3f', uid = '', label = '') {
    if (typeof h === 'string') { col = h; h = w; }
    else if (h === undefined) h = w;
    const light = col === '#e8e8ea' || col === C.psu;
    let o = rect(x, y, w, h, light ? '#e4e4e7' : col, light ? '#9a9aa1' : '#1c1c1f', 1);
    o += rect(x + 1.4, y + 1.4, w - 2.8, h - 2.8, `url(#${light ? 'hl' : 'hc'}${uid})`, '', 0.5);
    // Pull handle: a rounded bar down the middle with its grip at the base.
    const hw = Math.max(1.8, Math.min(w * 0.1, 3.4)), hx = x + w / 2 - hw / 2;
    o += rect(hx, y + h * 0.12, hw, h * 0.7, light ? '#6f6f76' : '#55555c', '', hw / 2);
    // The grip is a fixed-size part: it must not grow with a tall fan wall.
    o += circ(x + w / 2, y + h * 0.88, Math.max(0.9, Math.min(w * 0.18, 2.6)), light ? '#3a3a40' : '#8d8d94');
    if (label && w > 16) o += text(x + w - 2, y + h - 2.5, label, light ? '#5a5a60' : '#b9b9be', 4, 'end', 500);
    return o;
  }

  /* Power supply as the stencils draw one: a vent grid, the IEC C14 inlet
     with its three pins, a pull handle, the red/blue release latch and the
     fault and OK indicators. */
  function psu(x, y, w, h, uid, latch = C.latch) {
    let o = rect(x, y, w, h, C.psu, C.psuEdge, 1);
    // Vent grid at the left, drawn as squares rather than a pattern fill so it
    // reads at small sizes the way the stencil hatching does.
    const gw = Math.min(w * 0.3, 17), gx = x + 2.5, gy = y + 2.2, gh = h - 4.4;
    const cols = Math.max(2, Math.floor(gw / 3.2)), rowsN = Math.max(2, Math.floor(gh / 3.2));
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < cols; c++) {
        o += rect(gx + c * (gw / cols), gy + r * (gh / rowsN), gw / cols - 0.9, gh / rowsN - 0.9, '#3a3a40', '', 0.2);
      }
    }
    // Status indicators between the grid and the inlet.
    const lx = gx + gw + 2.5;
    if (h > 12) {
      o += circ(lx + 1.4, y + h * 0.34, 1, C.amber) + circ(lx + 1.4, y + h * 0.66, 1, C.green);
    }
    // IEC C14 inlet: rounded shell, three pins.
    const inW = Math.min(14, w * 0.24), inH = Math.min(9, h * 0.5);
    const ix = lx + 4, iy = y + h / 2 - inH / 2;
    o += rect(ix, iy, inW, inH, '#2a2a2e', '#111113', 1.6);
    o += rect(ix + inW * 0.18, iy + inH * 0.3, inW * 0.2, inH * 0.16, '#c9c9ce', '', 0);
    o += rect(ix + inW * 0.62, iy + inH * 0.3, inW * 0.2, inH * 0.16, '#c9c9ce', '', 0);
    o += rect(ix + inW * 0.4, iy + inH * 0.62, inW * 0.2, inH * 0.16, '#c9c9ce', '', 0);
    // Pull handle and the coloured release latch at the far edge.
    const hx = ix + inW + 3;
    if (hx < x + w - 6) {
      o += rect(hx, y + h * 0.28, Math.max(3, x + w - 6 - hx), h * 0.44, '#c2c2c8', '#8d8d94', 1.4);
    }
    o += rect(x + w - 3.4, y + 2, 1.9, (h - 4) / 2, '#c0392b', '', 0.4);
    o += rect(x + w - 3.4, y + 2 + (h - 4) / 2, 1.9, (h - 4) / 2, '#2f6fb0', '', 0.4);
    return o;
  }

  /* Drive carrier, drawn as the server stencils draw one: a dark body with
     rows of vent slots, the coloured release latch at its right edge and the
     activity LEDs beside it. `label` prints the media type across the face the
     way a populated NVMe carrier is marked. An empty slot is a blanking
     filler. */
  function bay25(x, y, w, h, uid, populated = true, label = '', latchCol = '#d7761f') {
    if (!populated) {
      return rect(x, y, w, h, '#2a2a2e', C.bayEdge, 0.7)
        + rect(x + 1.4, y + 2, w - 2.8, h - 4, `url(#pd${uid})`, '', 0.4);
    }
    let o = rect(x, y, w, h, '#4e4e55', '#232327', 0.7);
    o += rect(x + 1, y + 1, w - 2, h - 2, '#5c5c64', '#3a3a40', 0.5);
    // Vent slots down the carrier face.
    const slots = Math.max(2, Math.min(5, Math.floor((h - 6) / 5)));
    const sw = Math.max(2.5, w * 0.42), sx = x + w * 0.12;
    for (let i = 0; i < slots; i++) {
      o += rect(sx, y + 4 + i * ((h - 8) / slots), sw, Math.max(1.4, (h - 8) / slots - 2), '#2a2a2e', '', 0.4);
    }
    // Release latch and its pivot, then the activity and fault LEDs.
    const lw = Math.max(2.2, w * 0.17), lx = x + w - lw - 2.4;
    o += rect(lx, y + h * 0.3, lw, h * 0.4, latchCol, '#8a4a12', 0.5);
    o += circ(lx + lw / 2, y + h * 0.5, Math.max(0.6, lw * 0.22), '#f0e6d8');
    if (h > 16) {
      o += circ(x + w - 1.6, y + 3.2, 0.9, C.green) + circ(x + w - 1.6, y + h - 3.2, 0.9, '#3f3f45');
    }
    if (label && w > 16) o += text(sx, y + h - 3.5, label, '#c9c9ce', Math.min(5, h * 0.16), 'start', 500);
    return o;
  }

  // 3.5" carrier lying flat: latch handle across the top, LEDs at the right.
  function bay35(x, y, w, h, uid) {
    let o = rect(x, y, w, h, `url(#bg${uid})`, C.bayEdge, 0.7);
    o += rect(x + 1.2, y + 1.2, w - 2.4, Math.max(2, h * 0.22), C.handle, '', 0.5);
    o += rect(x + 2, y + h * 0.42, w - 4, h * 0.5, `url(#pd${uid})`, '', 0.4);
    return o + circ(x + w - 3, y + h * 0.3 + 1, 0.8, C.green);
  }

  // RJ45 jack, drawn the way the VisioCafe switch stencils draw one: a light
  // shell around a dark cavity, eight gold contacts along the top and the
  // latch slot at the bottom centre. `lit` colours the shell for a role —
  // blue for a BMC or management port, grey for console.
  function rj45(x, y, w = 6, h = 5.2, shell = '#d7d7db') {
    const ix = x + w * 0.13, iw = w * 0.74;
    let o = rect(x, y, w, h, shell, '#5a5a60', 0.5);
    o += rect(ix, y + h * 0.16, iw, h * 0.62, '#1b1b1e', '#111113', 0.3);
    // Contact fingers, or a single gold band once the pins fall below a pixel.
    const pins = w >= 5.5 ? 8 : 4, pw = iw / (pins * 1.7);
    if (pw >= 0.45) {
      for (let i = 0; i < pins; i++) {
        const px = ix + iw * ((i + 0.5) / pins) - pw / 2;
        o += rect(px, y + h * 0.2, pw, h * 0.3, '#c9a227', '', 0);
      }
    } else {
      o += rect(ix + iw * 0.12, y + h * 0.2, iw * 0.76, h * 0.28, '#c9a227', '', 0);
    }
    // Latch slot below the cavity.
    o += rect(x + w * 0.38, y + h * 0.78, w * 0.24, h * 0.16, '#1b1b1e', '', 0);
    return o;
  }

  /* Transceiver cage (SFP, QSFP, OSFP) as the stencils draw it: a dark cage
     with a light insert bar across the middle and the lane dots above it.
     Ports are drawn in pairs on a switch face, so `dots` follows the lane
     count — four for a QSFP/OSFP, two for an SFP. */
  function cage(x, y, w, h, dots = 4) {
    let o = rect(x, y, w, h, '#17171a', '#0e0e10', 0.6);
    const iw = w - 2.2, ix = x + 1.1;
    // The insert bar: the lighter block a plugged transceiver presents.
    const bh = Math.max(1.6, h * 0.3), by = y + h * 0.52;
    o += rect(ix, by, iw, bh, '#e4e4e7', '#9a9aa1', 0.2);
    if (w >= 7) {
      const n = Math.min(dots, Math.max(2, Math.floor(w / 3)));
      for (let i = 0; i < n; i++) {
        o += circ(ix + iw * ((i + 0.5) / n), y + h * 0.3, Math.min(0.75, w / 18), '#d6d6da');
      }
    }
    return o;
  }

  /* A pair of cages with the port numbers between them, which is how every
     Spectrum faceplate is labelled: "1/2 ▲▼ 3/4" under a stacked pair. */
  function cagePair(x, y, w, h, label, gap = 1) {
    const ch = (h - gap) / 2;
    return {
      svg: cage(x, y, w, ch) + cage(x, y + ch + gap, w, ch)
        + (label ? text(x + w / 2, y + h + 4.6, label, '#c9c9ce', 3.6, 'middle', 500) : ''),
      anchors: [{ x: x + w / 2, y: y + ch / 2 }, { x: x + w / 2, y: y + ch + gap + ch / 2 }],
    };
  }

  /* Switch status cluster: the little icon column every Spectrum faceplate
     carries at its left edge — fault, fan, reset, power, temperature. */
  function statusCluster(x, y, h) {
    const rows = [['#c8c8cc', '#35c759'], ['#c8c8cc', '#c8c8cc'], ['#c8c8cc', '#35c759']];
    let o = '';
    const step = Math.min(6, (h - 4) / rows.length);
    rows.forEach((pair, i) => {
      pair.forEach((col, j) => { o += rect(x + j * 4.2, y + i * step, 2.6, 1.6, col, '', 0.3); });
    });
    return o;
  }
  /* Low-profile PCIe bracket: a vented blank, or a card carrying cages.

     A populated card gets a green faceplate stripe along its top edge. On an
     8U GPU node the adapter is obvious from its size, but on a 1U management
     chassis a fitted BlueField sat beside an empty slot looked like a second
     blank — which is how the DPUs in the management stack came to read as
     absent even though they were drawn and cabled. The stripe and the label
     `genericRear` writes beneath it are what tell the two apart. */
  function bracket(x, y, w, h, cages) {
    if (!cages) {
      let o = rect(x, y, w, h, '#d9d9dd', C.psuEdge, 0.8);
      for (let k = 0; k < 3; k++) o += rect(x + 3, y + 3 + k * ((h - 6) / 3), w - 6, 1.2, '#b5b5bb', '', 0.3);
      return { svg: o, anchors: [] };
    }
    let o = rect(x, y, w, h, C.card, C.psuEdge, 0.8);
    o += rect(x + 1, y + 1, w - 2, 2.2, C.nv, '', 0);
    const cw = Math.min(17, (w - 6) / cages - 2), tot = cages * cw + (cages - 1) * 2.5, sx = x + (w - tot) / 2;
    const ch = Math.min(8.4, h - 4), anchors = [];
    for (let k = 0; k < cages; k++) {
      const qx = sx + k * (cw + 2.5), qy = y + h / 2 - ch / 2;
      o += cage(qx, qy, cw, ch);
      anchors.push({ x: qx + cw / 2, y: qy + ch / 2 });
    }
    return { svg: o, anchors };
  }

  // Control panel: power button, then UID and status LEDs.
  function ctrl(x, y, h) {
    let o = circ(x + 4, y + 4.5, 2.4, '#1e1e22') + circ(x + 4, y + 4.5, 1.1, C.green);
    const leds = [C.green, C.amber, '#3f8ae0', '#8e8e95'];
    const step = Math.max(3.2, (h - 12) / leds.length);
    leds.forEach((c, i) => { if (10 + i * step < h - 1) o += circ(x + 4, y + 10.5 + i * step, 1.2, c); });
    return o;
  }

  // Onboard I/O on a server rear: VGA, USB, LAN and the BMC, whose anchor
  // carries the out-of-band cable.
  function ioCluster(x, cy) {
    let o = rect(x, cy - 3.4, 11, 6.2, '#2f5fa8', C.portEdge, 0.8);
    o += rect(x + 13, cy - 4, 6, 3.2, '#2f2f34', C.portEdge, 0.4) + rect(x + 13, cy + 0.9, 6, 3.2, '#2f2f34', C.portEdge, 0.4);
    o += rj45(x + 21, cy - 2.6) + rj45(x + 28, cy - 2.6) + rj45(x + 36.5, cy - 2.6, 6, 5.2, '#1f5f8f');
    return { svg: o, bmc: { x: x + 39.5, y: cy }, end: x + 44 };
  }

  const nvidiaMark = (x, y, size = 5.5, anchor = 'start') => text(x, y, 'NVIDIA', C.nv, size, anchor, 700);
  /* The short name of the adapter a device puts on the north-south fabric.
     The records carry the full description ("BlueField-3 B3240 2-port
     400GbE"); the rear elevation has room for the part, not the sentence, and
     the port count and speed are drawn beside it anyway. */
  const adapterName = (d) => {
    const full = d.dpu || d.northSouth || '';
    const m = full.match(/(BlueField-3\s+\S+|ConnectX-\d\S*)/i);
    return m ? m[1] : (full.split(/\s+[—·]\s+/)[0] || 'North-south adapter').slice(0, 34);
  };

  /* ---------- GPU compute nodes ---------- */
  /* Supermicro 8U / 5U / 4U GPU SuperServer front: the GPU tray's hex-mesh
     intake, split into two framed panels, over a row of 24 2.5" bays of which
     the configured NVMe are populated and the rest blanked, with the control
     panel at the left of the bay row. */
  function hgxFront(w, h, d, uid) {
    // Silver chassis with black perforated panels, as the Supermicro GPU
    // SuperServer front actually presents: a vented top band with the GPU
    // tray's slot cutouts, the large hex-mesh intake below it, and the
    // storage and control row along the bottom.
    let s = rect(0, 0, w, h, '#c6c6cb', '#8a8a90', 2) + ears(w, h, false);
    // Vendor name down each ear, with the status dot the chassis carries.
    [G.EAR / 2, w - G.EAR / 2].forEach((cx) => {
      s += `<text x="${cx.toFixed(1)}" y="${(h * 0.52).toFixed(1)}" fill="#6a6a70" font-size="4.6" font-weight="700"`
        + ` text-anchor="middle" font-family="system-ui,-apple-system,sans-serif"`
        + ` transform="rotate(-90 ${cx.toFixed(1)} ${(h * 0.52).toFixed(1)})">SUPERMICRO</text>`;
      s += circ(cx, h - 5, 1.5, '#c0392b');
    });
    const x0 = G.EAR + 4, x1 = w - G.EAR - 4, iw = x1 - x0;
    const bayH = Math.min(30, h * 0.2), by = h - bayH - 3;
    // Top band: the GPU tray's vent with its row of slot cutouts.
    const topH = Math.max(12, h * 0.15);
    s += rect(x0, 3, iw, topH, '#1e1e21', '#111113', 1.5);
    s += rect(x0 + 2, 5, iw - 4, topH - 4, `url(#hx${uid})`, '', 1);
    const cuts = 8, cw = iw / (cuts * 1.9);
    for (let i = 0; i < cuts; i++) {
      s += rect(x0 + iw * ((i + 0.5) / cuts) - cw / 2, 5.5 + (topH - 4) * 0.2, cw, (topH - 4) * 0.55, '#c6c6cb', '#8a8a90', 0.8);
    }
    // Main intake: one large hex-mesh panel with the tray seam across it.
    const gy = 3 + topH + 2.5, gh = by - gy - 2.5;
    s += rect(x0, gy, iw, gh, '#1e1e21', '#111113', 1.5);
    s += rect(x0 + 2, gy + 2, iw - 4, gh - 4, `url(#hx${uid})`, '', 1);
    if (gh > 26) {
      s += rect(x0 + 2, gy + gh * 0.52, iw - 4, 1.4, '#3a3a40', '', 0.4);
      for (let i = 0; i < 4; i++) {
        s += rect(x0 + iw * (0.18 + i * 0.21), gy + gh - 5.5, iw * 0.06, 3, '#55555c', '', 0.5);
      }
    }
    s += text(x0 + 6, gy + 11, `${d.gpuCount}× ${d.gpuShort}`, '#8c8c94', 7.5, 'start', 700);
    // Storage and control row: the chassis's E1.S bays, then the control panel.
    const bays = d.bays || 8, populated = d.drives == null ? bays : d.drives;
    const cx0 = x0, ctrlW = 14;
    const pitch = (iw - ctrlW - 4) / bays;
    for (let i = 0; i < bays; i++) s += bay25(cx0 + i * pitch, by, pitch - 1.6, bayH, uid, i < populated);
    s += ctrl(x1 - ctrlW + 2, by + 1, bayH - 2);
    return s;
  }

  /* Supermicro GPU SuperServer rear: eight low-profile NIC slots across the
     top (one SuperNIC per GPU pair, or a single dual-port DPU with the rest
     blanked), the fan wall across the middle, and along the bottom the CPU
     tray's I/O and BlueField-3 DPU beside the PSU bank. */
  function gpuRear(w, h, d, uid) {
    let s = rect(0, 0, w, h, `url(#rg${uid})`, C.rEdge, 2) + ears(w, h, false);
    const x0 = G.EAR + 4, x1 = w - G.EAR - 4, iw = x1 - x0;
    const anchors = [];
    const topH = Math.min(24, h * 0.2), fanH = Math.min(46, h * 0.34);
    // One low-profile card per port when the node carries single-port
    // SuperNICs (eight ConnectX-8 or B3140H, or the RTX PRO RA's four), one
    // multi-port card when it carries a dual-port DPU for east-west.
    const ew = d.ewPorts || 8, cards = ew >= 4 ? Math.min(8, ew) : 1, perCard = ew >= 4 ? 1 : ew;
    const slots = 8, sw = (iw - (slots - 1) * 3) / slots;
    for (let i = 0; i < slots; i++) {
      const b = bracket(x0 + i * (sw + 3), 3.5, sw, topH, i < cards ? perCard : 0);
      s += b.svg; b.anchors.forEach((a) => anchors.push({ ...a, fabric: 'ew' }));
    }
    const fy = 3.5 + topH + 9;
    s += text(x0 + 1, fy - 2.5, `${ew}× ${d.ewGb || 800}G east-west`, '#5a5a60', 6, 'start', 500);
    // The fan wall fills the band between the NIC slots and the I/O row; the
    // I/O and PSU band below it is a fixed height whatever the chassis is.
    const fn = h > 100 ? 10 : 8, fw = (iw - (fn - 1) * 3) / fn;
    const ioH = Math.min(h - fy - 10, G.U * 2.6);
    const fs = Math.max(fw, h - 3.5 - ioH - fy - 5);
    for (let i = 0; i < fn; i++) s += fan(x0 + i * (fw + 3), fy, fw, fs);
    const by = fy + fs + 5, bh = h - by - 3.5;
    const cy = by + Math.min(bh / 2, G.U * 0.55);
    const io = ioCluster(x0 + 2, cy);
    s += io.svg; anchors.push({ ...io.bmc, fabric: 'oob' });
    const ns = d.nsPorts || 2, dpuW = 22 * ns + 14;
    const dpu = bracket(io.end + 6, by, dpuW, Math.min(bh, G.U * 1.15), ns);
    s += dpu.svg; dpu.anchors.forEach((a) => anchors.push({ ...a, fabric: 'ns' }));
    if (bh > 26) s += text(x0 + 2, by + bh - 2, `BMC · ${ns}× ${d.nsGb || 400}G north-south`, '#5a5a60', 6, 'start');
    // The PSU bank: a module is about 1U tall whatever the chassis is, so on a
    // tall rear it sits as a band along the bottom rather than stretching.
    const pn = d.psuCount || 6;
    const px0 = io.end + 6 + dpuW + 8, avail = x1 - px0;
    const ph = Math.min(G.U * 1.15, bh);
    const rows = bh >= ph * 2 + 3 && pn > 3 ? 2 : 1, cols = Math.ceil(pn / rows);
    const pw = (avail - (cols - 1) * 3) / cols;
    const pTop = h - 3.5 - (rows * ph + (rows - 1) * 2.5);
    for (let i = 0; i < pn; i++) {
      s += psu(px0 + (i % cols) * (pw + 3), pTop + Math.floor(i / cols) * (ph + 2.5), pw, ph, uid);
    }
    return { svg: s, anchors };
  }

  /* DGX B300 front, per RA-11337-001 Figure 2.1: a black chassis dominated by a
     single large gold intake panel with a lighter bezel, the NVIDIA wordmark
     low and centred, over a dark I/O band of module slots. The panel carries
     the lattice mesh of the DGX bezel rather than a flat fill. */
  function dgxFront(w, h, d, uid) {
    let s = rect(0, 0, w, h, '#1b1b1e', '#0c0c0e', 2);
    s += rect(0, 0, G.EAR, h, '#232326', '#0c0c0e') + rect(w - G.EAR, 0, G.EAR, h, '#232326', '#0c0c0e');
    [4, h - 4].forEach((cy) => { s += circ(G.EAR / 2, cy, 1.6, '#3a3a40') + circ(w - G.EAR / 2, cy, 1.6, '#3a3a40'); });
    const x0 = G.EAR + 7, x1 = w - G.EAR - 7, iw = x1 - x0;
    const gy = 4, gh = h * 0.72;
    s += rect(x0, gy, iw, gh, C.dgxBezel, '#6f5f38', 3);
    s += rect(x0 + 2.5, gy + 2.5, iw - 5, gh - 5, `url(#gold${uid})`, '#7a6740', 2);
    s += rect(x0 + 2.5, gy + 2.5, iw - 5, gh - 5, `url(#lat${uid})`, '', 2);
    const ly0 = gy + gh - 9, cx = x0 + iw / 2;
    s += `<ellipse cx="${(cx - 17).toFixed(1)}" cy="${ly0.toFixed(1)}" rx="4.5" ry="3" fill="none" stroke="#4a3f22" stroke-width="1.1"/>`;
    s += circ(cx - 17, ly0, 1.2, '#4a3f22');
    s += text(cx + 3, ly0 + 2.6, 'NVIDIA', '#4a3f22', 7.5, 'middle', 700);
    const by = gy + gh + 3, bh = h - by - 4;
    s += rect(x0, by, iw, bh, '#131315', '#08080a', 1.5);
    s += circ(x0 + 5, by + bh / 2, 1.4, C.green);
    const slots = 10, sp = (iw - 26) / slots;
    for (let i = 0; i < slots; i++) s += rect(x0 + 11 + i * sp, by + 1.8, sp - 1.6, bh - 3.6, '#2b2b30', '#101012', 0.5);
    return s + rect(x1 - 12, by + 1.8, 10, bh - 3.6, '#2b2b30', '#101012', 0.5);
  }

  /* DGX B300 rear, per Figure 4.1: four compute OSFP at each top corner with
     the BMC, LAN and USB between them; a BlueField-3 DPU (in-band plus
     storage QSFP) at each side of the next row with the PCIe slot covers
     between; the fan modules across the middle; and the PSU bank in two rows
     along the bottom. */
  function dgxRear(w, h, d, uid) {
    let s = rect(0, 0, w, h, '#17171a', '#08080a', 2);
    s += rect(0, 0, G.EAR, h, '#232326', '#0c0c0e') + rect(w - G.EAR, 0, G.EAR, h, '#232326', '#0c0c0e');
    const x0 = G.EAR + 6, x1 = w - G.EAR - 6, iw = x1 - x0;
    const anchors = [];
    const cageW = 15, gap = 2.5, groupW = 4 * cageW + 3 * gap;
    [x0 + 2, x1 - groupW - 2].forEach((gx) => {
      s += rect(gx - 2, 2.5, groupW + 4, 12, '#0f0f11', '#2e6b2e', 1);
      for (let i = 0; i < 4; i++) {
        const qx = gx + i * (cageW + gap);
        s += cage(qx, 4, cageW, 9);
        anchors.push({ x: qx + cageW / 2, y: 8.5, fabric: 'ew' });
      }
    });
    const mx = x0 + iw / 2 - 30;
    s += rj45(mx, 5.5, 7, 6, '#1f5f8f') + rj45(mx + 9, 5.5, 7, 6) + rect(mx + 18, 6, 6, 3.4, '#2f2f34', C.portEdge, 0.4) + rect(mx + 18, 10, 6, 3.4, '#2f2f34', C.portEdge, 0.4);
    anchors.push({ x: mx + 3.5, y: 8.5, fabric: 'oob' });
    [0, 1, 2].forEach((i) => s += circ(mx + 30 + i * 5, 8.5, 1.3, i === 0 ? C.green : '#8d8d94'));
    s += text(mx + 45, 10.5, 'BMC · LAN', '#6d6d75', 5.5, 'start');
    // DPUs and slot covers.
    const ry = 20, rh = 22, dpuW = 58;
    [x0 + 2, x1 - dpuW - 2].forEach((dx) => {
      const b = bracket(dx, ry, dpuW, rh, 2);
      s += b.svg;
      b.anchors.forEach((a, q) => anchors.push({ ...a, fabric: q === 0 ? 'ib' : 'ns' }));
    });
    const cx0 = x0 + dpuW + 8, cx1 = x1 - dpuW - 8, cn = 6, cw = (cx1 - cx0 - (cn - 1) * 3) / cn;
    for (let i = 0; i < cn; i++) s += bracket(cx0 + i * (cw + 3), ry, cw, rh, 0).svg;
    // Fan wall, then the PSU bank as a band along the bottom: a 3.3 kW supply
    // is a fixed-size module, so it keeps its proportions on a 10U rear.
    const pn = d.psuCount || 12, rows = 2, cols = Math.ceil(pn / rows);
    const ph = Math.min(G.U * 1.15, (h - ry - rh - 20) / rows);
    const py0 = h - 4 - (rows * ph + (rows - 1) * 2.5);
    const fy = ry + rh + 6, fn = 8, fw = (iw - (fn - 1) * 3) / fn;
    const fs = Math.max(fw, py0 - fy - 6);
    for (let i = 0; i < fn; i++) s += fan(x0 + i * (fw + 3), fy, fw, fs, '#2a2a2e');
    const pw = (iw - (cols - 1) * 3) / cols;
    for (let i = 0; i < pn; i++) s += psu(x0 + (i % cols) * (pw + 3), py0 + Math.floor(i / cols) * (ph + 2.5), pw, ph, uid, '#3bb54a');
    s += text(x1 - 2, h - 5.5, 'DGX B300', '#6d6d75', 6.5, 'end', 600);
    return { svg: s, anchors };
  }

  /* DGX power shelf, per Figure 2.2: six 5.5 kW supplies (33 kW) with a power
     management board carrying the BMC port at the far left. */
  function powerShelf(w, h, d, uid) {
    let s = rect(0, 0, w, h, '#1b1b1e', '#0c0c0e', 1.5);
    s += rect(0, 0, G.EAR, h, '#232326', '#0c0c0e') + rect(w - G.EAR, 0, G.EAR, h, '#232326', '#0c0c0e');
    const x0 = G.EAR + 5, x1 = w - G.EAR - 5;
    s += rect(x0, 3, 26, h - 6, '#2b2b30', '#101012', 1);
    s += rj45(x0 + 4, h / 2 - 2.8, 7, 5.6, '#1f5f8f');
    s += circ(x0 + 20, h / 2 - 2, 1.2, C.green) + circ(x0 + 20, h / 2 + 2, 1.2, '#c03a3a');
    const n = d.psuCount || 6, px0 = x0 + 30, pw = (x1 - px0) / n;
    for (let i = 0; i < n; i++) s += psu(px0 + i * pw, 3, pw - 2, h - 6, uid, '#3bb54a');
    return { svg: s, anchors: [{ x: x0 + 7.5, y: h / 2, fabric: 'oob' }] };
  }

  /* ---------- GB300 NVL72 trays ---------- */
  /* Compute tray front (Supermicro ARS-121GL-NB3-LC / DGX GB300 tray). Every
     port is on the front: the rear of an NVL72 tray is the busbar clip, the
     coolant quick-disconnects and the blind-mate NVLink cartridge connectors.
     Left to right: control panel, the E1.S bank (eight bays, four populated),
     the four OSFP cages of the ConnectX-8 SuperNICs, the BlueField-3's two
     QSFP112 cages with its BMC jack, then the tray BMC, console and USB. */
  function trayFront(w, h, d, uid) {
    let s = rect(0, 0, w, h, '#1d1d20', '#0c0c0e', 1.5) + ears(w, h, true);
    const x0 = G.EAR + 4, x1 = w - G.EAR - 4;
    const anchors = [];
    s += ctrl(x0, 2, h - 4);
    const bays = d.bays || 8, drives = d.drives || 4, bw = 11, bx0 = x0 + 12;
    for (let i = 0; i < bays; i++) s += bay25(bx0 + i * (bw + 1.5), 2.5, bw, h - 5, uid, i < drives, d.driveType || '');
    let x = bx0 + bays * (bw + 1.5) + 6;
    s += text(x, h / 2 + 2.4, `${d.gpuCount || 4}× ${d.gpuShort || 'B300'} · ${d.cpus || 2}× Grace`, '#a3a3ac', 6, 'start', 600);
    x += 92;
    const ew = d.ewPorts || 4, cw = 17, chh = h - 6;
    s += rect(x - 2, 2, ew * (cw + 2) + 2, h - 4, '#0f0f11', '#2e6b2e', 1);
    for (let i = 0; i < ew; i++) {
      const qx = x + i * (cw + 2);
      s += cage(qx, 3, cw, chh);
      anchors.push({ x: qx + cw / 2, y: 3 + chh / 2, fabric: 'ew' });
    }
    x += ew * (cw + 2) + 8;
    const ns = d.nsPorts || 2, qw = 14;
    s += rect(x - 2, 2, ns * (qw + 2) + 12, h - 4, '#0f0f11', '#3b5f8f', 1);
    for (let i = 0; i < ns; i++) {
      const qx = x + i * (qw + 2);
      s += cage(qx, 3, qw, chh);
      anchors.push({ x: qx + qw / 2, y: 3 + chh / 2, fabric: 'ns' });
    }
    x += ns * (qw + 2);
    s += rj45(x, h / 2 - 2.8, 6.5, 5.6, '#1f5f8f');   // DPU BMC
    x += 16;
    s += rj45(x, h / 2 - 2.8, 6.5, 5.6, '#1f5f8f');   // tray BMC
    anchors.push({ x: x + 3.25, y: h / 2, fabric: 'oob' });
    s += rj45(x + 8, h / 2 - 2.8, 6.5, 5.6, '#4a4a52');
    s += rect(x + 16.5, h / 2 - 2.2, 5, 4.4, '#2f2f34', C.portEdge, 0.4);
    s += text(x + 26, h / 2 + 2.2, `${ew}× ${d.ewGb || 800}G · ${ns}× ${d.nsGb || 400}G`, '#5f5f66', 5, 'start');
    s += nvidiaMark(x1 - 30, h / 2 + 2.2, 5.5);
    return { svg: s, anchors };
  }

  /* NVLink switch tray front: the NVLink ports are all on the rear cartridge,
     so the face carries only the intake, the two NVSwitch badges and the
     management and console jacks. */
  function nvswitchFront(w, h, d, uid) {
    let s = rect(0, 0, w, h, '#1d1d20', '#0c0c0e', 1.5) + ears(w, h, true);
    const x0 = G.EAR + 4, x1 = w - G.EAR - 4;
    const anchors = [];
    s += ctrl(x0, 2, h - 4);
    s += rect(x0 + 12, 2.5, 170, h - 5, `url(#hc${uid})`, '#33333a', 1);
    const bx = x0 + 190, n = d.nvswitch || 2;
    for (let i = 0; i < n; i++) {
      s += rect(bx + i * 52, 3.5, 48, h - 7, '#123d22', '#1f6b3a', 1);
      s += text(bx + i * 52 + 24, h / 2 + 2.2, `NVSwitch ${i + 1}`, C.nv, 5.5, 'middle', 700);
    }
    s += text(bx + n * 52 + 8, h / 2 + 2.2, 'NVLink 5 · 144 ports', '#8a8a92', 5.5, 'start', 600);
    const mx = x1 - 60;
    s += rj45(mx, h / 2 - 2.8, 6.5, 5.6, '#1f5f8f');
    anchors.push({ x: mx + 3.25, y: h / 2, fabric: 'oob' });
    s += rj45(mx + 8, h / 2 - 2.8, 6.5, 5.6, '#4a4a52');
    s += nvidiaMark(x1 - 30, h / 2 + 2.2, 5.5);
    return { svg: s, anchors };
  }

  /* Floor-standing CDU cabinet (in-row liquid-to-liquid, or liquid-to-air
     sidecar), drawn at rack height because it takes a rack position on the
     floor: a door with the controller display up top, the heat-exchanger
     grille (fan wall on the sidecar) and the supply/return couplings low. */
  function cabinetFace(w, h, d, uid, rear) {
    let s = rect(0, 0, w, h, '#2c2c30', '#141416', 3);
    const x0 = 10, x1 = w - 10, iw = x1 - x0;
    const anchors = [];
    s += rect(x0, 10, iw, h - 20, '#232326', '#0f0f11', 2);
    const cap = d.capacityKw >= 1000 ? `${d.capacityKw / 1000} MW` : `${d.capacityKw} kW`;
    if (!rear) {
      s += rect(x0 + 16, 24, 176, 50, '#101012', '#3a3a40', 2);
      s += rect(x0 + 20, 28, 168, 42, '#0e3a3f', '', 1);
      s += text(x0 + 26, 41, clip(d.name, 30), '#7fd3d8', 7.5, 'start', 700);
      s += text(x0 + 26, 52, `${cap} cooling · ${(d.watts || 0) / 1000} kW draw`, '#5fb3b8', 5.5, 'start');
      s += text(x0 + 26, 62, d.l2a ? 'liquid-to-air · no facility water' : 'liquid-to-liquid · N+1 pumps', '#5fb3b8', 5.5, 'start');
      [C.green, C.green, C.amber].forEach((c, i) => s += circ(x0 + 204, 32 + i * 8, 1.6, c));
    }
    const gy = 90, gh = h - 90 - 110;
    if (d.l2a) {
      // Sidecar: a wall of fans pushes the heat into the room.
      const cols = 3, rows = Math.max(3, Math.floor(gh / 95));
      const fs = Math.min((iw - 24 - (cols - 1) * 8) / cols, (gh - (rows - 1) * 8) / rows);
      const fx0 = x0 + (iw - (cols * fs + (cols - 1) * 8)) / 2, fy0 = gy + (gh - (rows * fs + (rows - 1) * 8)) / 2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) s += fan(fx0 + c * (fs + 8), fy0 + r * (fs + 8), fs, '#2a2a2e');
    } else {
      s += rect(x0 + 12, gy, iw - 24, gh, `url(#${rear ? 'pf' : 'pd'}${uid})`, '#2a2a2e', 1);
    }
    [0, 1].forEach((i) => {
      const cx = x0 + iw / 2 - 60 + i * 120, cy = h - 62;
      s += circ(cx, cy, 20, '#5a5a62') + circ(cx, cy, 15, '#2a2a2e') + circ(cx, cy, 9, i ? '#2f5fa8' : '#b0316f');
      s += text(cx, cy + 32, i ? 'RETURN' : 'SUPPLY', '#8e8e95', 6, 'middle', 600);
    });
    if (rear) {
      s += psu(x1 - 90, h - 46, 70, 22, uid) + psu(x1 - 90, h - 22, 70, 12, uid);
      const io = ioCluster(x0 + 20, h - 30);
      s += io.svg; anchors.push({ ...io.bmc, fabric: 'oob' });
    } else if (d.floorMM) {
      s += text(x0 + iw / 2, h - 18, `footprint ${d.floorMM}`, '#6d6d75', 6, 'middle');
    }
    return { svg: s, anchors };
  }

  /* ---------- storage, fabric, platform ---------- */
  /* WEKApod: a Supermicro 1U (Nitro, Prime 2118) or 2U (Prime 2218) NVMe
     server in a dark chassis with the WEKA badge — E3.S blades stand in a
     row across a 1U face, U.2 carriers fill two rows of a 2U face. */
  function wekapodFront(w, h, d, uid) {
    let s = rect(0, 0, w, h, `url(#fg${uid})`, C.fEdge, 2) + ears(w, h, true);
    const x0 = G.EAR + 5, x1 = w - G.EAR - 5;
    const twoU = h > G.U * 1.5, e3 = /E3/i.test(d.driveType || 'E3.S');
    const drives = d.drives || 14;
    const rows = twoU ? 2 : 1;
    const slots = twoU ? 24 : e3 ? Math.max(16, drives) : Math.max(12, drives);
    const per = Math.ceil(slots / rows);
    const badgeW = 34;
    const bx0 = x0 + 2, bx1 = x1 - badgeW - 14;
    const pitch = (bx1 - bx0) / per, bh = (h - 7 - (rows - 1) * 1.2) / rows;
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < per && k < slots; c++, k++) {
        s += bay25(bx0 + c * pitch, 3.5 + r * (bh + 1.2), pitch - 1.3, bh, uid, k < drives);
      }
    }
    s += ctrl(bx1 + 2, 3.5, h - 7);
    s += rect(x1 - badgeW, h / 2 - 5, badgeW, 10, '#5b3d85', '#3f2a5e', 2);
    s += text(x1 - badgeW / 2, h / 2 + 2.6, 'WEKA', '#f1ebfa', 7, 'middle', 700);
    return s;
  }

  /* WEKApod rear: two PSUs, the onboard I/O with its BMC, the ConnectX-7
     card carrying the pair of data cages, and a blank slot. */
  function wekapodRear(w, h, d, uid) {
    let s = rect(0, 0, w, h, `url(#rg${uid})`, C.rEdge, 2) + ears(w, h, false);
    const x0 = G.EAR + 4, x1 = w - G.EAR - 4;
    const anchors = [];
    const twoU = h > G.U * 1.5, pw = 54;
    if (twoU) { s += psu(x0, 3.5, pw, (h - 8) / 2, uid) + psu(x0, 3.5 + (h - 8) / 2 + 1, pw, (h - 8) / 2, uid); }
    else { s += psu(x0, 3.5, pw, h - 7, uid) + psu(x0 + pw + 2, 3.5, pw, h - 7, uid); }
    const ix = x0 + (twoU ? pw : pw * 2) + 8, cy = 3.5 + Math.min((h - 7) / 2, 9);
    const io = ioCluster(ix, cy);
    s += io.svg; anchors.push({ ...io.bmc, fabric: 'oob' });
    const n = d.ports || 2, cardW = 22 * n + 14, cx = io.end + 8;
    const card = bracket(cx, 3.5, cardW, Math.min(h - 7, 22), n);
    s += card.svg; card.anchors.forEach((a) => anchors.push({ ...a, fabric: 'ns' }));
    s += text(cx + cardW + 4, cy + 2.4, `${n}× ${d.portGb || 400}G`, '#5a5a60', 6, 'start', 500);
    const sx = cx + cardW + 34, sw = Math.min(60, x1 - sx - 40);
    if (sw > 20) s += bracket(sx, 3.5, sw, Math.min(h - 7, 22), 0).svg;
    s += rect(x1 - 36, 3.5, 36, h - 7, `url(#pf${uid})`, '#9a9aa1', 0.8);
    return { svg: s, anchors };
  }

  /* NVIDIA switch. The port side faces the rear of the rack, so the front
     shows the fan and PSU side. Spectrum and Quantum share the same dark
     chassis: a management block at the left, then the cages in groups of
     four — two rows above 16 ports — or, on the SN2201, 48 RJ45 in two rows
     of four groups of six with the QSFP28 uplinks at the right. */
  /* Switch faces, drawn to the Spectrum stencils: the port field with its
     "1/2 ▲▼ 3/4" numbering, the status icon column at the left edge, and the
     management jacks, model name and vendor mark at the right. The rear is
     the PSU-and-fan side, since the RA mounts these port-side-to-rear.

     `rear` here means the side of the rack being drawn, not the side of the
     switch: on the rear elevation we see the switch's port side, which is
     where the cabling lands, so that is where the anchors are. */
  function switchFace(w, h, d, uid, rear) {
    // The port side of a Spectrum switch is a charcoal faceplate; the PSU and
    // fan side behind it is the light chassis.
    const body = rear ? '#4c4d52' : '#c4c4c9', edge = rear ? '#2a2a2e' : '#8a8a90';
    const x0 = G.EAR + 4, x1 = w - G.EAR - 4;

    // Front of the rack: the PSU and fan side.
    if (!rear) {
      let s = rect(0, 0, w, h, body, edge, 2) + ears(w, h, false);
      const pw = Math.min(70, (x1 - x0) * 0.18);
      s += psu(x0 + 2, 3, pw, h - 6, uid) + psu(x1 - pw - 2, 3, pw, h - 6, uid);
      const fn = h > G.U * 1.5 ? 3 : 4, fa = x0 + pw + 7, fb = x1 - pw - 7;
      const gap = 4, fw = (fb - fa - (fn - 1) * gap) / fn, fh = h - 7;
      for (let i = 0; i < fn; i++) s += fan(fa + i * (fw + gap), 3.5, fw, fh, C.psu, uid, String(i + 1));
      return { svg: s, anchors: [] };
    }

    // Port side.
    let s = rect(0, 0, w, h, body, edge, 2) + ears(w, h, false);
    const anchors = [];
    const gb = d.portGb || 400;
    const isOob = gb <= 10;

    // Status icon column, then the port field, then management and branding.
    s += statusCluster(x0 + 1.5, 4, h - 8);
    const px0 = x0 + 12;
    // Right-hand block: management RJ45 and USB above, console below, with the
    // model name and the NVIDIA mark beneath them.
    const rightW = h > 30 ? 46 : 38;
    const rx = x1 - rightW;
    s += rj45(rx + 2, 3.5, 7, 5.6, '#cdd8e6');
    s += rect(rx + 11, 4, 5.4, 4.6, '#2f2f34', C.portEdge, 0.4);
    s += rj45(rx + 2, h - 9.5, 7, 5.6, '#d7d7db');
    if (h > 26) {
      s += text(rx + 11, h - 5.5, 'IOIOI', '#e4e4e7', 3.8, 'start', 500);
      s += text(x1 - 1, 13.5, d.model || (d.detail || '').replace(/^NVIDIA /, ''), '#f0f0f2', 4.6, 'end', 700);
      s += nvidiaMark(x1 - 1, h - 12, 5.2, 'end');
    } else {
      s += nvidiaMark(x1 - 1, h - 3, 4, 'end');
    }

    const field = rx - px0 - 4;
    if (isOob) {
      // 48 RJ45 in two rows of three blocks of eight, then the QSFP uplinks —
      // the SN2201 faceplate exactly.
      const up = d.uplinks || 4;
      const ucw = Math.min(13, field * 0.07), upW = up * (ucw + 1.6);
      const per = Math.ceil((d.ports || 48) / 2), blocks = Math.ceil(per / 8);
      const avail = field - upW - 6;
      const jw = (avail - (blocks - 1) * 4) / per - 1.1;
      const jh = Math.min(7, (h - 11) / 2);
      const top = (h - (jh * 2 + 3.4)) / 2;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < per; c++) {
          const jx = px0 + c * (jw + 1.1) + Math.floor(c / 8) * 4, jy = top + r * (jh + 1);
          s += rj45(jx, jy, jw, jh);
          anchors.push({ x: jx + jw / 2, y: jy + jh / 2 });
        }
      }
      // Numbering under each column: the odd port above, the even one below.
      if (h > 26 && jw > 3) {
        for (let c = 0; c < per; c += 2) {
          const jx = px0 + c * (jw + 1.1) + Math.floor(c / 8) * 4;
          s += text(jx + jw + 0.5, top + jh * 2 + 6, `${c * 2 + 1}▲▼${c * 2 + 2}`, '#d2d2d7', 4.2, 'middle', 500);
        }
      }
      const ux = x1 - rightW - upW - 2;
      for (let u = 0; u < up; u++) {
        const qx = ux + u * (ucw + 1.6);
        s += cage(qx, top, ucw, jh * 2 + 1);
        anchors.push({ x: qx + ucw / 2, y: top + jh });
      }
      if (h > 26) s += text(ux + upW / 2, top + jh * 2 + 6, `${(d.ports || 48) + 1}–${(d.ports || 48) + up}`, '#d2d2d7', 4.2, 'middle', 500);
      return { svg: s, anchors };
    }

    // Data-plane switch: stacked cage pairs, numbered in fours.
    const total = d.ports || 64;
    const pairs = Math.ceil(total / 2);
    const groups = Math.max(1, Math.ceil(pairs / 2));
    const gapX = 2.6;
    const cw = (field - (groups - 1) * gapX) / pairs - 1;
    const ch = Math.min(h - 12, h * 0.66);
    const top = (h - ch) / 2 - (h > 26 ? 2 : 0);
    // A label spans four ports and needs about 30 px; where the groups are
    // tighter than that, every other group is labelled instead of crowding.
    const labelEvery = cw * 2 + gapX >= 30 ? 1 : 2;
    let k = 0;
    for (let g = 0; g < groups; g++) {
      for (let i = 0; i < 2 && k < pairs; i++, k++) {
        const qx = px0 + k * (cw + 1) + g * gapX;
        const label = h > 26 && i === 1 && g % labelEvery === 0
          ? `${k * 2 - 1}/${k * 2} ▲▼ ${k * 2 + 1}/${k * 2 + 2}` : '';
        const p = cagePair(qx, top, cw, ch, '');
        s += p.svg;
        p.anchors.forEach((a) => anchors.push(a));
        if (label) s += text(qx, top + ch + 5.4, label, '#d2d2d7', 4.1, 'middle', 500);
      }
    }
    return { svg: s, anchors };
  }

  /* Platform, storage and site devices, keyed by the face the layout tags
     them with: the 12-bay Hyper server, the 36-bay LFF chassis, the Synology
     NAS, the port-fronted appliances (firewall, console server), the CDU, the
     break-glass DIN shelf, and the patch panel and media converter. */
  function genericFace(w, h, d, uid, rear) {
    if (rear) return genericRear(w, h, d, uid);
    let s = rect(0, 0, w, h, `url(#fg${uid})`, C.fEdge, 2) + ears(w, h, true);
    const x0 = G.EAR + 5, x1 = w - G.EAR - 5, iw = x1 - x0;
    const face = d.face || (d.type === 'panel' ? 'patch' : 'server');

    if (face === 'lff') {
      const cols = 6, rows = 4, bays = d.frontBays || 24;
      const cw = (iw - 12 - (cols - 1) * 1.5) / cols, ch = (h - 7 - (rows - 1) * 1.5) / rows;
      s += ctrl(x0 + 1, 4, h - 8);
      for (let i = 0; i < bays; i++) s += bay35(x0 + 12 + (i % cols) * (cw + 1.5), 3.5 + Math.floor(i / cols) * (ch + 1.5), cw, ch, uid);
      return { svg: s, anchors: [] };
    }
    if (face === 'nas') {
      const n = d.drives || 4, cw = Math.min(70, (iw - 30) / n - 2), ch = h - 7;
      s += ctrl(x0 + 1, 4, h - 8);
      for (let i = 0; i < n; i++) s += bay35(x0 + 14 + i * (cw + 2), 3.5, cw, ch, uid);
      s += rect(x0 + 14 + n * (cw + 2) + 4, 3.5, Math.max(0, x1 - (x0 + 18 + n * (cw + 2))), h - 7, `url(#pd${uid})`, '#2a2a2e', 0.8);
      return { svg: s, anchors: [] };
    }
    if (face === 'ports') {
      // Console and management at the left, then the RJ45 bank in two rows of
      // groups of six, then the SFP cages in two rows.
      s += rj45(x0 + 2, h / 2 - 2.8, 6.5, 5.6, '#4a4a52') + rect(x0 + 10, h / 2 - 2.2, 5, 4.4, '#2f2f34', C.portEdge, 0.4);
      [0, 1, 2].forEach((i) => s += circ(x0 + 19, 5 + i * 3.3, 1.1, i === 0 ? C.green : '#8d8d94'));
      const n = d.rj45 || 12, per = Math.ceil(n / 2), groups = Math.ceil(per / 6);
      const jw = Math.min(9, (iw * 0.62 - (groups - 1) * 4) / per - 1.2), jh = (h - 7.5) / 2;
      const jx0 = x0 + 26;
      for (let i = 0; i < n; i++) {
        const c = i % per, r = Math.floor(i / per);
        s += rj45(jx0 + c * (jw + 1.2) + Math.floor(c / 6) * 4, 3.5 + r * (jh + 0.8), jw, jh);
      }
      const sx = jx0 + per * (jw + 1.2) + (groups - 1) * 4 + 8, sfp = d.sfp || 0;
      for (let i = 0; i < sfp; i++) {
        const c = i % Math.ceil(sfp / 2), r = Math.floor(i / Math.ceil(sfp / 2));
        const cx = sx + c * 12.5;
        if (cx + 11 > x1) break;
        s += cage(cx, 3.5 + r * (jh + 0.8), 11, jh);
      }
      return { svg: s, anchors: [] };
    }
    if (face === 'cdu') {
      // Touch display and status LEDs at the left, the coolant couplings at
      // the right, perforated intake between.
      s += rect(x0 + 4, 6, 70, h - 12, '#101012', '#3a3a40', 2);
      s += rect(x0 + 8, 10, 62, h - 20, '#0e3a3f', '', 1);
      s += text(x0 + 12, 22, 'CDU 250 kW', '#7fd3d8', 6.5, 'start', 600);
      s += text(x0 + 12, 32, 'supply 25 °C  ·  return 35 °C', '#5fb3b8', 5, 'start');
      [C.green, C.green, C.amber].forEach((c, i) => s += circ(x0 + 80, 10 + i * 6, 1.4, c));
      s += rect(x0 + 88, 3.5, iw - 88 - 70, h - 7, `url(#pd${uid})`, '#2a2a2e', 0.8);
      [0, 1].forEach((i) => {
        const cx = x1 - 50 + i * 30, cy = h / 2;
        s += circ(cx, cy, 11, '#5a5a62') + circ(cx, cy, 8, '#2a2a2e') + circ(cx, cy, 5, i ? '#2f5fa8' : '#b0316f');
        s += text(cx, h - 5, i ? 'RETURN' : 'SUPPLY', '#8e8e95', 4.5, 'middle', 600);
      });
      return { svg: s, anchors: [] };
    }
    if (face === 'shelf') {
      // A rack shelf carrying DIN-rail modules: the RevPi, its I/O module and
      // the SITOP supply, with the cable tray beneath.
      s += rect(x0, 3.5, iw, h - 7, '#4b4b50', '#2a2a2e', 1);
      s += rect(x0 + 4, 8, iw - 8, 3, '#8e8e95', '', 0.5);   // DIN rail
      const mods = [['#c8102e', 40, 'RevPi'], ['#9a9aa1', 24, 'DIO'], ['#9a9aa1', 24, 'DIO'], ['#2f7d3c', 46, 'SITOP']];
      let mx = x0 + 10;
      mods.forEach(([col, mw, label]) => {
        s += rect(mx, 6, mw, h * 0.55, col, '#1a1a1d', 1);
        s += text(mx + mw / 2, 6 + h * 0.55 - 4, label, '#f4f4f6', 5, 'middle', 700);
        [0, 1, 2].forEach((k) => s += circ(mx + 4 + k * 4, 10, 1, C.green));
        mx += mw + 6;
      });
      s += rect(x0 + 6, h * 0.55 + 12, iw - 12, h - h * 0.55 - 16, '#3a3a3f', '#2a2a2e', 0.8);
      return { svg: s, anchors: [] };
    }
    if (face === 'patch') {
      // 24 duplex LC couplers in four groups of six, with a label strip.
      const n = 24, groups = 4, pw = (iw - 10 - (groups - 1) * 6) / n;
      for (let i = 0; i < n; i++) {
        const px = x0 + 5 + i * pw + Math.floor(i / 6) * 6;
        s += rect(px, 4, pw - 1.2, h - 11, '#3b6ea5', '#1f3d5c', 0.6);
        s += rect(px + 1, 5.5, (pw - 1.2) / 2 - 1, h - 14, '#152b45', '', 0.3) + rect(px + (pw - 1.2) / 2 + 0.5, 5.5, (pw - 1.2) / 2 - 1, h - 14, '#152b45', '', 0.3);
      }
      s += rect(x0 + 5, h - 6, iw - 10, 3, '#e8e8ea', '#9a9aa1', 0.4);
      return { svg: s, anchors: [] };
    }
    if (face === 'converter') {
      for (let i = 0; i < 4; i++) s += cage(x0 + 4 + i * 13, h / 2 - 3.5, 11, 7);
      for (let i = 0; i < 4; i++) s += rj45(x0 + 60 + i * 8, h / 2 - 2.8, 6.5, 5.6);
      [0, 1, 2].forEach((i) => s += circ(x0 + 98 + i * 4, h / 2, 1, C.green));
      s += rect(x0 + 110, 3.5, iw - 110, h - 7, `url(#pd${uid})`, '#2a2a2e', 0.8);
      return { svg: s, anchors: [] };
    }
    // Hyper 1U/2U server: a full-width bay row, populated to the configured
    // count, with the control panel at the right.
    const slots = d.bays || 12, drives = d.drives || 0;
    const pitch = (iw - 14) / slots;
    for (let i = 0; i < slots; i++) s += bay25(x0 + i * pitch, 3.5, pitch - 1.3, h - 7, uid, i < drives, 'NVMe');
    s += ctrl(x1 - 9, 3.5, h - 7);
    return { svg: s, anchors: [] };
  }

  function genericRear(w, h, d, uid) {
    let s = rect(0, 0, w, h, `url(#rg${uid})`, C.rEdge, 2) + ears(w, h, false);
    const x0 = G.EAR + 4, x1 = w - G.EAR - 4, iw = x1 - x0;
    const anchors = [];
    const face = d.face || (d.type === 'panel' ? 'patch' : 'server');
    const twoU = h > G.U * 1.5;
    const bmcAt = (x, cy) => { const io = ioCluster(x, cy); s += io.svg; anchors.push({ ...io.bmc, fabric: 'oob' }); return io.end; };

    if (face === 'patch' || face === 'converter') {
      s += rect(x0, 3.5, iw, h - 7, `url(#pf${uid})`, '#9a9aa1', 0.8);
      return { svg: s, anchors: [] };
    }
    if (face === 'shelf') {
      s += rect(x0, 3.5, iw, h - 7, `url(#pf${uid})`, '#9a9aa1', 0.8);
      s += rect(x0 + 6, h / 2 - 5, 30, 10, C.psu, C.psuEdge, 1) + rect(x0 + 10, h / 2 - 3, 9, 6, C.port, C.portEdge, 0.8);
      return { svg: s, anchors: [] };
    }
    if (face === 'lff') {
      // Twelve rear LFF bays on the left, PSUs, I/O and slots on the right.
      const cols = 4, rows = 3, bays = d.rearBays || 12, zone = iw * 0.55;
      const cw = (zone - (cols - 1) * 1.5) / cols, ch = (h - 7 - (rows - 1) * 1.5) / rows;
      for (let i = 0; i < bays; i++) s += bay35(x0 + (i % cols) * (cw + 1.5), 3.5 + Math.floor(i / cols) * (ch + 1.5), cw, ch, uid);
      const rx = x0 + zone + 6, ph = (h - 8) / 2;
      s += psu(rx, 3.5, 60, ph, uid) + psu(rx, 3.5 + ph + 1, 60, ph, uid);
      const end = bmcAt(rx + 66, 3.5 + ph / 2);
      const t2w = Math.max(40, x1 - rx - 70), t2h = Math.min(ph - 2, 22);
      const t2 = bracket(rx + 66, 3.5 + ph + 3, t2w, t2h, d.nsPorts || 1);
      s += t2.svg;
      t2.anchors.forEach((a) => anchors.push({ ...a, fabric: 'ns' }));
      const t2y = 3.5 + ph + 3 + t2h;
      if (d.nsPorts && h - t2y > 10) {
        s += text(rx + 66, t2y + 7, `${adapterName(d)} · ${d.nsPorts} × ${d.nsGb || 400}G north-south`, '#4a4a52', 5, 'start', 600);
      }
      void end;
      return { svg: s, anchors };
    }
    if (face === 'cdu') {
      [0, 1].forEach((i) => {
        const cx = x0 + 40 + i * 44, cy = h / 2;
        s += circ(cx, cy, 14, '#5a5a62') + circ(cx, cy, 10, '#2a2a2e') + circ(cx, cy, 6, i ? '#2f5fa8' : '#b0316f');
      });
      s += rect(x0 + 100, 3.5, iw - 100 - 66, h - 7, `url(#pf${uid})`, '#9a9aa1', 0.8);
      s += psu(x1 - 62, 3.5, 62, (h - 8) / 2, uid) + psu(x1 - 62, 3.5 + (h - 8) / 2 + 1, 62, (h - 8) / 2, uid);
      const end = bmcAt(x0 + 100 + 6, h - 12);
      void end;
      return { svg: s, anchors };
    }
    if (face === 'ports') {
      // Appliance rear: a PSU (two on the firewall), fans, console.
      const pn = /SRX/.test(d.detail || '') ? 2 : 1, pw = 58;
      for (let i = 0; i < pn; i++) s += psu(x0 + i * (pw + 3), 3.5, pw, h - 7, uid);
      const fx = x0 + pn * (pw + 3) + 6, fs = Math.min(h - 7, 16);
      for (let i = 0; i < 3; i++) s += fan(fx + i * (fs + 3), (h - fs) / 2, fs, '#5a5a62');
      s += rect(fx + 3 * (fs + 3) + 4, 3.5, Math.max(0, x1 - fx - 3 * (fs + 3) - 4), h - 7, `url(#pf${uid})`, '#9a9aa1', 0.8);
      bmcAt(x1 - 50, h / 2);
      return { svg: s, anchors };
    }
    if (face === 'nas') {
      const pw = 48;
      s += psu(x0, 3.5, pw, h - 7, uid) + psu(x0 + pw + 2, 3.5, pw, h - 7, uid);
      const fs = Math.min(h - 7, 18), fx = x0 + 2 * pw + 8;
      for (let i = 0; i < 2; i++) s += fan(fx + i * (fs + 3), (h - fs) / 2, fs, '#5a5a62');
      const end = bmcAt(fx + 2 * (fs + 3) + 6, h / 2);
      s += rect(end + 4, 3.5, Math.max(0, x1 - end - 4), h - 7, `url(#pf${uid})`, '#9a9aa1', 0.8);
      return { svg: s, anchors };
    }
    // Hyper 1U/2U rear: two PSUs, onboard I/O, two PCIe slots (one with the
    // dual SFP28 NIC) and the AIOM, exhaust between.
    const pw = 52;
    if (twoU) s += psu(x0, 3.5, pw, (h - 8) / 2, uid) + psu(x0, 3.5 + (h - 8) / 2 + 1, pw, (h - 8) / 2, uid);
    else s += psu(x0, 3.5, pw, h - 7, uid) + psu(x0 + pw + 2, 3.5, pw, h - 7, uid);
    const ix = x0 + (twoU ? pw : pw * 2) + 8, cy = 3.5 + Math.min((h - 7) / 2, 9);
    const end = bmcAt(ix, cy);
    // The RA BOM fits a BlueField-3 DPU in every platform server, platform
    // router and CPU compute node; its ports are north-south endpoints, so the
    // card's cages carry anchors and the cabling lands on them.
    const slotH = Math.min(h - 7, 22), sx = end + 8;
    const ns = d.nsPorts || 0;
    const dpu = bracket(sx, 3.5, 58, slotH, ns);
    s += dpu.svg + bracket(sx + 62, 3.5, 58, slotH, 0).svg;
    dpu.anchors.forEach((a) => anchors.push({ ...a, fabric: 'ns' }));
    s += rect(sx + 124, 3.5, 40, Math.min(h - 7, 12), '#d9d9dd', C.psuEdge, 0.8);   // AIOM
    // The adapter is named, not just drawn. A 1U chassis has room below the
    // card even though it has none beside it, so the lines are placed from the
    // bottom of the bracket rather than from the bottom of the chassis, which
    // is what pushed them through the edge of a 1U face.
    if (ns) {
      const ty = 3.5 + slotH, room = h - ty - 3;
      if (room >= 14) {
        s += text(sx, ty + 7, adapterName(d), '#3f3f47', 5.4, 'start', 700);
        s += text(sx, ty + 13.6, `${ns} × ${d.nsGb || 400}G north-south`, '#6d6d75', 4.8, 'start');
      } else if (room >= 7) {
        s += text(sx, ty + 6.4, `${adapterName(d)} · ${ns} × ${d.nsGb || 400}G north-south`, '#3f3f47', 5, 'start', 700);
      } else {
        s += text(sx + 124 + 44, 3.5 + slotH / 2 + 2, `${adapterName(d)} · ${ns} × ${d.nsGb || 400}G`, '#3f3f47', 5, 'start', 700);
      }
    }
    const vx = sx + 168;
    if (x1 - vx > 10) s += rect(vx, 3.5, x1 - vx, h - 7, `url(#pf${uid})`, '#9a9aa1', 0.8);
    return { svg: s, anchors };
  }

  function blank(w, h) {
    return rect(0, 0, w, h, C.blank, C.blankEdge, 1);
  }

  /* ---------- frame ---------- */
  function frame(totalU, uid) {
    const H = totalU * G.U + G.TOP * 2;
    let s = rect(0, 0, G.RACK_W, H, C.frame, C.frameEdge, 3);
    s += rect(G.RAIL, G.TOP, G.EQ_W, totalU * G.U, '#1e1e21', '');
    for (let u = 1; u <= totalU; u++) {
      const y = G.TOP + (totalU - u) * G.U;
      s += rect(1.5, y, G.RAIL - 3, G.U, C.railFace, '#2b2b2f', 0.5);
      s += rect(G.RACK_W - G.RAIL + 1.5, y, G.RAIL - 3, G.U, C.railFace, '#2b2b2f', 0.5);
      [0.28, 0.72].forEach((f) => {
        s += rect(G.RAIL / 2 - 1, y + G.U * f - 1, 2, 2, C.railHole, '', 0.3);
        s += rect(G.RACK_W - G.RAIL / 2 - 1, y + G.U * f - 1, 2, 2, C.railHole, '', 0.3);
      });
      if (u % 2 === 1) s += text(G.RAIL / 2, y + G.U / 2 + 2.2, String(u), C.uText, 5.5, 'middle');
    }
    return { svg: s, H };
  }

  /* ---------- link plan ----------
     A rack is drawn on its own, but its cables mostly go somewhere else: the
     GPU racks' ports land on leaves in the switch fabric rack. The plan walks
     the whole layout once so each rack knows what leaves through its top, what
     arrives at its leaves, and how many uplinks its leaves carry. */

  // Server-facing ports a device contributes to each plane. The rear faces
  // draw exactly these, so counts and cables agree.
  function sourcePorts(d) {
    if (d.type === 'gpu' || d.type === 'dgx') return { ew: d.ewPorts || 8, ns: d.nsPorts || 2, oob: 1 };
    // NVL72: four SuperNIC ports and the B3240 pair on every compute tray;
    // the switch trays and power shelves each hang one BMC on the OOB pair.
    if (d.type === 'tray') return { ew: d.ewPorts || 4, ns: d.nsPorts || 2, oob: 1 };
    if (d.type === 'nvswitch' || d.type === 'powershelf') return { oob: 1 };
    // A WEKApod's two dual-port ConnectX-7 give four data links, and its two
    // 1GbE management ports both land on the out-of-band fabric.
    if (d.type === 'wekapod') return { ns: d.ports || 4, oob: d.mgmtPorts || 2 };
    // Platform and control-plane boxes: BMC plus host management, and the
    // north-south ports of the BlueField-3 the RA BOM gives them.
    if (d.type === 'infra') return d.nsPorts ? { ns: d.nsPorts, oob: 2 } : { oob: 2 };
    return {};
  }
  function portGb(d, role) {
    if (role === 'oob') return 1;
    if (role === 'ew') return d.ewGb || 800;
    return d.type === 'wekapod' ? (d.portGb || 400) : (d.nsGb || 400);
  }
  const switchTier = (d) => d.tier || (/spine/i.test(d.name) ? 'spine' : 'leaf');

  const KIND_NAME = { gpu: 'GPU rack', storage: 'storage rack', mgmt: 'management rack', fabric: 'fabric rack', cooling: 'CDU cabinet' };
  const plural = (n, s) => `${n} ${n === 1 ? s : s.endsWith('leaf') ? s.slice(0, -1) + 'ves' : /(ch|s|x)$/.test(s) ? s + 'es' : s + 's'}`;

  function planLinks(racks, fabric) {
    const roles = {};
    ROLE_ORDER.forEach((r) => {
      roles[r] = { key: r, ...ROLES[r], sources: 0, gb: 0, leaves: 0, spines: 0, leafModel: '', spineModel: '',
        sourceRacks: {}, leafRacks: [], arriveRacks: [], up: 0, down: 0, transport: '', oversub: null };
    });
    const local = new Map();
    racks.forEach((rk) => {
      const L = { sources: { ew: 0, ns: 0, oob: 0 }, leaves: { ew: 0, ns: 0, oob: 0 }, spines: { ew: 0, ns: 0, oob: 0 }, gb: {}, nodes: 0, trays: 0, pods: 0 };
      rk.devices.forEach((d) => {
        if (d.type === 'switch') {
          const R = roles[d.role];
          if (!R) return;
          if (switchTier(d) === 'spine') { L.spines[d.role]++; R.spines++; R.spineModel = R.spineModel || d.detail; }
          else { L.leaves[d.role]++; R.leaves++; R.leafModel = R.leafModel || d.detail; if (!R.leafRacks.includes(rk)) R.leafRacks.push(rk); }
          return;
        }
        if (d.type === 'gpu' || d.type === 'dgx') L.nodes++;
        if (d.type === 'tray') { L.nodes++; L.trays++; }
        if (d.type === 'wekapod') L.pods++;
        const sp = sourcePorts(d);
        Object.keys(sp).forEach((r) => {
          L.sources[r] += sp[r];
          roles[r].sources += sp[r];
          roles[r].gb = roles[r].gb || portGb(d, r);
          // A rack's own trunk is labelled at its own port speed — a 200G
          // BlueField-3 pair on the GPU racks, 400G on the WEKApods.
          L.gb[r] = L.gb[r] || portGb(d, r);
        });
      });
      local.set(rk, L);
    });

    // A consolidated NVIDIA design carries the converged north-south network
    // on the compute leaves: the plane keeps its own colour, ports and
    // headline, but its cables land on — and its panel shows — the same
    // switches as the east-west plane.
    const consolidated = !!(fabric && fabric.consolidated);
    if (consolidated) {
      const ew = roles.ew, ns = roles.ns;
      ns.leaves = ew.leaves; ns.spines = ew.spines; ns.leafModel = ew.leafModel; ns.spineModel = ew.spineModel;
      ns.leafRacks = ew.leafRacks.slice(); ns.aliasOf = 'ew';
      ns.title = 'North-south — converged into the compute leaves';
      racks.forEach((rk) => { const L = local.get(rk); L.leaves.ns = L.leaves.ew; L.spines.ns = L.spines.ew; });
    }
    ROLE_ORDER.forEach((r) => {
      const R = roles[r];
      // A rack with its own leaves of a plane cables its devices to them (the
      // management rack's OOB pair, the edge design's leaves); every other
      // rack's cables run to the dedicated fabric rack when there is one.
      const fab = R.leafRacks.filter((rk) => rk.kind === 'fabric');
      R.arriveRacks = fab.length ? fab : R.leafRacks;
      const arriveLeaves = R.arriveRacks.reduce((a, rk) => a + local.get(rk).leaves[r], 0);
      R.remote = 0;
      racks.forEach((rk) => {
        const L = local.get(rk);
        if (!L.sources[r] || L.leaves[r]) return;
        R.remote += L.sources[r];
        R.sourceRacks[rk.kind] = (R.sourceRacks[rk.kind] || 0) + 1;
      });
      R.perLeaf = arriveLeaves ? Math.ceil(R.remote / arriveLeaves) : 0;
      if (fabric) {
        // Per-leaf budgets are in the switch's logical ports — 400G when a
        // twin-port cage is split — so the labels say so rather than quoting
        // the node's 800G port speed.
        const linkGb = fabric.breakout === 2 ? 400 : null;
        if (r === 'ew') {
          R.up = fabric.ewUp; R.down = fabric.ewDown; R.oversub = fabric.ewOversub; R.transport = fabric.ewTech; R.linkGb = linkGb;
          if (fabric.linksPerPort > 1) R.linksNote = `${R.sources * fabric.linksPerPort} × 400G links, dual plane`;
        }
        if (r === 'ns') {
          R.up = fabric.nsUp; R.down = fabric.nsDown; R.oversub = fabric.nsOversub; R.transport = fabric.nsTech; R.linkGb = linkGb;
          if (fabric.nsCollapsed) R.oversubNote = 'leaf pair + ISL';
          // The NVIDIA RAs reserve converged ports for the customer network,
          // support servers and SN2201 uplinks; they are endpoints of the
          // plane even though no rack in the layout carries them.
          if (fabric.budget) {
            const extra = fabric.budget.customer + fabric.budget.support + fabric.budget.mgmt;
            R.extraEnds = [{ title: 'Customer network, support servers, SN2201 uplinks', sub: `${extra} × 400G · RA allocation` }];
            R.extraPorts = extra;
          }
        }
        if (r === 'oob') R.homed = fabric.oobHomed === 'single' ? 'single-homed' : 'dual-homed';
      }
      // SN2201: two 100G uplinks per leaf, as the optics BOM orders them. The
      // NVIDIA RAs land them on the converged fabric rather than an OOB spine.
      if (r === 'oob') { R.up = 2; R.down = 48; R.transport = 'ethernet'; R.uplinkTo = fabric && fabric.oobUplinks === 'converged' ? 'the converged fabric' : ''; }
    });
    return { roles, local, consolidated };
  }

  /* "3 GPU racks, 1 storage rack" — the racks whose cables arrive on a plane. */
  function fromText(plan, role) {
    const R = plan.roles[role];
    const parts = [];
    Object.keys(KIND_NAME).forEach((k) => {
      const n = R.sourceRacks[k] || 0;
      if (n > 0) parts.push(plural(n, KIND_NAME[k]));
    });
    return parts.join(', ') || 'this rack';
  }
  /* The rack (or racks) this rack's cables of a plane run to. */
  function destText(plan, role, rack) {
    const R = plan.roles[role];
    const others = R.arriveRacks.filter((rk) => rk !== rack);
    if (!others.length) return 'this rack';
    if (others.length === 1) return others[0].name;
    const stem = others[0].name.replace(/ \d+$/, '');
    return others.every((rk) => rk.name.replace(/ \d+$/, '') === stem) ? `${stem}s 1–${others.length}` : `${others.length} racks`;
  }

  /* The trunk labels drawn above a rack's rear view: uplinks first, then the
     planes outermost lane first, so no trunk rises across another line. */
  function headerLines(rack, plan) {
    const local = plan.local.get(rack);
    const lines = [];
    const trunk = (r, kind, text, lane) => lines.push({ role: r, kind, text, lane });
    ROLE_ORDER.forEach((r) => {
      const R = plan.roles[r];
      if (local.leaves[r] && local.spines[r] && R.up) {
        trunk(r, 'uplink', `${local.leaves[r]} leaves × ${R.up} uplinks → ${plural(local.spines[r], `${R.name} spine`)}`, G.LANE.up);
      }
    });
    ['oob', 'ns', 'ew'].forEach((r) => {
      const R = plan.roles[r];
      const src = local.sources[r], lv = local.leaves[r];
      if (src && !lv && R.leaves) trunk(r, 'exit', `${src} × ${local.gb[r] || R.gb}G ${R.name} → ${destText(plan, r, rack)}`, G.LANE[r]);
      if (lv && R.arriveRacks.includes(rack) && R.remote > 0) trunk(r, 'arrive', `${R.perLeaf} × ${R.gb}G ${R.name} into each leaf ← ${fromText(plan, r)}`, G.LANE[r]);
    });
    return lines;
  }

  /* ---------- rack rendering ---------- */
  const arrow = (x, y, up, col) => `<path d="M${(x - 3.2).toFixed(1)},${(up ? y + 4 : y - 4).toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)} L${(x + 3.2).toFixed(1)},${(up ? y + 4 : y - 4).toFixed(1)} Z" fill="${col}"/>`;
  const cable = (d, col, w, op, extra = '') => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" opacity="${op}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
  // Node port to lane: out of the cage, then a curve into the channel lane.
  const toLane = (a, lane) => `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${G.RACK_W - 4},${a.y.toFixed(1)} ${(lane - 6).toFixed(1)},${a.y.toFixed(1)} ${lane.toFixed(1)},${(a.y - 4).toFixed(1)}`;
  const bundleW = (n) => Math.min(7, 1.6 + n * 0.22);

  function renderRack(rack, side, opts, uid) {
    const totalU = opts.totalU;
    const { svg: fr, H: FH } = frame(totalU, uid);
    const isRear = side === 'rear';
    // An NVL72 rack is cabled from the front — its rear is busbar, manifold
    // and NVLink cartridges — so the cabling view draws its front faces.
    const drawRear = isRear && rack.ioSide !== 'front';
    const cabling = isRear && opts.showCables;
    const plan = cabling && opts.plan ? opts.plan : null;
    const local = plan ? plan.local.get(rack) : null;
    const gutter = opts.showLabels ? G.LBL : 8;
    const chW = cabling ? G.CH : 0;
    const W = gutter + G.RACK_W + chW;

    // Header lines above the frame describe what leaves and what arrives. A
    // row of racks shares one header height so their frames line up, with
    // each rack's lines packed against its frame.
    const lines = plan ? headerLines(rack, plan) : [];
    const ownH = lines.length ? 8 + lines.length * 11 : 0;
    const HDR = plan ? 8 + Math.max(lines.length, opts.minLines || 0) * 11 : 0;
    const H = FH + HDR;

    let body = '', labels = '', cables = '', header = '';
    const switches = { ew: [], ns: [], oob: [] };  // { d, anchors, tier }
    const sources = { ew: [], ns: [], oob: [] };   // { x, y }

    // Fill unoccupied units with blanking panels, exactly as the elevations do.
    const occupied = new Set();
    rack.devices.forEach((d) => { for (let i = 0; i < d.ru; i++) occupied.add(d.uTop - i); });
    if (opts.showBlanks) {
      for (let u = 1; u <= totalU; u++) {
        if (occupied.has(u)) continue;
        const y = G.TOP + (totalU - u) * G.U;
        body += `<g transform="translate(${G.RAIL},${y.toFixed(1)})">${blank(G.EQ_W, G.U - 1.2)}</g>`;
      }
    }

    rack.devices.forEach((d) => {
      const y = G.TOP + (totalU - d.uTop) * G.U;
      const h = d.ru * G.U - 1.2;
      let inner = '', out = null;
      if (d.type === 'dgx') inner = drawRear ? (out = dgxRear(G.EQ_W, h, d, uid)).svg : dgxFront(G.EQ_W, h, d, uid);
      else if (d.type === 'powershelf') { out = powerShelf(G.EQ_W, h, d, uid); inner = out.svg; }
      else if (d.type === 'tray') { out = trayFront(G.EQ_W, h, d, uid); inner = out.svg; }
      else if (d.type === 'nvswitch') { out = nvswitchFront(G.EQ_W, h, d, uid); inner = out.svg; }
      else if (d.type === 'gpu') inner = drawRear ? (out = gpuRear(G.EQ_W, h, d, uid)).svg : hgxFront(G.EQ_W, h, d, uid);
      else if (d.type === 'wekapod') inner = drawRear ? (out = wekapodRear(G.EQ_W, h, d, uid)).svg : wekapodFront(G.EQ_W, h, d, uid);
      else if (d.face === 'cabinet') { out = cabinetFace(G.EQ_W, h, d, uid, drawRear); inner = out.svg; }
      // A switch keeps its ports on the rear whichever way the rack is cabled,
      // so the cabling view always draws its port face.
      else if (d.type === 'switch') { out = switchFace(G.EQ_W, h, d, uid, isRear); inner = out.svg; }
      else { out = genericFace(G.EQ_W, h, d, uid, drawRear); inner = out.svg; }

      body += `<g transform="translate(${G.RAIL},${y.toFixed(1)})">${inner}</g>`;

      if (cabling && out && out.anchors) {
        const abs = out.anchors.map((a) => ({ ...a, x: a.x + G.RAIL, y: a.y + y }));
        if (d.type === 'switch') { if (switches[d.role]) switches[d.role].push({ d, anchors: abs, tier: switchTier(d) }); }
        else abs.forEach((a) => { if (sources[a.fabric]) sources[a.fabric].push(a); });
      }

      if (opts.showLabels) {
        const cy = y + (d.ru * G.U) / 2;
        const span = d.ru > 1 ? `U${d.uTop - d.ru + 1}–${d.uTop}` : `U${d.uTop}`;
        labels += text(gutter - 24, cy - 0.5, clip(d.name, 22), 'var(--text-primary)', 9, 'end', 600);
        labels += text(gutter - 24, cy + 8.5, clip(`${d.detail} · ${span}`, 30), 'var(--text-muted)', 7.2, 'end');
        labels += `<line x1="${gutter - 20}" y1="${cy}" x2="${gutter - 4}" y2="${cy}" stroke="var(--border-strong)" stroke-width="1"/>`;
      }
    });

    if (cabling) {
      const bank = (sw) => {   // port-bank extent of a switch, where trunks land
        const xs = sw.anchors.map((a) => a.x), ys = sw.anchors.map((a) => a.y);
        return { x0: Math.min(...xs), x1: Math.max(...xs), y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      };
      const lineY = (ln) => -ownH + 8 + lines.indexOf(ln) * 11 + 3;

      ROLE_ORDER.forEach((r) => {
        const col = ROLES[r].colour;
        const src = sources[r];
        // On a consolidated fabric the north-south plane's switches are the
        // east-west leaves; its ribbons and trunks land there.
        const own = r === 'ns' && opts.plan && opts.plan.consolidated && !switches.ns.length ? switches.ew : switches[r];
        const leaves = own.filter((s) => s.tier === 'leaf');
        const spines = r === 'ns' && own === switches.ew ? [] : own.filter((s) => s.tier === 'spine');
        const targets = leaves.length ? leaves : own;
        const exit = lines.find((l) => l.role === r && l.kind === 'exit');
        const arrive = lines.find((l) => l.role === r && l.kind === 'arrive');

        if (src.length && targets.length) {
          // Same-rack links: split each device's ports across the leaves, so a
          // leaf failure leaves every device reachable, and step along the
          // port bank as the RA's port maps do.
          const used = targets.map(() => 0);
          const nearest = targets.map((t) => [...t.anchors].sort((p, q) => q.x - p.x || p.y - q.y));
          src.forEach((a, i) => {
            const k = i % targets.length;
            const port = nearest[k][used[k]++ % nearest[k].length];
            const lane = G.RACK_W + G.LANE[r] + (i % 6) * 2.2;
            const d = `${toLane(a, lane)} L${lane.toFixed(1)},${(port.y + 4).toFixed(1)} C${lane.toFixed(1)},${port.y.toFixed(1)} ${G.RACK_W - 4},${port.y.toFixed(1)} ${port.x.toFixed(1)},${port.y.toFixed(1)}`;
            cables += cable(d, col, 1.2, 0.6);
          });
        } else if (src.length && exit) {
          // Every port runs into its lane and up out of the top of the rack,
          // where the ribbon becomes one trunk with an arrow at its label.
          const ly = lineY(exit);
          src.forEach((a, i) => {
            const lane = G.RACK_W + G.LANE[r] + (i % 6) * 2.2;
            cables += cable(`${toLane(a, lane)} L${lane.toFixed(1)},2`, col, 1.2, 0.6);
          });
          const lane = G.RACK_W + G.LANE[r] + 5.5;
          cables += cable(`M${lane.toFixed(1)},2 L${lane.toFixed(1)},${(ly + 1).toFixed(1)}`, col, bundleW(src.length), 0.8);
          cables += arrow(lane, ly - 3, true, col);
        }

        if (arrive && leaves.length) {
          // A trunk per leaf drops from the header down the lane and turns in
          // across the port bank; the header line carries the count.
          const ly = lineY(arrive);
          const R = opts.plan.roles[r];
          const lane = G.RACK_W + G.LANE[r] + 5.5;
          cables += arrow(lane, 0, false, col);
          [...leaves].sort((a, b) => bank(b).y - bank(a).y).forEach((sw) => {
            const b = bank(sw);
            const d = `M${lane.toFixed(1)},${ly.toFixed(1)} L${lane.toFixed(1)},${(b.y - 6).toFixed(1)} Q${lane.toFixed(1)},${b.y.toFixed(1)} ${(lane - 6).toFixed(1)},${b.y.toFixed(1)} L${((b.x0 + b.x1) / 2).toFixed(1)},${b.y.toFixed(1)}`;
            cables += cable(d, col, bundleW(R.perLeaf), 0.75);
          });
        }

        if (leaves.length && spines.length) {
          // Leaf-to-spine uplinks, in the outer lanes so they never cross the
          // node ribbons: every leaf runs a dashed trunk to a bar spanning the
          // spine group, and every spine takes a stub from that bar — all
          // leaves to all spines, drawn once rather than as a mesh.
          const dash = ' stroke-dasharray="5 2.5"';
          const sy = spines.map((sw) => bank(sw).y);
          const spineY = (Math.min(...sy) + Math.max(...sy)) / 2;
          const barX = G.RACK_W + G.LANE.up + Math.min(leaves.length, 8) * 3 + 2;
          const laneOf = (i) => G.RACK_W + G.LANE.up + (i % 8) * 3;
          leaves.forEach((sw, i) => {
            const b = bank(sw), lane = laneOf(i);
            const dir = spineY > b.y ? 1 : -1;
            const d = `M${(b.x1 - 20).toFixed(1)},${b.y.toFixed(1)} L${(G.RACK_W - 4).toFixed(1)},${b.y.toFixed(1)} Q${lane.toFixed(1)},${b.y.toFixed(1)} ${lane.toFixed(1)},${(b.y + dir * 8).toFixed(1)} L${lane.toFixed(1)},${(spineY - dir * 8).toFixed(1)} Q${lane.toFixed(1)},${spineY.toFixed(1)} ${(lane + 6).toFixed(1)},${spineY.toFixed(1)} L${barX.toFixed(1)},${spineY.toFixed(1)}`;
            cables += cable(d, col, 2.2, 0.55, dash);
          });
          const y0 = Math.min(...sy, spineY), y1 = Math.max(...sy, spineY);
          cables += cable(`M${barX.toFixed(1)},${y0.toFixed(1)} L${barX.toFixed(1)},${y1.toFixed(1)}`, col, 3, 0.7);
          spines.forEach((sw) => {
            const b = bank(sw);
            cables += cable(`M${barX.toFixed(1)},${b.y.toFixed(1)} L${(G.RACK_W - 4).toFixed(1)},${b.y.toFixed(1)} L${(b.x1 - 20).toFixed(1)},${b.y.toFixed(1)}`, col, 2.2, 0.55, dash);
          });
        }
      });

      // Header: one line per trunk, right-aligned to its lane so the text sits
      // over the rack and the arrow sits in the channel.
      lines.forEach((ln) => {
        const y = lineY(ln), col = ROLES[ln.role].colour;
        const x = G.RACK_W + ln.lane + (ln.kind === 'uplink' ? 12 : 5.5);
        header += text(x - 9, y + 2.6, ln.text, 'var(--text-secondary)', 7.5, 'end', 500);
        if (ln.kind === 'uplink') header += cable(`M${x.toFixed(1)},${y.toFixed(1)} L${(x + 16).toFixed(1)},${y.toFixed(1)}`, col, 2.2, 0.7, ' stroke-dasharray="5 2.5"');
      });
    }

    return `<svg class="ra-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="${esc(rack.name)} ${esc(side)} elevation"><g transform="translate(0,${HDR})">${defs(uid)}${labels}<g transform="translate(${gutter},0)">${fr}${body}${cables}${header}</g></g></svg>`;
  }

  /* ---------- deployment overview ----------
     Every rack in the row at a glance: a small schematic per rack with each
     device drawn as a block coloured by class, so the reader sees how the
     racks sit side by side before reading any one of them in detail. Racks
     of an identical layout repeat as a run with the count badged on the last. */
  const CLASS_COLOURS = {
    gpu: '#c9a24a', switchEw: ROLES.ew.colour, switchNs: ROLES.ns.colour, switchOob: ROLES.oob.colour,
    wekapod: '#7a55a6', infra: '#8a8a92', panel: '#c2c2c8', cdu: '#4aa3c9', blank: '#2a2a2e',
    nvswitch: '#3f9f6a', power: '#ddd3bd',
  };
  function deviceClass(d) {
    if (d.type === 'gpu' || d.type === 'dgx' || d.type === 'tray') return 'gpu';
    if (d.type === 'nvswitch') return 'nvswitch';
    if (d.type === 'powershelf') return 'power';
    if (d.type === 'switch') return d.role === 'ns' ? 'switchNs' : d.role === 'oob' ? 'switchOob' : 'switchEw';
    if (d.type === 'wekapod') return 'wekapod';
    if (d.type === 'panel') return 'panel';
    if (/CDU/i.test(d.name) || d.face === 'cabinet') return 'cdu';
    return 'infra';
  }
  const shortName = (name) => name
    .replace(/^GPU compute rack/, 'GPU').replace(/^GB300 NVL72 rack/, 'NVL72').replace(/^Switch fabric rack/, 'Fabric').replace(/^Management rack/, 'Mgmt').replace(/^Control-plane rack/, 'Control')
    .replace(/^POSIX\/S3\/AI storage rack/, 'Storage').replace(/^Storage rack/, 'Storage')
    .replace(/^In-row CDU/, 'CDU').replace(/^Sidecar CDU/, 'Sidecar');

  function renderOverview(groups, totalU) {
    const RW = 44, RH = totalU * 3, PAD = 3, GAP = 10, RUN_GAP = 22, LBL_H = 16;
    const MAX_RUN = 3;   // racks drawn per identical run before the count takes over
    let x = 0, body = '';
    groups.forEach((g, gi) => {
      const shown = Math.min(g.count, MAX_RUN);
      const runW = shown * (RW + GAP) - GAP;
      let s = '';
      for (let i = 0; i < shown; i++) {
        const rx = x + i * (RW + GAP);
        let one = rect(rx, 0, RW, RH + PAD * 2, C.frame, C.frameEdge, 1.5);
        one += rect(rx + PAD, PAD, RW - PAD * 2, RH, CLASS_COLOURS.blank, '');
        g.rack.devices.forEach((d) => {
          const y = PAD + (totalU - d.uTop) * 3;
          one += rect(rx + PAD, y + 0.3, RW - PAD * 2, d.ru * 3 - 0.6, CLASS_COLOURS[deviceClass(d)], '', 0.4);
        });
        // A run longer than we draw fades its last rack and carries the count.
        if (g.count > MAX_RUN && i === shown - 1) {
          one = `<g opacity="0.45">${one}</g>` + text(rx + RW / 2, RH / 2 + PAD + 3, `×${g.count}`, 'var(--text-primary)', 9, 'middle', 700);
        }
        s += one;
      }
      const label = shortName(g.rack.name.replace(/ \d+$/, ''));
      s += text(x + runW / 2, RH + PAD * 2 + 11, g.count > 1 ? `${label} ×${g.count}` : label, 'var(--text-muted)', 7.5, 'middle', 600);
      body += `<g class="ra-ov-group" data-group="${gi}" style="cursor:pointer"><title>${esc(g.rack.name)}${g.count > 1 ? ` × ${g.count}` : ''}</title>${s}</g>`;
      x += runW + RUN_GAP;
    });
    const W = Math.max(1, x - RUN_GAP), H = RH + PAD * 2 + LBL_H;
    return `<svg class="ra-overview-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Deployment overview: ${groups.reduce((a, g) => a + g.count, 0)} racks">${body}</svg>`;
  }

  /* ---------- fabric topology ----------
     One leaf–spine panel per plane. Boxes are schematic (themed, not hardware
     colours); links carry the plane colour used by the rear-view cabling. */
  function renderTopology(plan, opts) {
    const W = 960, PX = 16;
    const MAX_SPINE = 8, MAX_LEAF = 10, MAX_GPU = 4;
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const labelOf = { ethernet: 'Ethernet', infiniband: 'InfiniBand' };
    const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const tierName = (R, tier, i) => `${R.key === 'oob' ? 'OOB' : R.aliasOf ? 'Converged' : cap(R.name)} ${tier} ${i + 1}`;
    let y = 0, out = '';

    const box = (x, yy, w, h, title, sub, col) => {
      let s = rect(x, yy, w, h, 'var(--surface-2)', 'var(--border-strong)', 2);
      s += rect(x, yy, 3, h, col, '', 0);
      s += text(x + 9, yy + (sub ? 11.5 : h / 2 + 3.5), title, 'var(--text-primary)', 8.5, 'start', 600);
      if (sub) s += text(x + 9, yy + h - 5, sub, 'var(--text-muted)', 7, 'start');
      return s;
    };
    // A row of n boxes centred on the panel, narrowed if they would not fit.
    const rowW = (n, w, gap) => Math.min(w, Math.floor((W - PX * 2 - (n - 1) * gap) / n));
    const rowXs = (n, w, gap) => { const total = n * w + (n - 1) * gap; const x0 = (W - total) / 2; return [...Array(n)].map((_, i) => x0 + i * (w + gap)); };

    ROLE_ORDER.forEach((r) => {
      const R = plan.roles[r];
      if (!R.leaves) return;
      if (opts.only && !opts.only.includes(r)) return;   // one plane at a time, for the slide deck
      const col = R.colour;
      // Title and the plane's headline numbers.
      const oversub = R.oversubNote || (R.oversub ? `${R.oversub}:1${R.oversub === 1 ? ' non-blocking' : ''}` : (R.homed || 'dual-homed'));
      const transport = labelOf[R.transport] || 'Ethernet';
      const ports = `${fmt(R.sources)} server-facing ports${R.extraPorts ? ` + ${fmt(R.extraPorts)} allocated` : ''}${R.linksNote ? ` · ${R.linksNote}` : ''}`;
      out += text(PX, y + 13, R.title, 'var(--text-primary)', 10.5, 'start', 700);
      out += text(W - PX, y + 13, `${transport} · ${R.gb}G · ${oversub} · ${ports}`, 'var(--text-muted)', 8, 'end');
      y += 26;

      // Spines.
      const BW = 104, BH = 26, GAPX = 14;
      let spineXs = [];
      if (R.spines) {
        const n = Math.min(R.spines, MAX_SPINE);
        spineXs = rowXs(n, BW, GAPX);
        spineXs.forEach((x, i) => {
          const last = i === n - 1 && R.spines > MAX_SPINE;
          out += box(x, y, BW, BH, last ? `… ${R.spines} spines` : tierName(R, 'spine', i), clip(R.spineModel.replace(/^NVIDIA /, ''), 18), col);
        });
        y += BH;
      }

      // Leaves, with all-to-all uplinks to the spines above.
      const gapUp = R.spines ? 46 : 12;
      const ly = y + gapUp;
      const nl = Math.min(R.leaves, MAX_LEAF);
      const LW = rowW(nl, nl > 6 ? 84 : BW, 12);
      const leafXs = rowXs(nl, LW, 12);
      if (R.spines) {
        leafXs.forEach((lx) => spineXs.forEach((sx) => {
          out += `<line x1="${(lx + LW / 2).toFixed(1)}" y1="${ly.toFixed(1)}" x2="${(sx + BW / 2).toFixed(1)}" y2="${(y).toFixed(1)}" stroke="${col}" stroke-width="0.9" opacity="0.45"/>`;
        }));
        // SN2201 uplinks are the 100G DR1 pair the optics BOM orders, not 1G.
        out += text(W - PX, y + gapUp / 2 + 3, `${R.up} × ${R.key === 'oob' ? 100 : (R.linkGb || R.gb)}G uplinks per leaf`, 'var(--text-muted)', 7.2, 'end');
      } else if (R.key === 'oob' && R.uplinkTo) {
        // NVIDIA's RAs uplink every SN2201 into the converged fabric.
        out += text(W - PX, ly - 2, `${R.up} × 100G uplinks per leaf into ${R.uplinkTo} — no OOB spine tier`, 'var(--text-muted)', 7.2, 'end');
      } else if (nl === 2) {
        // A leaf pair peers directly rather than through spines.
        out += `<line x1="${(leafXs[0] + LW).toFixed(1)}" y1="${(ly + BH / 2).toFixed(1)}" x2="${leafXs[1].toFixed(1)}" y2="${(ly + BH / 2).toFixed(1)}" stroke="${col}" stroke-width="2" opacity="0.6" stroke-dasharray="4 2"/>`;
        out += text(W - PX, ly - 2, 'leaf pair interconnected directly — no spine tier', 'var(--text-muted)', 7.2, 'end');
      }
      leafXs.forEach((x, i) => {
        const last = i === nl - 1 && R.leaves > MAX_LEAF;
        out += box(x, ly, LW, BH, last ? `… ${R.leaves} leaves` : tierName(R, 'leaf', i), clip(R.leafModel.replace(/^NVIDIA /, ''), LW > 90 ? 18 : 14), col);
      });
      y = ly + BH;

      // Endpoints: one box per source rack kind (GPU racks individually, up to
      // a cap), each fanned to every leaf.
      const ends = [];
      const racks = opts.racks || [];
      const gpuRacks = racks.filter((rk) => rk.kind === 'gpu' && plan.local.get(rk).sources[r]);
      // GPU racks individually up to a cap, then one box for the remainder.
      const shown = gpuRacks.length > MAX_GPU ? gpuRacks.slice(0, MAX_GPU - 1) : gpuRacks;
      shown.forEach((rk) => {
        const L = plan.local.get(rk);
        ends.push({ title: rk.name, sub: `${plural(L.nodes, L.trays ? 'tray' : 'node')} · ${L.sources[r]} × ${R.gb}G` });
      });
      const rest = gpuRacks.slice(shown.length);
      if (rest.length) {
        const ports = rest.reduce((a, rk) => a + plan.local.get(rk).sources[r], 0);
        const nodes = rest.reduce((a, rk) => a + plan.local.get(rk).nodes, 0);
        const trays = rest.reduce((a, rk) => a + plan.local.get(rk).trays, 0);
        ends.push({ title: `… +${rest.length} more ${trays ? 'NVL72' : 'GPU'} racks`, sub: `${plural(nodes, trays ? 'tray' : 'node')} · ${ports} × ${R.gb}G` });
      }
      ['storage', 'mgmt', 'cooling'].forEach((k) => {
        const rks = racks.filter((rk) => rk.kind === k && plan.local.get(rk).sources[r]);
        if (!rks.length) return;
        const ports = rks.reduce((a, rk) => a + plan.local.get(rk).sources[r], 0);
        const pods = rks.reduce((a, rk) => a + plan.local.get(rk).pods, 0);
        const devices = rks.reduce((a, rk) => a + rk.devices.filter((d) => d.type === 'infra').length, 0);
        const title = cap(rks.length === 1 ? rks[0].name.replace(/^POSIX\/S3\/AI /, '') : `${plural(rks.length, KIND_NAME[k])}`);
        ends.push({ title, sub: k === 'storage' ? `${plural(pods, 'WEKApod')} · ${ports} × ${R.gb}G` : `${plural(devices, 'device')} · ${ports} × ${R.gb}G` });
      });
      if (r === 'oob') {
        const sw = ROLE_ORDER.reduce((a, k) => a + plan.roles[k].leaves + plan.roles[k].spines, 0);
        ends.push({ title: 'Switch mgmt ports', sub: `${plural(sw, 'switch')} · 1G each` });
      }
      if (R.extraEnds) R.extraEnds.forEach((e) => ends.push(e));
      const EW_ = rowW(ends.length, 160, 12), EH = 28;
      const chars = Math.floor((EW_ - 12) / 5.2);   // what fits at 8.5px bold
      const gapDown = 44;
      const ey = y + gapDown;
      const endXs = rowXs(ends.length, EW_, 12);
      endXs.forEach((ex) => leafXs.forEach((lx) => {
        out += `<line x1="${(ex + EW_ / 2).toFixed(1)}" y1="${ey.toFixed(1)}" x2="${(lx + LW / 2).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="0.9" opacity="0.35"/>`;
      }));
      out += text(W - PX, y + gapDown / 2 + 3, `${R.down} server-facing ports per leaf`, 'var(--text-muted)', 7.2, 'end');
      endXs.forEach((ex, i) => { out += box(ex, ey, EW_, EH, clip(ends[i].title, chars), clip(ends[i].sub, chars + 6), col); });
      y = ey + EH + 22;
      // Panel divider.
      if (!opts.only) out += `<line x1="${PX}" y1="${(y - 10).toFixed(1)}" x2="${W - PX}" y2="${(y - 10).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
    });
    const H = Math.max(40, y - (opts.only ? 16 : 10));
    return `<svg class="ra-topology-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Fabric topology">${out}</svg>`;
  }

  return { renderRack, renderOverview, renderTopology, planLinks, headerLines, ROLES, CLASS_COLOURS, G, C };
})();
