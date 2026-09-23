#!/usr/bin/env node
/* Checks the facility engine against the switch counts NVIDIA publishes in
   its reference architectures — the Enterprise RA "AI Factory" documents for
   HGX B300, HGX H100/H200/B200 and RTX PRO, the NVL72 AI Factory RA and the
   DGX SuperPOD RA — and against the InferX reference designs' own totals. The
   published figures live beside each profile in compute-catalog.js as
   RA_PROFILES[key].verified; if one of these fails, the engine has started
   disagreeing with the documentation it claims to implement.

   The engine files are browser globals, so they are loaded into one vm
   context rather than required.

     node .github/scripts/verify-nvidia-ra.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const files = ['catalog.js', 'sizing.js', 'compute-catalog.js', 'server-specs.js', 'inference.js', 'ra-rack.js'];
const names = ['GPU_NODES', 'GPUS', 'RACK', 'RA_PROFILES', 'FABRIC', 'FABRIC_RULES', 'OPTICS', 'OPTIC_SETS', 'INFRA', 'sizeFacility', 'sizeInference', 'buildRALayout', 'cablingBOM', 'hardwareBOM', 'sizeWekapod', 'RARack', 'SERVER_ROLES', 'SERVER_PARTS', 'SERVER_CONFIG', 'SPEC_GUIDES', 'NET_ADAPTERS', 'serverSpec', 'serverDefaults', 'alignToGuide', 'specWatts', 'specWeight', 'rolesFor', 'setServerContext', 'SERVER_CONTEXT', 'cpuGroups', 'cpuVendor', 'guideCoresPerSocket', 'roleChassis', 'SERVER_COUNTS', 'roleCountBounds', 'roleCountOf', 'memSlots', 'memChannels', 'bootUsable', 'SERVING', 'MODELS', 'PRECISIONS', 'WEKAPODS'];
const code = files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n')
  + '\n;' + names.map((n) => `this.${n} = ${n};`).join('\n');
const E = { console };
E.window = E;
vm.createContext(E);
vm.runInContext(code, E, { filename: 'engine.js' });

let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (published ${JSON.stringify(want)})`}`);
};

// A real design carries storage, so every check runs with the smallest
// WEKApod cluster attached, as the results page would.
const weka = E.sizeWekapod({ podKey: 'nitro-155', nodes: 8, schemeId: '5+2' });
const size = (profileKey, gpuNodes, coolingKey) => {
  const prof = E.RA_PROFILES[profileKey];
  return E.sizeFacility({ gpuNodes, nodeKey: prof.defaultNode, coolingKey: coolingKey || prof.defaultCooling || 'inrow', profileKey, storageNodes: 8, storagePodKey: 'nitro-155' });
};

console.log('--- NVIDIA reference architectures: published switch counts ---');
for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
  if (prof.stack !== 'nvidia') continue;
  const v = prof.verified;
  const points = [...new Set([...Object.keys(v.ew || {}), ...Object.keys(v.ns || {}), ...Object.keys(v.oobInRack || {})].map(Number))].sort((a, b) => a - b);
  for (const n of points) {
    const fb = size(pk, n).fabric;
    if (v.ew && v.ew[n]) check(`${prof.label} · ${n} ${v.unit}s · east-west leaf/spine`, [fb.ewLeaves, fb.ewSpines], v.ew[n]);
    if (v.ns && v.ns[n]) check(`${prof.label} · ${n} ${v.unit}s · north-south leaf/spine`, [fb.nsLeaves, fb.nsSpines], v.ns[n]);
    if (v.oobInRack && v.oobInRack[n]) check(`${prof.label} · ${n} ${v.unit}s · in-rack SN2201`, fb.oobRackLeaves, v.oobInRack[n]);
    if (v.oob && v.oob[n]) {
      // The RA counts only the compute nodes' links; the engine counts every
      // device, so it may land one above. Report, do not fail.
      console.log(`info ${prof.label} · ${n} ${v.unit}s · SN2201: ${fb.oobLeaves} (RA node-only table: ${v.oob[n]}; ${fb.oobPorts} links incl. switches, control plane, storage)`);
    }
  }
}

console.log('--- NVIDIA reference architectures: cabling tables ---');
{
  // HGX B300 RA Table 6 and Table 10 at 32 nodes, HGX H100/H200/B200 RA
  // Table 7 and Table 11 at 32 nodes.
  const bomFor = (pk, n) => {
    const f = size(pk, n);
    return E.cablingBOM({ fac: f, node: f.node, gpuNodes: n, weka });
  };
  const qty = (bom, optic, note) => bom.rows.filter((r) => r.optic === optic && (!note || (r.note || '').includes(note))).reduce((a, r) => a + r.qty, 0);
  const b300 = bomFor('nv-hgx-b300', 32);
  check('HGX B300 · 32 nodes · node-side compute transceivers', qty(b300, 'osfp-800-node'), 256);
  check('HGX B300 · 32 nodes · switch-side twin-port, node-facing', qty(b300, 'osfp-twin-800', 'node-facing'), 256);
  check('HGX B300 · 32 nodes · node-leaf fibres', qty(b300, 'fibre-mmf', 'node to leaf'), 512 + 64);
  check('HGX B300 · 32 nodes · leaf-spine twin-port', qty(b300, 'osfp-twin-800', 'leaf to spine'), 512);
  check('HGX B300 · 32 nodes · DPU node-side 400G', qty(b300, 'qsfp-400', 'BlueField-3, node side'), 64);
  check('HGX B300 · 32 nodes · DPU switch-side twin-port', qty(b300, 'osfp-twin-800', 'DPU-facing'), 32);
  const h200 = bomFor('nv-hgx-h200', 32);
  check('HGX H200 · 32 nodes · node-side compute transceivers (400G)', qty(h200, 'qsfp-400', 'node side') - qty(h200, 'qsfp-400', 'BlueField-3, node side'), 256);
  check('HGX H200 · 32 nodes · switch-side twin-port, node-facing', qty(h200, 'osfp-twin-800', 'node-facing'), 128);
  check('HGX H200 · 32 nodes · leaf-spine twin-port', qty(h200, 'osfp-twin-800', 'leaf to spine'), 256);
  check('HGX H200 · 32 nodes · DPU switch-side twin-port (4 × 200G per cage)', qty(h200, 'osfp-twin-800', 'DPU-facing'), 16);
  check('HGX H200 · 32 nodes · CAT6 per node', size('nv-hgx-h200', 32).node.oobLinksPerNode, 6);
  check('NVL72 · CAT6 per rack', E.GPU_NODES['nv-gb300-nvl72'].oobLinksPerNode, 71);
}

console.log('--- InferX reference designs: elevation totals ---');
{
  const air = size('core', 128, 'air');
  check('air B300 rack with Tier 2 (W)', air.power.rackWithTier2W, 28986);
  check('air B300 rack without Tier 2 (W)', air.power.rackPlainW, 27798);
  check('128 B300 nodes (W)', air.power.gpuNodeW, 1779072);
  check('2 MW design, air-cooled compute racks', air.computeRacks, 64);
  const liq = size('core', 128, 'liquid');
  check('liquid rack with Tier 2 (W)', liq.power.rackWithTier2W, 115380);
  check('2 MW design, liquid-cooled compute racks', liq.computeRacks, 16);
  E.FABRIC_RULES.northSouthOversub = 4;
  const ra = size('core', 128, 'air');
  check('2 MW design SN5610 at the RA\'s 4:1 north-south (elevation: 32)', ra.fabric.ewLeaves + ra.fabric.ewSpines + ra.fabric.nsLeaves + ra.fabric.nsSpines, 29);
  E.FABRIC_RULES.northSouthOversub = 1;
  check('GB300 NVL72 is not offered on the InferX tiers', ['edge', 'regional', 'core'].some((k) => E.RA_PROFILES[k].nodes.includes('nv-gb300-nvl72')), false);
}

console.log('--- cabling: every count reconciles with the ports it comes from ---');
for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
  const nk = prof.defaultNode;
  const node = E.GPU_NODES[nk];
  const n = prof.stack === 'nvidia' ? Math.max(prof.minGpuNodes, prof.unit === 'rack' ? 2 : 8) : 8;
  const f = size(pk, n);
  const fb = f.fabric;
  const bom = E.cablingBOM({ fac: f, node, gpuNodes: n, weka });
  // Rows repeat an optic and a note across fabrics (both planes have a "node
  // to leaf" fibre line), so a count must name the fabric it is asking about.
  const qty = (optic, note, group) => bom.rows
    .filter((x) => x.optic === optic && (!note || (x.note || '').includes(note)) && (!group || x.group.includes(group)))
    .reduce((a, x) => a + x.qty, 0);
  const EW = 'Compute fabric', NS = 'Storage fabric', IB = 'In-band';
  // Each stack orders its own part numbers, so a check has to ask for the
  // part that stack uses for the job rather than a fixed key.
  const P = E.OPTIC_SETS[prof.stack === 'nvidia' ? 'nvidia' : 'inferx'];
  const pods = weka.nodes;

  // Storage: two dual-port ConnectX-7 per node is four data links, and both
  // 1GbE management ports land on the out-of-band fabric.
  check(`${pk}: WEKApod data links = 4 per node`, bom.ports.stPorts, pods * 4);
  check(`${pk}: WEKApod node-side optics = its data links`, qty(P.nsNode, 'WEKApod side', NS), pods * 4);
  check(`${pk}: WEKApod fibres = its data links`, qty(P.mgmtFibre, 'WEKApod to leaf', NS), pods * 4);
  check(`${pk}: WEKApod switch-side cages = 2 links per 800G cage`, qty(P.twin, 'storage-facing', NS), pods * 2);
  check(`${pk}: out-of-band counts 2 management ports per WEKApod`, fb.oobLinks.storage, pods * 2);

  // Compute: one transceiver and one fibre per link, one switch cage per two.
  const ewLinks = n * node.ewPortsPerNode * (node.ewLinksPerPort || (node.ewPortGb >= 800 ? 2 : 1));
  check(`${pk}: east-west links = ports x links per port`, bom.ports.ewLinks, ewLinks);
  check(`${pk}: east-west node-leaf fibres = one per link`, qty(P.nodeFibre, 'node to leaf', EW), ewLinks);
  check(`${pk}: east-west node-side optics = one per node port`, qty(node.ewPortGb >= 800 ? P.ewNode800 : P.ewNode400, 'node side', EW), n * node.ewPortsPerNode);
  check(`${pk}: east-west switch cages = two links per cage`, qty(P.twin, 'node-facing', EW), Math.ceil(ewLinks / 2));

  // North-south: the nodes' DPU pair, one fibre each.
  check(`${pk}: north-south node ports = DPU ports per node`, bom.ports.nsPorts, n * (node.nsPortsPerNode || 2));
  check(`${pk}: north-south node fibres = one per port`, qty(P.nodeFibre, 'node to leaf', NS), bom.ports.nsPorts);

  // Out-of-band: one CAT6 per link, and the leaf count comes from that count.
  check(`${pk}: CAT6 = the out-of-band link count`, qty(P.copper), fb.oobLinks.total);
  // The InferX rack has platform servers and CPU nodes where the NVIDIA stacks
  // have control-plane nodes, and the schedule names each for what it is.
  const cpFibreNote = prof.stack === 'nvidia' ? 'control plane to leaf' : 'management stack to leaf';
  check(`${pk}: ${prof.stack === 'nvidia' ? 'control-plane' : 'management-stack'} fibres = one per north-south port on it`,
    qty(P.mgmtFibre, cpFibreNote, IB), bom.ports.cpPorts);
  const outside = fb.oobLinks.total - (fb.oobRackLeaves ? fb.oobLinks.nodes : 0);
  check(`${pk}: out-of-band leaves carry every link outside the compute racks`,
    fb.oobLeaves * 48 >= outside && (fb.oobLeaves === 2 || (fb.oobLeaves - 1) * 48 < outside), true);

  // The management stack's north-south ports. On an NVIDIA profile that is the
  // RA's control-plane DPU pair; on an InferX tier it is the BlueField-3 the
  // RA BOM fits in the platform servers, platform routers and CPU compute
  // nodes — and only those, not the patch panel, break-glass, firewalls or
  // the Tier 3 NAS, none of which carry a DPU.
  const mgmtNs = prof.stack === 'nvidia'
    ? f.mgmt.cpCount * (f.mgmt.cpNsPorts || 2)
    : f.mgmt.contents.reduce((a, k) => a + ((E.INFRA[k] && E.INFRA[k].nsPorts) || 0), 0);
  check(`${pk}: management north-south ports = the DPUs the BOM fits`, bom.ports.cpPorts, mgmtNs);
  if (prof.stack !== 'nvidia') {
    check(`${pk}: management stack has north-south links at all`, mgmtNs > 0, true);
    // Seven boxes carry a B3240 pair: two routers, three servers, two CPU nodes.
    check(`${pk}: BlueField-3 pairs in the management rack`, mgmtNs, 14);
    check(`${pk}: Tier 2 north-south ports = one B3140H each`, bom.ports.tier2Ports, f.tier2Count * E.INFRA.tier2.nsPorts);
    // The fabric must carry every endpoint, not just the GPU nodes.
    check(`${pk}: north-south port total = nodes + management + Tier 2 + storage`,
      fb.nsPorts, fb.nsNodePorts + fb.nsMgmtPorts + fb.nsTier2Ports + fb.nsStoragePorts);
  }
}

console.log('--- each stack quotes its own part numbers ---');
for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
  const nk = prof.defaultNode;
  const n = prof.stack === 'nvidia' ? Math.max(prof.minGpuNodes, prof.unit === 'rack' ? 2 : 8) : 8;
  const f = size(pk, n);
  const bom = E.cablingBOM({ fac: f, node: E.GPU_NODES[nk], gpuNodes: n, weka });
  const mine = E.OPTIC_SETS[prof.stack === 'nvidia' ? 'nvidia' : 'inferx'];
  const theirs = E.OPTIC_SETS[prof.stack === 'nvidia' ? 'inferx' : 'nvidia'];
  const own = new Set(Object.values(mine));
  const other = new Set(Object.values(theirs));
  // The InfiniBand variants are shared, so only flag a part that belongs
  // exclusively to the other stack's set.
  const wrong = [...new Set(bom.rows.map((r) => r.optic))].filter((k) => other.has(k) && !own.has(k));
  check(`${pk}: quotes no part from the other stack's BOM`, wrong, []);
}

console.log('--- the bill of materials reconciles with the facility roll-up ---');
for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
  const nk = prof.defaultNode;
  const n = prof.stack === 'nvidia' ? Math.max(prof.minGpuNodes, prof.unit === 'rack' ? 2 : 8) : 8;
  const f = size(pk, n);
  const r = E.sizeInference({ fixedNodes: n, modelKey: 'llama31-70b', precisionKey: 'fp8', nodeKey: nk,
    concurrentRequests: 1000, promptTokens: 2048, outputTokens: 512, tpotTargetMs: 50, ttftTargetMs: 1000, tpOverride: null, customModel: null });
  const bom = E.hardwareBOM({ r, fac: f, weka });
  // Summing the lines that count must give the facility card's own totals, or
  // the spreadsheet a buyer works from disagrees with the page they saw.
  check(`${pk}: BOM power = facility total (${(f.power.totalW / 1000).toFixed(1)} kW)`, Math.round(bom.totalW), Math.round(f.power.totalW));
  check(`${pk}: BOM weight = facility total (${f.weight.totalKg.toFixed(0)} kg)`, Math.round(bom.totalKg), Math.round(f.weight.totalKg));
  const bad = bom.rows.filter((x) => !x.item || x.qty == null || x.qty < 0);
  check(`${pk}: every BOM line has an item and a quantity`, bad.map((x) => x.item || '(blank)'), []);
}

console.log('--- catalogue sanity: no optic above 800G, every part numbered ---');
{
  const over = Object.entries(E.OPTICS).filter(([, o]) => /1600G|1\.6T/.test(o.label));
  check('no optic is quoted above 800G', over.map(([k]) => k), []);
  const unnumbered = Object.entries(E.OPTICS).filter(([, o]) => !o.pn);
  check('every optic carries a part number', unnumbered.map(([k]) => k), []);
  // Dense tensor rates follow the tensor-core ladder, and a figure left at its
  // sparsity rate by mistake breaks it. FP8 is always twice BF16. FP4 is twice
  // FP8 on Blackwell and on Ada, and three times FP8 on Blackwell Ultra, whose
  // whole point is the NVFP4 uplift: NVIDIA's 8-GPU HGX columns give B200
  // 72 PFLOPS dense FP4 against B300's 108, on an unchanged 36 PFLOPS FP8.
  // The tolerance is deliberately loose: this is here to catch a rate left at
  // its sparsity figure, which would be out by 100%, not to police NVIDIA's
  // own rounding (the L40S publishes 362.05 dense BF16 against 733 dense FP8,
  // a ratio of 2.02 rather than exactly 2).
  const off = (v, want) => Math.abs(v / want - 1) > 0.05;
  const fp8Ladder = Object.entries(E.GPUS)
    .filter(([, g]) => off(g.denseTFLOPS.fp8 / g.denseTFLOPS.bf16, 2));
  check('dense FP8 is ~2x BF16 on every part', fp8Ladder.map(([k]) => k), []);
  const fp4Ladder = Object.entries(E.GPUS).filter(([, g]) => g.denseTFLOPS.fp4)
    .filter(([, g]) => off(g.denseTFLOPS.fp4 / g.denseTFLOPS.fp8, g.arch === 'Blackwell Ultra' ? 3 : 2));
  check('dense FP4 is ~2x FP8 (3x on Blackwell Ultra) on every part', fp4Ladder.map(([k]) => k), []);
  const noSrc = Object.entries(E.GPUS).filter(([, g]) => !g.src).map(([k]) => k)
    .concat(Object.entries(E.GPU_NODES).filter(([, g]) => !g.src).map(([k]) => k))
    .concat(Object.entries(E.FABRIC).filter(([, g]) => !g.src).map(([k]) => k));
  check('every GPU, node and switch record cites a source', noSrc, []);
}

console.log('--- layouts build and plan for every profile ---');
for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
  for (const nk of prof.nodes) {
    const n = prof.stack === 'nvidia' ? Math.max(prof.minGpuNodes, prof.unit === 'rack' ? 2 : 8) : 8;
    const f = E.sizeFacility({ gpuNodes: n, nodeKey: nk, coolingKey: prof.defaultCooling || (E.GPU_NODES[nk].defaultCooling || 'air'), profileKey: pk, storageNodes: 8, storagePodKey: 'nitro-155' });
    const L = E.buildRALayout(f, { gpuNodes: n });
    const plan = E.RARack.planLinks(L.racks, f.fabric);
    const over = L.racks.filter((rk) => rk.devices.some((d) => d.uTop - d.ru + 1 < 1 || d.uTop > E.RACK.totalU));
    check(`${pk} / ${nk}: ${L.racks.length} racks fit ${E.RACK.totalU}U`, over.map((rk) => rk.name), []);
    if (!plan.roles.ew.leaves) { fails++; console.log(`FAIL ${pk} / ${nk}: no east-west leaves in the plan`); }
  }
}

/* ---------- configurable server specifications ----------
   The contract the platform step rests on: an untouched configuration is the
   reference architecture's own build, so it has to reproduce the record it
   came from exactly — otherwise every elevation, roll-up and BOM above this
   line would drift the moment the file loaded. The rest checks that the
   option lists are physically buildable, that aligning to a guideline
   actually satisfies it, and that a changed build flows into the facility. */
