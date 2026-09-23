/* Bill-of-materials export as a real .xlsx workbook.

   An .xlsx is a ZIP of XML parts, so this writes both by hand rather than
   pulling in a spreadsheet library: the whole file is about as much code as
   the CSV export it sits beside, and it keeps the page's no-build, no-network
   promise intact. Entries are stored uncompressed — Excel, LibreOffice,
   Numbers and Google Sheets all open a stored archive, and a BOM is a few
   kilobytes, so there is nothing to gain from deflating it.

   Only the bill of materials goes in: the hardware lines and the optics and
   cabling lines, each on its own sheet, above a short block naming the design
   they belong to so a sheet is still meaningful once it has been mailed on.
   The rows come from `hardwareBOM` and `cablingBOM`, the same functions the
   results page renders, so the spreadsheet and the page cannot disagree. */
const XLSXExport = (function () {
  'use strict';

  const enc = new TextEncoder();

  /* ---------- ZIP (store, no compression) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* MS-DOS date and time, as the ZIP local header wants them. */
  function dosStamp(d) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
  }

  function zip(files) {
    const { time, date } = dosStamp(new Date());
    const parts = [];
    const central = [];
    let offset = 0;

    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);        // version needed
      local.setUint16(6, 0x0800, true);    // UTF-8 names
      local.setUint16(8, 0, true);         // stored
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, data);

      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);          // version made by
      dir.setUint16(6, 20, true);          // version needed
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(10, 0, true);
      dir.setUint16(12, time, true);
      dir.setUint16(14, date, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, data.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, name.length, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), name);

      offset += 30 + name.length + data.length;
    });

    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const blobs = [...parts, ...central, new Uint8Array(end.buffer)];
    return new Blob(blobs, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- XLSX parts ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  /* A1, B1 … Z1, AA1 … */
  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  /* Style ids, matching the cellXfs order in styles.xml below. */
  const S = { text: 0, bold: 1, title: 2, muted: 3, header: 4, int: 5, dec: 6, indent: 7, boldInt: 8, boldDec: 9, wrap: 10 };

  /* A cell is either a number or an inline string; inline strings keep the
     workbook to one file per sheet with no shared-string table to maintain. */
  function cell(ref, v, style) {
    if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${style || 0}"/>`;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${style || 0}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${style || 0}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }

  /* rows: [[{v, s}, …], …]; widths in characters; freeze: rows held on screen. */
  function sheetXml(rows, widths, freeze, autofilter) {
    const cols = widths && widths.length
      ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
    const pane = freeze
      ? `<sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`
      : '<sheetView workbookViewId="0"/>';
    const body = rows.map((cells, r) => {
      const inner = cells.map((c, i) => (c === null || c === undefined
        ? '' : cell(colName(i) + (r + 1), c.v, c.s))).join('');
      return `<row r="${r + 1}">${inner}</row>`;
    }).join('');
    const filter = autofilter ? `<autoFilter ref="${autofilter}"/>` : '';
    return XML + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<sheetViews>${pane}</sheetViews>${cols}<sheetData>${body}</sheetData>${filter}</worksheet>`;
  }

  const STYLES = XML + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.0"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF767676"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF8C8C8C"/></bottom><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF8C8C8C"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="bottom" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment indent="2"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function workbook(sheets) {
    const files = [
      {
        name: '[Content_Types].xml',
        data: XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
          + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
          + `<Default Extension="xml" ContentType="application/xml"/>`
          + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
          + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
          + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
          + `</Types>`,
      },
      {
        name: '_rels/.rels',
        data: XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
          + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
          + `</Relationships>`,
      },
      {
        name: 'xl/workbook.xml',
        data: XML + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
          + `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
          + `</workbook>`,
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
          + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
          + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
          + `</Relationships>`,
      },
      { name: 'xl/styles.xml', data: STYLES },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths, s.freeze, s.autofilter) })),
    ];
    return zip(files);
  }

  /* ---------- the bill of materials ---------- */

  /* The block that opens every sheet: what design these parts belong to. A
     BOM that has been mailed on should still say what it is a BOM of. */
  function headerRows(meta, subtitle) {
    const rows = [
      [{ v: meta.title, s: S.title }],
      [{ v: subtitle, s: S.muted }],
      [],
    ];
    meta.context.forEach(([k, v]) => rows.push([{ v: k, s: S.bold }, { v, s: S.text }]));
    rows.push([]);
    return rows;
  }

  /* Hardware lines. Quantity, unit and extended power and weight are numbers,
     so the sheet totals and sorts like a spreadsheet should. Lines already
     counted inside another (the GPUs inside a node, the trays inside a
     rack-scale rack) carry their quantity but no extended total, and say so. */
  function hardwareSheet(bom, meta) {
    const rows = headerRows(meta, 'Hardware bill of materials — every purchasable line in the design');
    const head = rows.length;
    rows.push([
      { v: 'Item', s: S.header }, { v: 'Model / configuration', s: S.header }, { v: 'Qty', s: S.header },
      { v: 'Unit power (W)', s: S.header }, { v: 'Total power (W)', s: S.header },
      { v: 'Unit weight (kg)', s: S.header }, { v: 'Total weight (kg)', s: S.header },
      { v: 'Notes', s: S.header },
    ]);
    bom.rows.forEach((x) => {
      rows.push([
        { v: (x.indent ? '    ' : '') + x.item, s: x.indent ? S.indent : S.text },
        { v: x.model, s: S.text },
        { v: x.qty, s: S.int },
        { v: x.unitW == null ? '' : x.unitW, s: S.int },
        { v: x.totalW == null ? '' : x.totalW, s: S.int },
        { v: x.unitKg == null ? '' : x.unitKg, s: S.dec },
        { v: x.totalKg == null ? '' : x.totalKg, s: S.dec },
        { v: x.counts ? x.spec : (x.spec ? `${x.spec} — already counted in the line above` : 'already counted in the line above'), s: S.text },
      ]);
    });
    rows.push([
      { v: 'Total', s: S.wrap }, { v: '', s: S.wrap }, { v: '', s: S.wrap }, { v: '', s: S.wrap },
      { v: bom.totalW, s: S.boldInt }, { v: '', s: S.wrap }, { v: bom.totalKg, s: S.boldDec },
      { v: 'Matches the total IT load and weight on the results page', s: S.wrap },
    ]);
    return {
      name: 'Bill of Materials', rows, freeze: head + 1,
      widths: [46, 34, 8, 14, 15, 15, 16, 62],
      autofilter: `A${head + 1}:H${head + 1 + bom.rows.length}`,
    };
  }

  /* Optics, transceivers and cabling: the per-link lines grouped by fabric,
     then the order total by part number, which is the list a buyer works from. */
  function opticsSheet(optics, meta) {
    const rows = headerRows(meta, 'Optics, transceivers and cabling — NVIDIA part numbers, derived from this design\'s own port totals');
    const head = rows.length;
    rows.push([
      { v: 'Fabric', s: S.header }, { v: 'Item', s: S.header }, { v: 'Part number', s: S.header },
      { v: 'Qty', s: S.header }, { v: 'Role', s: S.header }, { v: 'Notes', s: S.header },
    ]);
    optics.rows.forEach((r) => {
      rows.push([
        { v: r.group, s: S.text }, { v: r.spec.label, s: S.text }, { v: r.spec.pn, s: S.text },
        { v: r.qty, s: S.int }, { v: r.spec.role, s: S.text }, { v: r.note || '', s: S.text },
      ]);
    });
    const filterEnd = head + 1 + optics.rows.length;

    rows.push([]);
    rows.push([{ v: 'Order total by part number', s: S.bold }]);
    rows.push([
      { v: 'Item', s: S.header }, { v: 'Part number', s: S.header }, { v: 'Qty', s: S.header }, { v: 'Role', s: S.header },
    ]);
    optics.totals.forEach((t) => {
      rows.push([
        { v: t.spec.label, s: S.text }, { v: t.spec.pn, s: S.text },
        { v: t.qty, s: S.int }, { v: t.spec.role, s: S.text },
      ]);
    });
    return {
      name: 'Optics and Cabling', rows, freeze: head + 1,
      widths: [40, 52, 22, 10, 42, 46],
      autofilter: `A${head + 1}:F${filterEnd}`,
    };
  }

  /* Server specifications: one row per configurable role, giving the build as
     configured, what it works out to, the networks it lands on, and how it
     measures against the specification NVIDIA publishes for that role. This is
     the sheet a buyer hands to a vendor to have the systems quoted. */
  function specSheet(specs, meta) {
    const rows = headerRows(meta, 'Server specifications — processor, memory, disk and connectivity per role, with the NVIDIA guideline each is checked against');
    const head = rows.length;
    rows.push([
      { v: 'Role', s: S.header }, { v: 'Qty', s: S.header }, { v: 'Chassis', s: S.header },
      { v: 'Processor', s: S.header }, { v: 'Cores', s: S.header },
      { v: 'Memory', s: S.header }, { v: 'Memory (GB)', s: S.header },
      { v: 'Boot media', s: S.header }, { v: 'Data cache', s: S.header },
      { v: 'Connectivity', s: S.header },
      { v: 'Unit power (W)', s: S.header }, { v: 'Total power (W)', s: S.header },
      { v: 'NVIDIA guideline', s: S.header }, { v: 'Against the guideline', s: S.header },
    ]);
    specs.forEach((x) => {
      const nets = x.spec.nets.map((n) =>
        `${n.fabric.toUpperCase()}: ${n.qty > 1 ? `${n.qty} × ` : ''}${n.label} (${n.ports} × ${n.gb >= 1000 ? `${n.gb / 1000}T` : `${n.gb}G`})`).join('; ');
      const g = x.guideKey ? x.guides[x.guideKey] : null;
      rows.push([
        { v: x.spec.def.label, s: S.text }, { v: x.qty, s: S.int },
        { v: x.spec.def.chassis, s: S.text },
        { v: x.spec.cpuLabel, s: S.text }, { v: x.spec.cores == null ? '' : x.spec.cores, s: S.int },
        { v: x.spec.memLabel, s: S.text }, { v: x.spec.ramGB == null ? '' : x.spec.ramGB, s: S.int },
        { v: x.spec.bootLabel, s: S.text }, { v: x.spec.dataLabel, s: S.text },
        { v: nets, s: S.text },
        { v: x.spec.watts, s: S.int }, { v: x.spec.watts * x.qty, s: S.int },
        { v: g ? g.name : (x.spec.fixed ? 'Appliance — bought as built' : 'None published'), s: S.text },
        { v: x.spec.fixed ? x.spec.def.fixedNote || 'Appliance'
          : x.spec.checks.length ? x.spec.checks.map((c) => c.text).join(' ')
            : g && g.cores ? 'Meets the guideline' : g ? g.src : '', s: S.text },
      ]);
    });
    return {
      name: 'Server Specifications', rows, freeze: head + 1,
      widths: [24, 8, 34, 40, 8, 32, 13, 34, 36, 72, 14, 15, 44, 78],
      autofilter: `A${head + 1}:N${head + 1 + specs.length}`,
    };
  }

  /* The only entry point: hand it the BOMs and the design they describe. */
  function exportBOM({ hardware, optics, specs, meta, fileName }) {
    const sheets = [hardwareSheet(hardware, meta), opticsSheet(optics, meta)];
    if (specs && specs.length) sheets.push(specSheet(specs, meta));
    const blob = workbook(sheets);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'bill-of-materials.xlsx';
    a.click();
    // Revoke on the next tick so the click has taken the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return { exportBOM, _internals: { zip, workbook, sheetXml, crc32, colName } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = XLSXExport;