console.log('--- server specifications: defaults reproduce the reference build ---');
for (const [rk, role] of Object.entries(E.SERVER_ROLES)) {
  const rec = role.kind === 'gpu' ? E.GPU_NODES[role.key] : E.INFRA[role.key];
  const sp = E.serverSpec(rk);
  check(`${rk}: default draw and weight match the record`, [sp.watts, sp.weightKg], [rec.watts, rec.weightKg]);
  if (role.fixed) continue;
  // Every part a role names has to exist, sit in the socket the chassis has
  // and fit the bay it goes in.
  const sockets = Object.keys(role.cpu.platforms || {});
  const badCpu = role.cpu.options.filter((k) => !E.SERVER_PARTS.cpu[k] || !sockets.includes(E.SERVER_PARTS.cpu[k].socket));
  const badMem = role.mem.options.filter((k) => !E.SERVER_PARTS.dimm[k]);
  const badBoot = role.boot.options.filter((k) => !E.SERVER_PARTS.boot[k] || !['any', role.boot.form].includes(E.SERVER_PARTS.boot[k].form));
  const badData = role.data.options.filter((k) => !E.SERVER_PARTS.data[k] || !['any', role.data.form].includes(E.SERVER_PARTS.data[k].form));
  check(`${rk}: every option exists and fits the chassis`, [badCpu, badMem, badBoot, badData], [[], [], [], []]);
  const d = E.serverDefaults(rk);
  const inList = [role.cpu.options.includes(d.cpu), role.mem.options.includes(d.dimm),
    role.boot.options.includes(d.boot), role.data.options.includes(d.data)];
  check(`${rk}: the default build is in its own option lists`, inList, [true, true, true, true]);
  check(`${rk}: the default build fits the chassis`,
    [d.dimmQty <= E.memSlots(role, d.cpu), d.bootQty <= role.boot.bays, d.dataQty <= role.data.bays], [true, true, true]);
  // A board's DIMM slots belong to its socket, so every platform a role offers
  // has to state how many it has and be able to hold a legal population.
  Object.keys(role.cpu.platforms).forEach((sock) => {
    const part = (role.cpu.options || []).find((k) => E.SERVER_PARTS.cpu[k].socket === sock);
    if (!part) return;
    const slots = E.memSlots(role, part);
    const ch = E.memChannels(sock) * role.cpu.sockets;
    check(`${rk}/${sock}: ${slots} DIMM slots hold a whole number of ${ch}-channel populations`,
      slots % ch === 0, true);
  });
}

console.log('--- server specifications: build totals agree with the node catalogue ---');
for (const [rk, role] of Object.entries(E.SERVER_ROLES)) {
  if (role.fixed || role.kind !== 'gpu') continue;
  const rec = E.GPU_NODES[role.key];
  const sp = E.serverSpec(rk);
  const parts = E.SERVER_PARTS;
  if (rec.cpuCores) check(`${rk}: cores match GPU_NODES.cpuCores`, sp.cores, rec.cpuCores);
  if (rec.ramGB) check(`${rk}: memory matches GPU_NODES.ramGB`, sp.ramGB, rec.ramGB);
  // The InferX chassis records are a built system, so the part sizes match.
  // The NVIDIA RA records carry the RA's published minimum instead, so the
  // build only has to clear it.
  if (role.stack === 'inferx') {
    check(`${rk}: boot device matches GPU_NODES.bootGB`, parts.boot[sp.cfg.boot].gb, rec.bootGB);
    check(`${rk}: data cache matches GPU_NODES.localTB`, sp.dataGB / 1000, rec.localTB);
  } else {
    check(`${rk}: build clears the RA minimum boot and data cache`,
      [parts.boot[sp.cfg.boot].gb * sp.cfg.bootQty >= rec.bootGB, sp.dataGB / 1000 >= rec.localTB], [true, true]);
  }
}

console.log('--- server specifications: the InferX build against the NVIDIA guideline ---');
/* The InferX RA BOM builds its management stack on two 24-core EPYC 9254s and
   a mirrored pair of 480 GB boot devices. NVIDIA's Enterprise RA Table 3 asks
   for two 32-core processors and 1 TB of boot. The gap is real and is reported
   rather than quietly closed, so it is pinned here: if the BOM defaults ever
   change, this says so. */
for (const rk of ['platform-server', 'platform-router', 'cpu-node']) {
  const sp = E.serverSpec(rk);
  check(`${rk}: reference build is ${sp.cores} cores / ${sp.bootGB} GB boot, below RA Table 3`,
    sp.checks.filter((c) => c.level === 'warning').map((c) => c.what).sort(), ['boot', 'cores']);
}
check('tier2: no NVIDIA guideline publishes a block-storage node specification',
  E.SPEC_GUIDES[E.SERVER_ROLES.tier2.guide].cores, undefined);

console.log('--- server specifications: aligning satisfies the guideline ---');
for (const [rk, role] of Object.entries(E.SERVER_ROLES)) {
  if (role.fixed || !role.guide || !E.SPEC_GUIDES[role.guide].cores) continue;
  const cfg = E.alignToGuide(rk);
  if (cfg) E.SERVER_CONFIG[rk] = cfg;
  const sp = E.serverSpec(rk);
  check(`${rk}: aligned build meets ${E.SPEC_GUIDES[role.guide].name}`,
    sp.checks.filter((c) => c.level !== 'info').map((c) => c.what), []);
  // Aligning takes NVIDIA's own named processor where the socket accepts it.
  const g = E.SPEC_GUIDES[role.guide];
  const named = role.cpu.options.filter((k) => E.SERVER_PARTS.cpu[k].nvRec
    && E.SERVER_PARTS.cpu[k].cores * role.cpu.sockets >= g.cores);
  if (named.length && E.serverDefaults(rk).cpu !== cfg.cpu) {
    check(`${rk}: aligning chose the processor the RA names`, named.includes(cfg.cpu), true);
  }
}

console.log('--- server specifications: a changed build flows into the facility ---');
{
  const dflt = {};
  Object.keys(E.SERVER_CONFIG).forEach((k) => { dflt[k] = E.SERVER_CONFIG[k]; delete E.SERVER_CONFIG[k]; });
  const facA = E.sizeFacility({ gpuNodes: 8, nodeKey: 'smc-b300', coolingKey: 'air', profileKey: 'core', storageNodes: 8, storagePodKey: 'nitro-155' });
  check('management rack at the reference build is the RA elevation', facA.power.mgmtW, E.RACK.mgmtRack.watts);

  Object.assign(E.SERVER_CONFIG, dflt);
  const facB = E.sizeFacility({ gpuNodes: 8, nodeKey: 'smc-b300', coolingKey: 'air', profileKey: 'core', storageNodes: 8, storagePodKey: 'nitro-155' });
  // Seven of the twelve devices in the management rack are configurable roles.
  const perDevice = E.SERVER_ROLES['platform-server'] && (E.serverSpec('platform-server').deltaW);
  const expect = E.RACK.mgmtRack.contents.reduce((a, k) =>
    a + (E.SERVER_ROLES[k] ? E.serverSpec(k).watts - E.INFRA[k].watts : 0), 0);
  check('management rack moves by exactly the sum of its servers\' deltas',
    facB.power.mgmtW - facA.power.mgmtW, expect);
  check('an aligned management stack draws more than the reference one', facB.power.mgmtW > facA.power.mgmtW, true);

  const inf = E.sizeInference({ fixedNodes: 8, modelKey: 'llama31-70b', precisionKey: 'fp8', nodeKey: 'smc-b300',
    concurrentRequests: 1000, promptTokens: 2048, outputTokens: 512, tpotTargetMs: 50, ttftTargetMs: 1000, tpOverride: null, customModel: null });
  const bom = E.hardwareBOM({ r: inf, fac: facB, weka });
  check('BOM still reconciles with the facility under a changed build',
    [bom.totalW, Math.round(bom.totalKg * 100)], [facB.power.totalW, Math.round(facB.weight.totalKg * 100)]);

  Object.keys(E.SERVER_CONFIG).forEach((k) => delete E.SERVER_CONFIG[k]);
  const facC = E.sizeFacility({ gpuNodes: 8, nodeKey: 'smc-b300', coolingKey: 'air', profileKey: 'core', storageNodes: 8, storagePodKey: 'nitro-155' });
  check('resetting the configuration returns the facility to the RA figures',
    [facC.power.totalW, facC.weight.totalKg], [facA.power.totalW, facA.weight.totalKg]);
}

console.log('--- server specifications: connectivity ---');
/* Every server has to reach the networks its role sits on, and the north-south
   port counts the roles declare have to be the ones the fabric is sized from,
   or the leaf budget and the cable schedule would disagree with the drawing. */
for (const [rk, role] of Object.entries(E.SERVER_ROLES)) {
  const sp = E.serverSpec(rk);
  const fabrics = new Set(sp.nets.map((n) => n.fabric));
  check(`${rk}: has an out-of-band path`, fabrics.has('oob') || fabrics.has('bmc'), true);
  const rec = role.kind === 'gpu' ? E.GPU_NODES[role.key] : E.INFRA[role.key];
  if (rec.nsPorts) {
    const ns = sp.nets.filter((n) => n.fabric === 'ns');
    check(`${rk}: north-south ports match the fabric record`,
      [ns.reduce((a, n) => a + n.totalPorts, 0), Math.max(...ns.map((n) => n.gb))],
      [rec.nsPorts, rec.nsPortGb]);
  }
  if (role.kind === 'gpu' && rec.ewPortsPerNode && !rec.rackScale) {
    const ew = sp.nets.filter((n) => n.fabric === 'ew');
    check(`${rk}: east-west ports match the fabric record`,
      [ew.reduce((a, n) => a + n.totalPorts, 0), Math.max(...ew.map((n) => n.gb))],
      [rec.ewPortsPerNode, rec.ewPortGb]);
  }
}

/* ---------- north-south endpoints: the fabric, the drawing and the BOM ----------
   Everything that lands on the converged north-south fabric has to be counted
   the same way in three places: the port budget the leaves are sized from, the
   cable plan the rear elevation draws, and the optics BOM. They disagreed in
   two directions at once — the NVIDIA branch reported the GPU nodes alone as
   `nsPorts` while the drawing cabled the control plane and the storage too,
   and the edge tier counted a WEKApod cluster everywhere but placed none of it
   in a rack — so every endpoint is reconciled here, per profile. */
console.log('--- north-south endpoints reconcile across the fabric, the layout and the drawing ---');
for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
  const nk = prof.defaultNode;
  const n = prof.stack === 'nvidia' ? Math.max(prof.minGpuNodes, prof.unit === 'rack' ? 2 : 32) : 8;
  const f = size(pk, n);
  const L = E.buildRALayout(f, { gpuNodes: n });
  const plan = E.RARack.planLinks(L.racks, f.fabric);
  const fb = f.fabric;
  check(`${pk}: the drawing cables every north-south endpoint the fabric is sized for`,
    plan.roles.ns.sources, fb.nsPorts);
  check(`${pk}: the endpoint breakdown adds up`,
    fb.nsNodePorts + fb.nsMgmtPorts + fb.nsTier2Ports + fb.nsStoragePorts, fb.nsPorts);
  // Every storage node that was sized is a node that was placed.
  const placed = L.racks.reduce((a, rk) => a + rk.devices.filter((d) => d.type === 'wekapod').length, 0);
  check(`${pk}: every storage node sized is a storage node drawn`, placed, f.storage.nodes);
  // The management/control-plane rack's own share, from the devices the
  // layout actually gives a DPU to.
  const mgmtRack = L.racks.find((rk) => rk.kind === 'mgmt');
  const drawn = mgmtRack ? mgmtRack.devices.reduce((a, d) => a + (d.nsPorts || 0), 0) : 0;
  check(`${pk}: the management rack draws its ${fb.nsMgmtPorts} north-south ports`, drawn, fb.nsMgmtPorts);
}

console.log('--- the control plane carries the adapter its own RA specifies ---');
/* A single hard-coded BlueField-3 B3220 was wrong on two of the three NVIDIA
   stacks: the NVL72 RA's management node has four ConnectX-7 200G, and
   RA-11337-001 quotes a 400G transceiver for its control-plane nodes
   (980-9I51S-F4NS00) that is a different part from the BlueField-3's
   (980-9I693-F4NS00). */
for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
  if (prof.stack !== 'nvidia') continue;
  const cp = prof.controlPlane;
  check(`${pk}: the control-plane node names an adapter`, !!cp.nsAdapter, true);
  const f = size(pk, Math.max(prof.minGpuNodes, prof.unit === 'rack' ? 2 : 32));
  const L = E.buildRALayout(f, { gpuNodes: Math.max(prof.minGpuNodes, prof.unit === 'rack' ? 2 : 32) });
  const node = L.racks.flatMap((rk) => rk.devices).find((d) => /Control-plane node/.test(d.name || ''));
  check(`${pk}: the elevation labels it with that adapter`, node && node.dpu, cp.nsAdapter);
  // The port speed the RA states and the adapter named for it must agree.
  const gb = /200G/.test(cp.nsAdapter) ? 200 : /400G/.test(cp.nsAdapter) ? 400 : null;
  if (gb) check(`${pk}: adapter speed matches the RA's port speed`, cp.nsGb, gb);
  E.setServerContext(pk);
  const sp = E.serverSpec('cp-node');
  const ns = sp.nets.filter((x) => x.fabric === 'ns');
  check(`${pk}: the platform step shows the same ports and speed`,
    [ns.reduce((a, x) => a + x.totalPorts, 0), Math.max(...ns.map((x) => x.gb))],
    [cp.nsPorts, cp.nsGb]);
}
E.setServerContext(null);

console.log('--- processor options: the whole range, inside the RA and inside the chassis ---');
/* NVIDIA's reference architectures specify a minimum per socket, not a vendor,
   so a role offers every part its chassis families take and marks which side
   of that minimum each falls on. These check the offer is buildable: a part in
   a socket the chassis has, within its thermal envelope, and a grouping that
   accounts for every option exactly once. */
for (const [rk, role] of Object.entries(E.SERVER_ROLES)) {
  if (role.fixed) continue;
  const groups = E.cpuGroups(role);
  const keys = groups.flatMap((g) => g.keys);
  check(`${rk}: the grouping lists each option once`, keys.length, new Set(keys).size);
  const overW = keys.filter((k) => role.cpu.maxW && E.SERVER_PARTS.cpu[k].w > role.cpu.maxW && k !== role.cpu.def);
  check(`${rk}: no part above the chassis's ${role.cpu.maxW} W ceiling`, overW, []);
  check(`${rk}: the reference build is offered`, keys.includes(role.cpu.def), true);
  // Two-socket roles must not be offered single-socket-only parts. The P
  // suffix means single-socket on AMD (9354P) but P-core on Intel Xeon 6
  // (6767P), which is two-socket capable, so this is an AMD-only rule.
  check(`${rk}: no single-socket-only EPYC in a ${role.cpu.sockets}-socket role`,
    keys.filter((k) => k.startsWith('epyc-') && /P$/.test(E.SERVER_PARTS.cpu[k].label)), []);
  // Options are grouped by vendor first and then by whether the part satisfies
  // the reference architecture, because a reader is choosing a platform before
  // a core count and an HTML select cannot nest its groups.
  check(`${rk}: every option is grouped under its own vendor`,
    groups.filter((g) => g.keys.some((k) => E.cpuVendor(k) !== g.vendor)).map((g) => g.label), []);
  check(`${rk}: the vendors offered are the vendors its chassis families have`,
    [...new Set(groups.map((g) => g.vendor))].sort(),
    [...new Set(Object.keys(role.cpu.platforms).map((sk) => E.cpuVendor(
      (role.cpu.options || []).find((k) => E.SERVER_PARTS.cpu[k].socket === sk) || '')))].sort());
  const min = E.guideCoresPerSocket(role);
  if (min) {
    check(`${rk}: every "meets the RA" group clears ${min} cores per socket`,
      groups.filter((g) => g.within).flatMap((g) => g.keys).filter((k) => E.SERVER_PARTS.cpu[k].cores < min), []);
    check(`${rk}: every "below" group falls short of ${min}`,
      groups.filter((g) => g.within === false).flatMap((g) => g.keys).filter((k) => E.SERVER_PARTS.cpu[k].cores >= min), []);
    // Every platform a role offers must have a part that satisfies the RA,
    // or offering that platform would be offering a dead end.
    const okVendors = new Set(groups.filter((g) => g.within).map((g) => g.vendor));
    Object.keys(role.cpu.platforms).forEach((sock) => {
      const want = E.cpuVendor((role.cpu.options || []).find((k) => E.SERVER_PARTS.cpu[k].socket === sock) || '');
      check(`${rk}: the ${want} platform has a part that meets the RA`, okVendors.has(want), true);
    });
  }
  // The chassis named follows the socket of the part fitted.
  Object.entries(role.cpu.platforms).forEach(([sock, name]) => {
    const part = keys.find((k) => E.SERVER_PARTS.cpu[k].socket === sock);
    if (part) check(`${rk}: a ${sock} part names the ${sock} chassis`, E.roleChassis(role, part), name);
  });
}

console.log('--- the AMD EPYC range is complete and two-socket-capable ---');
{
  const epyc = Object.entries(E.SERVER_PARTS.cpu).filter(([k]) => k.startsWith('epyc-'));
  check('every EPYC part is Socket SP5', epyc.filter(([, c]) => c.socket !== 'sp5').map(([k]) => k), []);
  check('every EPYC part carries cores, threads, clock and TDP',
    epyc.filter(([, c]) => !(c.cores > 0 && c.threads >= c.cores && c.ghz > 0 && c.w > 0)).map(([k]) => k), []);
  // The families the SP5 platform actually ships.
  const gens = [...new Set(epyc.map(([, c]) => c.gen))].sort();
  check('all five SP5 families are represented', gens, ['Bergamo', 'Genoa', 'Genoa-X', 'Turin', 'Turin Dense']);
  // Core counts the RAs care about: something at or above every guideline.
  [32, 48, 56, 64, 96, 128].forEach((n) => {
    check(`an EPYC part offers at least ${n} cores per socket`, epyc.some(([, c]) => c.cores >= n), true);
  });
  // The two parts the InferX BOM and the Enterprise RA name by model.
  ['epyc-9254', 'epyc-9554', 'epyc-9354'].forEach((k) => check(`${k} is in the catalogue`, !!E.SERVER_PARTS.cpu[k], true));
  check('the Enterprise RA\'s named EPYC is flagged as such', E.SERVER_PARTS.cpu['epyc-9354'].nvRec, true);
}

console.log('--- processor catalogue against the vendors\' own data sheets ---');
/* Spot values transcribed from AMD's EPYC 9004 and 9005 Series Processors data
   sheets and Intel ARK. An audit found a fabricated SKU in this table (an
   "EPYC 9635", which AMD does not make — the 96-core Turin parts are the 9655
   and the 9645), a wrong base clock and a Xeon Gold listed as a Silver, so the
   figures are pinned rather than trusted. */
{
  const CPU = {
    // model: [cores, threads, base GHz, default TDP]
    'epyc-9015': [8, 16, 3.6, 125], 'epyc-9115': [16, 32, 2.6, 125], 'epyc-9135': [16, 32, 3.65, 200],
    'epyc-9175f': [16, 32, 4.2, 320], 'epyc-9255': [24, 48, 3.2, 200], 'epyc-9275f': [24, 48, 4.1, 320],
    'epyc-9335': [32, 64, 3.0, 210], 'epyc-9355': [32, 64, 3.55, 280], 'epyc-9375f': [32, 64, 3.8, 320],
    'epyc-9365': [36, 72, 3.4, 300], 'epyc-9455': [48, 96, 3.15, 300], 'epyc-9475f': [48, 96, 3.65, 400],
    'epyc-9535': [64, 128, 2.4, 300], 'epyc-9555': [64, 128, 3.2, 360], 'epyc-9575f': [64, 128, 3.3, 400],
    'epyc-9565': [72, 144, 3.15, 400], 'epyc-9645': [96, 192, 2.3, 320], 'epyc-9655': [96, 192, 2.6, 400],
    'epyc-9745': [128, 256, 2.4, 400], 'epyc-9755': [128, 256, 2.7, 500],
    'epyc-9825': [144, 288, 2.2, 390], 'epyc-9845': [160, 320, 2.1, 390], 'epyc-9965': [192, 384, 2.25, 500],
    'epyc-9124': [16, 32, 3.0, 200], 'epyc-9174f': [16, 32, 4.1, 320], 'epyc-9184x': [16, 32, 3.55, 320],
    'epyc-9224': [24, 48, 2.5, 200], 'epyc-9254': [24, 48, 2.9, 200], 'epyc-9274f': [24, 48, 4.05, 320],
    'epyc-9334': [32, 64, 2.7, 210], 'epyc-9354': [32, 64, 3.25, 280], 'epyc-9374f': [32, 64, 3.85, 320],
    'epyc-9384x': [32, 64, 3.1, 320], 'epyc-9454': [48, 96, 2.75, 290], 'epyc-9474f': [48, 96, 3.6, 360],
    'epyc-9534': [64, 128, 2.45, 280], 'epyc-9554': [64, 128, 3.1, 360], 'epyc-9634': [84, 168, 2.25, 290],
    'epyc-9654': [96, 192, 2.4, 360], 'epyc-9684x': [96, 192, 2.55, 400],
    'epyc-9734': [112, 224, 2.2, 340], 'epyc-9754': [128, 256, 2.25, 360], 'epyc-9754s': [128, 128, 2.25, 360],
    'xeon-4510': [12, 24, 2.4, 150], 'xeon-4516y': [24, 48, 2.2, 185], 'xeon-5416s': [16, 32, 2.0, 150],
    'xeon-6430': [32, 64, 2.1, 270], 'xeon-6448y': [32, 64, 2.1, 225], 'xeon-6530': [32, 64, 2.1, 270],
    'xeon-6542y': [24, 48, 2.9, 250], 'xeon-8480': [56, 112, 2.0, 350], 'xeon-8592': [64, 128, 1.9, 350],
    'xeon-6767p': [64, 128, 2.4, 350], 'xeon-6776p': [64, 128, 2.3, 350], 'xeon-6787p': [86, 172, 2.0, 350],
    'xeon-6960p': [72, 144, 2.7, 500], 'xeon-6980p': [128, 256, 2.0, 500],
  };
  const wrong = [];
  for (const [k, want] of Object.entries(CPU)) {
    const c = E.SERVER_PARTS.cpu[k];
    if (!c) { wrong.push(`${k} missing`); continue; }
    if (c.cores !== want[0] || c.threads !== want[1] || c.ghz !== want[2] || c.w !== want[3]) {
      wrong.push(`${k} is [${c.cores},${c.threads},${c.ghz},${c.w}] not [${want}]`);
    }
  }
  check('every processor matches its data-sheet figures', wrong, []);
  // Nothing in the catalogue that is not in the pinned table — that is how a
  // fabricated part number gets in.
  check('no processor in the catalogue is unaccounted for',
    Object.keys(E.SERVER_PARTS.cpu).filter((k) => !(k in CPU)), []);
  // Every part but the no-SMT Bergamo runs two threads per core.
  check('thread count is twice the core count except on the no-SMT part',
    Object.entries(E.SERVER_PARTS.cpu).filter(([k, c]) => c.threads !== c.cores * 2 && k !== 'epyc-9754s').map(([k]) => k), []);
  check('the labels name the vendor and model', Object.values(E.SERVER_PARTS.cpu)
    .filter((c) => !/^(AMD EPYC|Intel Xeon) /.test(c.label)).map((c) => c.label), []);
}

console.log('--- capacity is counted the way the vendor counts it ---');
{
  // A mirrored boot pair is one device's worth of capacity, not two.
  const r = E.SERVER_ROLES['platform-server'];
  check('a mirrored boot pair counts once', E.bootUsable(r, { gb: 480 }, 2), 480);
  check('an unmirrored pair counts twice',
    E.bootUsable({ boot: {} }, { gb: 480 }, 2), 960);
  check('the InferX platform server has 480 GB of usable boot', E.serverSpec('platform-server').bootGB, 480);
  // Capacity ladders rise monotonically with capacity, and so does power.
  for (const kind of ['dimm', 'boot', 'data']) {
    const parts = Object.entries(E.SERVER_PARTS[kind]).filter(([, p]) => p.gb > 0)
      .sort((a, b) => a[1].gb - b[1].gb);
    const byForm = {};
    parts.forEach(([k, p]) => { (byForm[p.form || 'dimm'] = byForm[p.form || 'dimm'] || []).push([k, p]); });
    for (const [form, list] of Object.entries(byForm)) {
      const drops = list.filter(([, p], i) => i && p.w < list[i - 1][1].w).map(([k]) => k);
      check(`${kind}/${form}: power does not fall as capacity rises`, drops, []);
    }
  }
}

console.log('--- tensor parallelism is charged for what it crosses ---');
/* The results page tells the reader that tensor parallelism inside an NVLink
   domain costs less than tensor parallelism that leaves it. The arithmetic
   used to charge the NVLink rate for every doubling however wide the group
   grew, which made that sentence untrue on an 8-GPU chassis. */
{
  const run = (nodeKey, modelKey, precisionKey) => E.sizeInference({
    fixedNodes: 8, modelKey, precisionKey, nodeKey, concurrentRequests: 1000,
    promptTokens: 2048, outputTokens: 512, tpotTargetMs: 50, ttftTargetMs: 1000, tpOverride: null, customModel: null });
  check('a fabric hop costs more than an NVLink hop',
    E.SERVING.tpScalingLossFabric > E.SERVING.tpScalingLoss, true);
  check('a PCIe hop inside a chassis costs less than a fabric hop between them',
    E.SERVING.tpScalingLossPcie < E.SERVING.tpScalingLossFabric, true);
  // A group that fits one chassis and one that spills over it must not be
  // charged at the same per-doubling rate.
  const inside = run('smc-h200', 'llama31-70b', 'fp16');
  const across = run('smc-h200', 'deepseek-v3', 'fp16');
  if (inside.tp && across.tp > 8) {
    check(`TP-${across.tp} on an 8-GPU chassis crosses the fabric and is derated for it`,
      across.tp > E.GPU_NODES['smc-h200'].gpuCount, true);
  }
  // Every model and precision still produces finite, non-negative numbers.
  const bad = [];
  for (const mk of Object.keys(E.MODELS)) for (const pk of Object.keys(E.PRECISIONS)) {
    for (const nk of ['smc-b300', 'smc-h200', 'smc-l40s', 'nv-gb300-nvl72']) {
      const r = run(nk, mk, pk);
      if (r.error) continue;
      for (const f of ['tp', 'batch', 'clusterTps', 'perUserTps', 'ttftMs', 'tpotMs'])
        if (!isFinite(r[f]) || r[f] < 0) bad.push(`${mk}/${pk}/${nk}.${f}=${r[f]}`);
    }
  }
  check('every model and precision sizes to finite figures on every node', bad, []);
}

console.log('--- what the facility buys is what the elevation draws ---');
/* Three ways the roll-up and the drawing came apart, all found by comparing
   them across the whole size range rather than at one design point:
   the facility reserved units at the top of a fabric rack that the drawing
   then filled, so a design was costed for a rack more than it drew; the InferX
   management rack drew an out-of-band pair that the fabric rack also drew, so
   the elevation held two switches nothing had bought; and the edge tier, which
   has no fabric rack, drew its leaves past the bottom of the management rack
   instead of opening one. */
{
  const racks = [], switches = [], overflow = [], pods = [];
  let tested = 0;
  for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
    for (const nk of prof.nodes) {
      const cools = Object.keys(E.RACK.cooling)
        .filter((k) => (E.RACK.cooling[k].sets || ['inferx']).includes(prof.coolingSet || 'inferx'));
      for (const n of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]) {
        if (prof.unit === 'rack' && n > 32) continue;
        // Storage sizes chosen to straddle the points where a rack fills.
        for (const st of [8, 16, 24, 32, 41, 48, 64, 81, 130, 200]) {
          for (const cool of cools) {
            const f = E.sizeFacility({ gpuNodes: n, nodeKey: nk, coolingKey: cool, profileKey: pk, storageNodes: st, storagePodKey: 'nitro-155' });
            const L = E.buildRALayout(f, { gpuNodes: n });
            tested++;
            const at = `${pk}/${nk}/${n}/${cool}/st${st}`;
            if (f.totalRacks !== L.racks.length) racks.push(`${at}: buys ${f.totalRacks}, draws ${L.racks.length}`);
            const drawnPods = L.racks.reduce((a, rk) => a + rk.devices.filter((d) => d.type === 'wekapod').length, 0);
            if (drawnPods !== f.storage.nodes) pods.push(`${at}: sizes ${f.storage.nodes}, draws ${drawnPods}`);
            const fb = f.fabric;
            const want = { ew: fb.ewLeaves + fb.ewSpines, ns: fb.nsLeaves + fb.nsSpines, oob: fb.oobLeaves + fb.oobSpines + (fb.oobRackLeaves || 0) };
            const got = { ew: 0, ns: 0, oob: 0 };
            L.racks.forEach((rk) => rk.devices.forEach((d) => { if (d.type === 'switch') got[d.role] = (got[d.role] || 0) + 1; }));
            for (const role of ['ew', 'ns', 'oob'])
              if (want[role] !== got[role]) switches.push(`${at} ${role}: buys ${want[role]}, draws ${got[role]}`);
            const over = L.racks.filter((rk) => rk.devices.some((d) => d.uTop - d.ru + 1 < 1 || d.uTop > E.RACK.totalU));
            if (over.length) overflow.push(`${at}: ${over.map((rk) => rk.name).join(', ')}`);
          }
        }
      }
    }
  }
  console.log(`info ${tested} configurations swept: profile x node x size x cooling x storage`);
  check('the rack count bought equals the rack count drawn', racks.slice(0, 5), []);
  check('every switch bought is drawn exactly once', switches.slice(0, 5), []);
  check('every storage node sized is drawn', pods.slice(0, 5), []);
  check('nothing is drawn outside the rack', overflow.slice(0, 5), []);
}

console.log('--- the management rack lists what it draws ---');
{
  const f = size('core', 8, 'air');
  const L = E.buildRALayout(f, { gpuNodes: 8 });
  const mg = L.racks.find((rk) => rk.kind === 'mgmt');
  const drawn = mg.devices.filter((d) => d.type !== 'switch');
  check('every device in the elevation is in RACK.mgmtRack.contents',
    drawn.length, E.RACK.mgmtRack.contents.length);
  check('every entry in contents has a record',
    E.RACK.mgmtRack.contents.filter((k) => !E.INFRA[k]), []);
  // Completing that list must not have moved the published elevation.
  check('the published elevation is unchanged', [f.power.mgmtW, f.mgmt.weightKg], [7826, 187.18]);
  // Passive rack positions present no management interface, so they are not
  // charged an out-of-band pair; everything else is.
  const passive = E.RACK.mgmtRack.contents.filter((k) => E.INFRA[k].oobPorts === 0);
  check('the patch panel and media converter are the only passive positions', passive.sort(), ['converter', 'patch']);
  check('the rack\'s out-of-band ports are counted per device',
    f.mgmt.oobPorts, E.RACK.mgmtRack.contents.reduce((a, k) => a + (E.INFRA[k].oobPorts != null ? E.INFRA[k].oobPorts : 2), 0));
}

console.log('--- the control-plane count is a choice that starts at the RA\'s ---');
/* How many control-plane nodes a design runs is a sizing decision, not a
   fixture: on the NVIDIA stacks it starts at the count the reference
   architecture recommends, and on the InferX tiers the same role is the CPU
   compute node, which the RA elevation has two of. Changing it has to move
   power, north-south ports and the elevation together, and never past what the
   rack holds. */
{
  const bad = [];
  const sizeWith = (pk, nk, cool, n) => {
    const f = E.sizeFacility({ gpuNodes: n, nodeKey: nk, coolingKey: cool, profileKey: pk, storageNodes: 8, storagePodKey: 'nitro-155' });
    return { f, L: E.buildRALayout(f, { gpuNodes: n }) };
  };
  for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
    const nk = prof.defaultNode;
    const n = prof.stack === 'nvidia' ? Math.max(prof.minGpuNodes, prof.unit === 'rack' ? 2 : 32) : 8;
    const cool = prof.defaultCooling || (E.GPU_NODES[nk].defaultCooling || 'air');
    const role = prof.stack === 'nvidia' ? 'cp-node' : 'cpu-node';
    E.setServerContext(pk);
    const b = E.roleCountBounds(role);
    // The default is the reference architecture's own recommendation.
    const want = prof.stack === 'nvidia' ? prof.controlPlane.count : E.RACK.mgmtRack.cpuNodes;
    check(`${pk}: ${role} starts at the ${want} the reference architecture states`, b.def, want);
    check(`${pk}: the floor is a high-availability pair or none`, b.min <= 2, true);

    const base = sizeWith(pk, nk, cool, n);
    const unit = prof.stack === 'nvidia' ? base.f.mgmt.watts / base.f.mgmt.cpCount : E.INFRA['cpu-node'].watts;
    for (const c of [b.min, b.def, Math.min(b.max, b.def + 4), b.max, b.max + 5]) {
      E.SERVER_COUNTS[role] = c;
      const got = E.roleCountOf(role);
      const { f, L } = sizeWith(pk, nk, cool, n);
      const at = `${pk}/${role}=${c}`;
      if (got !== Math.max(b.min, Math.min(b.max, c))) bad.push(`${at}: clamped to ${got}`);
      const drawnName = prof.stack === 'nvidia' ? /Control-plane node/ : /CPU compute node/;
      const mg = L.racks.find((rk) => rk.kind === 'mgmt');
      const drawn = mg.devices.filter((d) => drawnName.test(d.name || '')).length;
      if (drawn !== got) bad.push(`${at}: runs ${got}, draws ${drawn}`);
      // Nothing may overlap or fall outside the rack at any count.
      const over = mg.devices.some((d) => d.uTop - d.ru + 1 < 1 || d.uTop > E.RACK.totalU);
      const clash = mg.devices.some((a, i) => mg.devices.some((x, j) => j > i
        && !(a.uTop < x.uTop - x.ru + 1 || x.uTop < a.uTop - a.ru + 1)));
      if (over) bad.push(`${at}: outside the rack`);
      if (clash) bad.push(`${at}: devices overlap`);
      if (f.totalRacks !== L.racks.length) bad.push(`${at}: buys ${f.totalRacks} racks, draws ${L.racks.length}`);
      // Power and ports move with the count.
      if (prof.stack === 'nvidia' && Math.abs(f.mgmt.watts - got * unit) > 1) bad.push(`${at}: power does not scale`);
      if (f.mgmt.nsPorts % got !== 0 && prof.stack === 'nvidia') bad.push(`${at}: north-south ports do not scale`);
    }
    delete E.SERVER_COUNTS[role];
    // Back to the reference count, the published figures return exactly.
    const back = sizeWith(pk, nk, cool, n);
    if (back.f.power.mgmtW !== base.f.power.mgmtW) bad.push(`${pk}: clearing the count did not restore ${base.f.power.mgmtW} W`);
  }
  E.setServerContext(null);
  check('the count is adjustable, drawn, clamped and reversible on every profile', bad.slice(0, 6), []);
  // The InferX management rack at its reference count is still the elevation.
  E.setServerContext('core');
  check('the InferX rack at two CPU nodes is still the published elevation',
    size('core', 8, 'air').power.mgmtW, 7826);
  E.setServerContext(null);
}

console.log('--- no part describes a design it is not in ---');
/* The optics BOM's `role` column used to enumerate which node types across the
   whole catalogue used a part, which put "H200 east-west" in the cable
   schedule of a B300 design. A part is described by what it is; what it is
   doing in this design is the row's own note. */
{
  const names = Object.values(E.GPUS).map((g) => g.short).concat(['H100', 'A100', 'Hopper', 'Blackwell', 'Ada Lovelace']);
  const leaks = [];
  for (const [k, o] of Object.entries(E.OPTICS))
    for (const f of ['role', 'label'])
      for (const nm of names) if ((o[f] || '').includes(nm)) leaks.push(`OPTICS.${k}.${f} names ${nm}`);
  check('no transceiver or cable names a GPU model', leaks, []);
}

console.log('--- the control plane follows its own reference architecture ---');
for (const [pk, prof] of Object.entries(E.RA_PROFILES)) {
  if (prof.stack !== 'nvidia') continue;
  E.setServerContext(pk);
  const sp = E.serverSpec('cp-node');
  const want = prof.controlPlane.guide || 'ra-control-plane';
  check(`${pk}: the control-plane node is measured against ${want}`, E.roleGuide(E.SERVER_ROLES['cp-node']), want);
  check(`${pk}: its reference build meets that guideline`,
    sp.checks.filter((c) => c.level !== 'info').map((c) => c.what), []);
}
E.setServerContext(null);

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
