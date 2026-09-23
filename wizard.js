/* Guided sizing journey: compute -> networking -> storage -> results. */

const $w = (id) => document.getElementById(id);
const escW = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nfW = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const bigW = (n) => (n >= 1e6 ? `${nfW(n / 1e6, 2)}M` : n >= 1e3 ? `${nfW(n / 1e3, 1)}k` : nfW(n, 0));

const STEPS = ['Compute', 'Workload', 'Networking', 'Storage', 'Platform', 'Results'];
const WORKLOAD_STEP = 1;
const LAST_STEP = STEPS.length - 1;

/* The profile the compute step assumes when it is not asking for workload
   parameters. Chat-shaped: a 70B model at FP8, 2k in / 512 out, and a TPOT
   target of 50 ms — roughly 20 tokens/sec per user. */
const DEFAULT_WORKLOAD = {
  'w-model': 'llama31-70b', 'w-precision': 'fp8', 'w-conc': '1000',
  'w-prompt': '2048', 'w-out': '512', 'w-tpot': '50', 'w-ttft': '1000', 'w-tp': '',
};

let step = 0;
let STATE = null;
let rackView = 'front';

/* "node" or "NVL72 rack" — the purchasable unit of the chosen node record,
   so every label follows the track the sizing is on. */
const units = (node, n) => unitName(node, n);
const Units = (node, n) => { const u = units(node, n); return u.charAt(0).toUpperCase() + u.slice(1); };

/* The profile decides which nodes the node select offers: the InferX tiers
   list the InferX chassis, each NVIDIA reference architecture lists the node
   it is written for. The list is rebuilt when the profile changes, keeping
   the current node where the new profile still offers it. */
function syncNodeOptions(profile) {
  const sel = $w('w-node');
  const want = profile.nodes;
  const have = [...sel.options].map((o) => o.value);
  if (have.join() !== want.join()) {
    const keep = want.includes(sel.value) ? sel.value : profile.defaultNode;
    sel.innerHTML = want.map((k) => `<option value="${k}">${escW(GPU_NODES[k].sublabel)}</option>`).join('');
    sel.value = keep;
  }
  return GPU_NODES[sel.value];
}

/* The cooling select offers the profile's own set: air/DLC for the InferX
   chassis designs, four-per-rack air or DLC for the NVIDIA chassis RAs, the
   three DLC arrangements for a rack-scale system. The option list is rebuilt
   when the set changes, taking the profile's or node's default for the new
   list. */
function syncCoolingOptions(profile, node) {
  const sel = $w('w-cooling');
  const set = profile.coolingSet || 'inferx';
  const want = Object.keys(RACK.cooling).filter((k) => (RACK.cooling[k].sets || ['inferx']).includes(set));
  const have = [...sel.options].map((o) => o.value);
  if (have.join() !== want.join()) {
    sel.innerHTML = want.map((k) => `<option value="${k}">${escW(RACK.cooling[k].label)}</option>`).join('');
    sel.value = node.rackScale ? (node.defaultCooling || want[0]) : (profile.defaultCooling || want[0]);
  }
  if (!node.rackScale) {
    const lcOpt = sel.querySelector('option[value="liquid"]');
    if (lcOpt) {
      lcOpt.disabled = !node.liquidCapable;
      if (!node.liquidCapable && sel.value === 'liquid') sel.value = profile.defaultCooling || want[0];
    }
  }
  return sel.value;
}

/* The NVIDIA reference architectures fix the fabric — Spectrum-X Ethernet,
   non-blocking, twin-port 2 × 400G — so the networking controls are pinned
   to those values and locked while one is selected, and the engine sizes
   the fabric from the RA's own rules rather than from the controls. */
const RA_NET = { 'w-ewtech': 'ethernet', 'w-nstech': 'ethernet', 'w-ew': '1', 'w-ns': '1', 'w-breakout': '2' };
function syncNetworkLock(profile, node) {
  const locked = profile.stack === 'nvidia';
  Object.entries(RA_NET).forEach(([id, v]) => {
    const el = $w(id);
    if (locked) el.value = v;
    el.disabled = locked;
    el.closest('.field').classList.toggle('ra-fixed', locked);
  });
  $w('w-net-lock').hidden = !locked;
  if (locked) {
    const links = (node.ewLinksPerPort || 1) > 1 ? 'ConnectX-8 800G ports split 2 × 400G across two planes' : `one 400G link per ${node.ewPortsPerNode === 4 ? 'B3140H SuperNIC, four per node' : 'B3140H SuperNIC'}`;
    $w('w-net-lock').textContent = `${profile.ra.name} specifies this fabric: Spectrum-X Ethernet, non-blocking, ${links}, twin-port 2 × 400G switch cages. The switch counts follow the RA's own rules and reproduce its published tables; pick an InferX tier to change transport or oversubscription.`;
  }
}

/* ---------- setup ---------- */
function fill() {
  const groups = [['inferx', 'InferX federation tiers'], ['nvidia', 'NVIDIA reference architectures']];
  $w('w-profile').innerHTML = groups.map(([g, title]) => `<optgroup label="${escW(title)}">${Object.entries(RA_PROFILES)
    .filter(([, v]) => v.group === g).map(([k, v]) => `<option value="${k}">${escW(v.label)}</option>`).join('')}</optgroup>`).join('');
  $w('w-profile').value = 'core';
  syncNodeOptions(RA_PROFILES.core);
  $w('w-model').innerHTML = Object.entries(MODELS).map(([k, v]) => `<option value="${k}">${escW(v.label)}</option>`).join('');
  $w('w-precision').innerHTML = Object.entries(PRECISIONS).map(([k, v]) => `<option value="${k}">${escW(v.label)}</option>`).join('');
  $w('w-scheme').innerHTML = PROTECTION_SCHEMES.map((s) => `<option value="${s.id}">${s.id} — ${(s.efficiency * 100).toFixed(0)}% efficient</option>`).join('');
  $w('w-pod').innerHTML = Object.entries(WEKAPODS)
    .map(([k, v]) => `<option value="${k}">${escW(v.label)}</option>`).join('');
  $w('w-pod').value = 'nitro-155';
  $w('w-basis').value = 'nodes';
  $w('w-node').value = 'smc-b300';
  $w('w-model').value = 'llama31-70b';
  $w('w-precision').value = 'fp8';
  $w('w-scheme').value = WEKAPOD_DEFAULTS.schemeId;

  $w('stepper').innerHTML = STEPS.map((s, i) =>
    `<button data-goto="${i}"><span class="num">${i + 1}</span>${escW(s)}</button>`).join('');
  $w('stepper').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.disabled) go(+b.dataset.goto);
  });
}

/* ---------- compute the whole solution ---------- */
function computeAll() {
  const profile = RA_PROFILES[$w('w-profile').value];
  const node = syncNodeOptions(profile);
  const nodeKey = $w('w-node').value;
  const coolingKey = syncCoolingOptions(profile, node);
  syncNetworkLock(profile, node);
  // The control-plane node's connectivity is its reference architecture's, so
  // the spec model needs to know which one is selected.
  setServerContext($w('w-profile').value);

  // Networking overrides feed the shared fabric rules (the InferX designs;
  // the NVIDIA profiles size their fabric from the RA and ignore these).
  FABRIC_RULES.eastWestOversub = +$w('w-ew').value;
  FABRIC_RULES.northSouthOversub = +$w('w-ns').value;
  FABRIC_RULES.eastWestTech = $w('w-ewtech').value;
  FABRIC_RULES.northSouthTech = $w('w-nstech').value;
  FABRIC_RULES.breakout = +$w('w-breakout').value;

  // Sizing basis: solve for the fleet, or fix it and report what it delivers.
  const basis = $w('w-basis').value;
  const perRack = RACK.cooling[coolingKey].gpuNodesPerRack;
  let fixedNodes = null;
  if (basis === 'nodes') fixedNodes = Math.max(1, +$w('w-nodes').value || 1);
  else if (basis === 'racks') fixedNodes = Math.max(1, +$w('w-racks').value || 1) * perRack;

  const inf = sizeInference({
    fixedNodes,
    modelKey: $w('w-model').value,
    precisionKey: $w('w-precision').value,
    nodeKey,
    concurrentRequests: Math.max(1, +$w('w-conc').value || 1),
    promptTokens: Math.max(1, +$w('w-prompt').value || 1),
    outputTokens: Math.max(1, +$w('w-out').value || 1),
    tpotTargetMs: +$w('w-tpot').value,
    ttftTargetMs: +$w('w-ttft').value,
    tpOverride: $w('w-tp').value ? +$w('w-tp').value : null,
    customModel: null,
  });
  if (inf.error) return { error: inf.error, inf };

  // --- storage: sized natively on the chosen WEKApod appliance ---
  const podKey = $w('w-pod').value;
  const schemeId = $w('w-scheme').value;
  const mode = $w('w-stmode').value;
  const gpus = inf.gpusDeployed;
  let stNodes;
  if (mode === 'ratio') {
    stNodes = wekapodNodesFor({ podKey, targetReadGBs: gpus * (+$w('w-gbpergpu').value), schemeId });
  } else if (mode === 'capacity') {
    stNodes = wekapodNodesFor({ podKey, targetTB: Math.max(10, +$w('w-captb').value || 10), schemeId });
  } else {
    stNodes = Math.max(WEKAPODS[podKey].minNodes, +$w('w-stnodes').value || 8);
  }
  const weka = sizeWekapod({ podKey, nodes: stNodes, schemeId });
  stNodes = weka.nodes;

  const fac = sizeFacility({
    gpuNodes: inf.nodes, nodeKey, coolingKey,
    profileKey: $w('w-profile').value, storageNodes: stNodes, storagePodKey: podKey,
  });
  const layout = buildRALayout(fac, { gpuNodes: inf.nodes });
  // Where every cable goes, worked out once over the whole layout.
  const plan = RARack.planLinks(layout.racks, fac.fabric);

  return { inf, fac, layout, plan, weka, stNodes, mode, podKey, nodeKey, coolingKey, basis, perRack };
}

/* ---------- live strips under each step ---------- */
function tiles(items) {
  return `<div class="tiles">${items.map(([v, k]) =>
    `<div class="tile"><div class="v">${v}</div><div class="k">${escW(k)}</div></div>`).join('')}</div>`;
}

function renderLive() {
  const s = STATE;
  if (!s || s.error) {
    const msg = s && s.error ? s.error : 'Configuration cannot be sized.';
    ['live-compute', 'live-workload', 'live-net', 'live-storage'].forEach((id) => {
      if ($w(id)) $w(id).innerHTML = `<div class="card"><div class="check-item critical"><span>${escW(msg)}</span></div></div>`;
    });
    return;
  }
  const { inf, fac } = s;

  $w('live-compute').innerHTML = $w('live-workload').innerHTML = tiles([
    [nfW(inf.gpusDeployed), `${inf.gpu.short} GPUs`],
    [nfW(inf.nodes), `${inf.node.rackScale ? Units(inf.node, inf.nodes) : 'GPU ' + units(inf.node, inf.nodes)}${inf.fixedNodes ? ' (fixed)' : ''}`],
    [nfW(inf.deployedConcurrency), inf.shortfall ? 'Concurrency — SHORT' : 'Concurrency served'],
    [`${nfW(inf.perUserTps, 1)}<small>tok/s</small>`, 'Per user'],
    [`${bigW(inf.clusterTps)}<small>tok/s</small>`, 'Cluster throughput'],
    [`${nfW(inf.ttftMs, 0)}<small>ms</small>`, 'TTFT'],
    [`TP ${inf.tp} · batch ${nfW(inf.batch)}`, `Limited by ${inf.batchLimit}`],
  ]);

  const fb = fac.fabric;
  const sameSwitch = fb.ewSwitch === fb.nsSwitch;
  $w('live-net').innerHTML = tiles([
    sameSwitch
      ? [nfW(fb.ewLeaves + fb.ewSpines + fb.nsLeaves + fb.nsSpines), `${fb.ewSwitch.label.replace('NVIDIA ', '')} switches`]
      : [`${nfW(fb.ewLeaves + fb.ewSpines)} / ${nfW(fb.nsLeaves + fb.nsSpines)}`, `${fb.ewSwitch.label.replace('NVIDIA ', '')} / ${fb.nsSwitch.label.replace('NVIDIA ', '')}`],
    [nfW(fb.oobLeaves + fb.oobSpines + (fb.oobRackLeaves || 0)), fb.oobRackLeaves ? 'OOB switches (incl. in-rack)' : 'OOB switches'],
    [nfW(fb.ewPorts), 'East-west node ports'],
    [`${nfW(fac.power.switchW / 1000, 1)}<small>kW</small>`, 'Fabric power'],
    [nfW(fac.fabricRacks), 'Fabric racks'],
  ]);

  const w = s.weka;
  $w('live-storage').innerHTML = tiles([
    [nfW(w.nodes), `${escW(w.pod.model)} nodes`],
    [`${nfW(w.netTB, 0)}<small>TB</small>`, 'Usable capacity'],
    [`${nfW(w.readGBs, 0)}<small>GB/s</small>`, 'Read throughput'],
    [`${nfW(w.readIops / 1e6, 1)}<small>M</small>`, 'Read IOPS'],
    [`${nfW(w.readGBs / Math.max(1, inf.gpusDeployed), 1)}<small>GB/s</small>`, 'Per GPU'],
    [`${nfW(w.ru)}<small>U</small>`, 'Rack units'],
  ]);
  const pod = WEKAPODS[$w('w-pod').value];
  $w('w-pod-hint').textContent = `${pod.ru}U · ${pod.drives} × ${pod.driveTB} TB ${pod.driveType} · ${pod.cpu} · ${nfW(pod.ramGB)} GB · ${pod.net} · ${pod.readGBs}/${pod.writeGBs} GB/s per node`;

  // Networking card detail.
  $w('net-summary').innerHTML = `<h2>Derived fabric</h2>
    <div class="table-scroll"><table><tbody>
      <tr><td>East-west</td><td class="num">${fb.ewLeaves} leaf + ${fb.ewSpines} spine · ${escW(fb.ewSwitch.label)}</td></tr>
      <tr><td>North-south</td><td class="num">${fb.nsLeaves} leaf + ${fb.nsSpines} spine · ${escW(fb.nsSwitch.label)}</td></tr>
      <tr><td>Out-of-band</td><td class="num">${fb.oobLeaves} leaf + ${fb.oobSpines} spine · ${escW(FABRIC.sn2201.label)}${fb.oobRackLeaves ? ` · plus ${fb.oobRackLeaves} in the NVL72 racks` : ''}</td></tr>
      <tr><td>Logical ports per leaf</td><td class="num">${nfW(fb.ewSwitch.ports * FABRIC_RULES.breakout)} east-west / ${nfW(fb.nsSwitch.ports * FABRIC_RULES.breakout)} north-south</td></tr>
      <tr><td>Switch rack units</td><td class="num">${fb.switchU} U</td></tr>
      <tr><td>East-west ports needed</td><td class="num">${nfW(fb.ewPorts)}</td></tr>
    </tbody></table></div>
    <div class="card-note">${fac.nvidia
      ? `Counts follow ${escW(fac.profile.ra.name)}: ${fabricRuleText(fac)} They reproduce the RA's published switch counts at every design point it documents; the switch models, power, weight and transceiver part numbers on the results page follow.`
      : 'Counts are derived from the oversubscription and transport choices above, not from a port map. The switch models, their power and weight, and the transceiver part numbers on the results page all follow this choice.'}</div>`;

  $w('storage-summary').innerHTML = storageTable(w, fac);
}

/* One sentence on how an NVIDIA profile's fabric was counted, shared by the
   networking step and the results. */
function fabricRuleText(fac) {
  const fb = fac.fabric;
  if (fb.rule === 'nvl72') return `four leaves per plane per pair of NVL72 racks, each wired to one GPU position in every tray and left at 36 of 128 ports (the RA's underpopulated leaf), spines per plane rounded up to an even count; the converged north-south fabric carries the trays' B3240 pair plus the RA's storage, customer, support and SN2201-uplink allocations; two SN2201 in every rack.`;
  if (fb.rule === 'superpod') return `a dual-plane compute fabric sized for the whole 64-node scalable unit (16 leaves and 8 spines per SU), a storage fabric with DGX-side leaves at 64 down / 48 up and storage-side leaves at 1:1, an in-band fabric of 128-port leaves with a spine pair beyond two — both reported on the north-south plane — and one SN2201 per DGX rack.`;
  const links = fb.linksPerPort > 1 ? 'each ConnectX-8 800G port split 2 × 400G across a dual-plane rail-optimised fabric' : 'one 400G link per B3140H SuperNIC on a rail-optimised fabric';
  const ns = fb.consolidated ? `at ${fac.computeRacks * fac.cooling.gpuNodesPerRack} nodes the converged north-south network is folded into those same leaves (the RA's consolidated design point)` : fb.nsCollapsed ? `the converged north-south network fits a leaf pair with an inter-switch link` : `the converged north-south network is its own leaf–spine`;
  return `${links}, 64-cage switches treated as 128 × 400G, non-blocking; ${ns}, carrying the nodes' BlueField-3 pair plus the RA's storage, customer, support-server and SN2201-uplink allocations.`;
}

/* The RA's storage-bandwidth floor against what the WEKApod cluster gives. */
function storageCheck(fac, weka, gpus) {
  const p = fac.profile;
  if (!fac.nvidia || !p.storageGbPerGpu || !weka) return null;
  const per = (weka.readGBs * 8) / Math.max(1, gpus);
  const ok = per >= p.storageGbPerGpu;
  return { level: ok ? 'info' : 'warning', text: `${p.ra.name} allocates at least ${p.storageGbPerGpu} Gb/s of storage bandwidth per GPU; ${nfW(weka.nodes)} × ${weka.pod.model} gives ${nfW(per, 1)} Gb/s per GPU (${nfW(weka.readGBs, 0)} GB/s read across ${nfW(gpus)} GPUs)${ok ? '.' : ' — add WEKApod nodes or raise the throughput-per-GPU target on the storage step.'}` };
}

/* Shared storage detail, used on the storage step and again in the results. */
function storageTable(w, fac) {
  const p = w.pod;
  const rows = [
    ['Appliance', `${p.family} — ${p.model}`],
    ['Nodes', `${nfW(w.nodes)} × ${p.ru}U = ${nfW(w.ru)}U`],
    ['NVMe per node', `${p.drives} × ${p.driveTB} TB ${p.driveType}`],
    p.writeTier ? ['Write tier', p.writeTier] : null,
    ['CPU / memory', `${p.cpu} · ${nfW(p.ramGB)} GB`],
    ['Data network', `${p.net} — ${nfW(w.ports)} × ${p.portGb} Gb total`],
    ['Raw capacity', `${nfW(w.rawTB, 0)} TB`],
    ['Usable capacity', `${nfW(w.netTB, 0)} TB`],
    ['Protection', `${w.scheme.id} + ${w.spares} virtual hot spare${w.spares === 1 ? '' : 's'} · ${(w.scheme.efficiency * 100).toFixed(0)}% efficient`],
    ['Read / write throughput', `${nfW(w.readGBs, 0)} / ${nfW(w.writeGBs, 0)} GB/s`],
    ['Read / write IOPS', `${nfW(w.readIops / 1e6, 1)}M / ${nfW(w.writeIops / 1e6, 1)}M`],
    ['Power', `${nfW(w.watts / 1000, 1)} kW`],
    ['Weight', `${nfW(w.weightKg, 0)} kg`],
    ['Storage racks', nfW(fac.storageRacks)],
  ].filter(Boolean);
  const ref = p.ref ? `<div class="card-note">Validated against WEKA's published configuration: ${p.ref.nodes} × ${escW(p.model)} = ${p.ref.netTB} TB usable at 5D+2P+1VHS, ${p.ref.readGBs}/${p.ref.writeGBs} GB/s, ${p.ref.ru}RU, ~${p.ref.kw} kW, ~${p.ref.kg} kg. This tool reproduces the capacity, rack units, power and weight exactly.</div>`
    : `<div class="card-note">${escW(p.src)}</div>`;
  return `<h2>WEKApod storage</h2><div class="table-scroll"><table><tbody>
    ${rows.map((r) => `<tr><td>${escW(r[0])}</td><td class="num">${escW(r[1])}</td></tr>`).join('')}
  </tbody></table></div>${ref}`;
}

/* "16 compute · 1 fabric · 1 storage · 1 mgmt · 2 CDU" */
function rackBreakdown(fac, mgmt = 'management') {
  const m = fac.nvidia ? (mgmt === 'mgmt' ? 'control plane' : 'control-plane') : mgmt;
  return `${fac.computeRacks} compute · ${fac.fabricRacks} fabric · ${fac.storageRacks} storage · 1 ${m}${fac.cduRacks ? ` · ${fac.cduRacks} CDU` : ''}`;
}

/* ---------- detail cards carried over from the compute and storage pages ---------- */

function computeMemoryCard(r) {
  const wPer = r.weightsGB / r.tp;
  const kvPer = (r.batch * r.kvPerSeqGB) / r.tp;
  const ws = SERVING.workspaceGB;
  const total = r.gpuMemGB;
  const seg = (v, c) => `<div style="width:${Math.max(0, (v / total) * 100)}%;background:${c}"></div>`;
  return `<section class="card">
    <h2>Memory per GPU — ${escW(r.gpu.short)}, ${nfW(total)} GB ${escW(r.gpu.memType)}</h2>
    <div class="stackbar">${seg(wPer, 'var(--series-1)')}${seg(kvPer, 'var(--series-2)')}${seg(ws, 'var(--series-3)')}<div style="flex:1;background:var(--surface-2)"></div></div>
    <div class="legend">
      <div class="legend-item"><span class="swatch" style="background:var(--series-1)"></span>Weights ${nfW(wPer, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-2)"></span>KV cache ${nfW(kvPer, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-3)"></span>Workspace ${nfW(ws, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--surface-2);border:1px solid var(--border)"></span>Free ${nfW(Math.max(0, total - r.perGpuMemGB), 1)} GB</div>
    </div>
    <div class="card-note">${escW(r.model.label)} at ${escW(r.precision.label)} is ${nfW(r.weightsGB, 1)} GB across ${r.tp} GPU${r.tp > 1 ? 's' : ''}. Each sequence costs ${nfW(r.kvPerSeqGB * 1024, 1)} MB of KV at ${nfW(r.ctxTokens)} tokens, sized on ${r.model.kvHeads} KV heads rather than ${r.model.heads} attention heads — grouped-query attention is what makes long context affordable.
    Batch is capped by <strong>${escW(r.batchLimit)}</strong>: KV memory would allow ${nfW(r.memBatch)}, the TPOT target allows ${nfW(r.tpotBatch)}.</div>
  </section>`;
}

function gpuSpecCard(r) {
  const s = gpuSpecSheet(r.gpu, r.gpusDeployed);
  const f = s.fleet;
  const np = '<span style="opacity:.55">n/p</span>';
  const fleetTiles = [
    [f.fp16PFLOPS === null ? np : `${nfW(f.fp16PFLOPS, 1)}<small>PFLOPS</small>`, 'FP16 / BF16 dense'],
    [f.fp8PFLOPS === null ? np : `${nfW(f.fp8PFLOPS, 1)}<small>PFLOPS</small>`, 'FP8 dense'],
    [f.int8POPS === null ? np : `${nfW(f.int8POPS, 1)}<small>POPS</small>`, 'INT8 dense'],
    [f.fp4PFLOPS === null ? '—' : `${nfW(f.fp4PFLOPS, 1)}<small>PFLOPS</small>`, 'FP4 dense'],
    [`${nfW(f.memTB, 1)}<small>TB</small>`, 'Aggregate GPU memory'],
    [`${nfW(f.bwTBs, 1)}<small>TB/s</small>`, 'Aggregate bandwidth'],
    [f.tensorCores === null ? np : nfW(f.tensorCores), 'Tensor cores'],
    [f.fp32TFLOPS === null ? np : `${nfW(f.fp32TFLOPS)}<small>TFLOPS</small>`, 'FP32 vector'],
  ];
  return `<section class="card">
    <h2>GPU specification — ${escW(r.gpu.label)} × ${nfW(r.gpusDeployed)}</h2>
    ${tiles(fleetTiles)}
    <div class="table-scroll" style="margin-top:14px"><table>
      <thead><tr><th>Per GPU</th><th class="num">Figure</th><th class="num">Note</th></tr></thead>
      <tbody>${s.rows.map(([k, v, note]) => `<tr><td>${escW(k)}</td><td class="num">${v}</td><td class="num" style="color:var(--text-muted)">${escW(note)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">
      Tiles are the fleet total, the table is one GPU. Every tensor figure is the <strong>dense</strong> rate — ${escW(s.sparsityNote.toLowerCase())} FP16 and BF16 share a tensor-core rate and INT8 runs at the FP8 rate, which is how NVIDIA's datasheets list them. FP32 is the vector rate on the CUDA cores, three orders of magnitude below the tensor columns; it carries pre- and post-processing, not serving.
      ${r.gpu.tensorCores ? '' : 'NVIDIA publishes no SM, CUDA-core or tensor-core count for the HGX Blackwell parts, so those rows read <em>not published</em> — abbreviated <em>n/p</em> in the tiles — rather than a guess; vector FP32 it does publish, per 8-GPU baseboard. '}Source: ${escW(r.gpu.src)}.
    </div>
  </section>`;
}

function fabricCard(fac) {
  const fb = fac.fabric;
  const ew = fb.ewSwitch, ns = fb.nsSwitch;
  const ewT = FABRIC_TRANSPORTS[fb.ewTech].label, nsT = FABRIC_TRANSPORTS[fb.nsTech].label;
  const nv = fac.nvidia;
  const rackWord = fac.rackScale ? 'NVL72' : 'DGX';
  const ewFacing = nv
    ? `${nfW(fb.ewPorts)} × 400G links${fb.linksPerPort > 1 ? ` (${nfW(fb.ewNodePorts)} ports × ${fb.linksPerPort})` : ''}`
    : `${nfW(fb.ewPorts)} node ports`;
  // Both stacks report the same thing: every endpoint on the fabric, broken
  // down by what it belongs to. `nsPorts` used to mean the GPU nodes alone on
  // the NVIDIA branch and every endpoint on the InferX one, and both were
  // labelled "node ports".
  const nsParts = [
    [fb.nsNodePorts, `GPU ${units(fac.node, fac.gpuNodes)}`],
    [fb.nsMgmtPorts, nv ? 'control plane' : 'management stack'],
    [fb.nsTier2Ports, 'Tier 2'],
    [fb.nsStoragePorts, 'storage'],
  ].filter(([n]) => n > 0).map(([n, what]) => `${nfW(n)} ${what}`).join(' + ');
  const nsFacing = nv
    ? `${nfW(fb.nsPorts)} endpoint ports${fb.nsPortGb !== 400 ? ` (nodes at ${fb.nsPortGb}G)` : ''} — ${nsParts} — plus ${nfW(Math.max(0, fb.nsLogical - fb.nsNodePorts * (fb.nsPortGb / 400) - fb.nsStoragePorts))} × 400G reserved for customer, support and uplinks`
    : `${nfW(fb.nsPorts)} endpoint ports — ${nsParts}`;
  const nsLeafText = fb.consolidated
    ? '— carried on the converged leaves above'
    : `${fb.nsLeaves} × ${ns.label}${fb.superpod ? ` (${fb.superpod.dgxLeaves} storage DGX-side, ${fb.superpod.stLeaves} storage-side, ${fb.superpod.ibLeaves} in-band)` : ''}`;
  const nsSpineText = fb.consolidated ? '—' : fb.nsSpines ? `${fb.nsSpines} × ${ns.label}${fb.superpod ? ` (${fb.superpod.stgSpines} storage, ${fb.superpod.ibSpines} in-band)` : ''}` : fb.nsCollapsed ? '— leaf pair with inter-switch link' : '—';
  const oobHoming = nv ? 'single-homed' : 'dual-homed';
  const rows = [
    [fb.consolidated ? 'Converged leaf (E/W + N/S)' : 'East-west leaf', ewT, `${fb.ewLeaves} × ${ew.label}`, `${fb.ewOversub}:1${fb.ewOversub === 1 ? ' non-blocking' : ''}${nv && fb.linksPerPort > 1 ? ', dual plane' : ''}`, ewFacing],
    [fb.consolidated ? 'Converged spine' : 'East-west spine', ewT, fb.ewSpines ? `${fb.ewSpines} × ${ew.label}` : '— leaf pair interconnects directly', `${fb.ewOversub}:1`, '—'],
    ['North-south leaf', nsT, nsLeafText, fb.consolidated ? 'consolidated' : fb.superpod ? '≈4:3 storage, 1:1 storage-side' : `${fb.nsOversub}:1${fb.nsOversub === 1 ? ' non-blocking' : ''}`, nsFacing],
    ['North-south spine', nsT, nsSpineText, fb.consolidated ? '—' : `${fb.nsOversub}:1`, '—'],
    ['Out-of-band leaf', 'Ethernet', `${fb.oobLeaves} × ${FABRIC.sn2201.label}${fb.oobRackLeaves ? ` in the fabric rack + ${fb.oobRackLeaves} in the ${rackWord} racks (${fb.oobRackLeaves / fac.computeRacks} per rack)` : ''}`, oobHoming, `${nfW(fb.oobPorts)} links${fb.oobRackLeaves ? ' in all' : ''}`],
    ['Out-of-band spine', 'Ethernet', fb.oobSpines ? `${fb.oobSpines} × ${FABRIC.sn4600c.label}` : nv ? '— SN2201 uplinks land on the converged fabric' : '—', '—', '—'],
  ];
  const note = nv
    ? `Counts follow ${escW(fac.profile.ra.name)} rather than the oversubscription controls: ${escW(fabricRuleText(fac))} Out-of-band is counted the RA's way — ${fac.node.oobLinksPerNode} × 1 GbE per ${fac.rackScale ? 'rack' : 'node'}, single-homed — but for every device: the RA's CAT6 table covers the compute nodes alone, so the ${nfW(fb.oobPorts - fac.gpuNodes * fac.node.oobLinksPerNode)} links the switches, control plane and storage add can put the SN2201 count one above the RA's node-only figure at a fully populated design point.`
    : `Counts are derived from the oversubscription rules, with ${ew === ns
      ? `${escW(ew.label)} cages treated as ${fb.ewSwitch.ports * FABRIC_RULES.breakout} logical ports`
      : `${escW(ew.label)} cages treated as ${fb.ewSwitch.ports * FABRIC_RULES.breakout} logical ports and ${escW(ns.label)} as ${fb.nsSwitch.ports * FABRIC_RULES.breakout}`} because the BOM specifies twin-port transceivers. Both planes default to 1:1; the reference architecture runs north-south at 4:1, and at those settings on the 2 MW design this model derives 29 SN5610 against the 32 in the elevation — close, but not a substitute for a port map.`;
  return `<section class="card"><h2>Fabric</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Layer</th><th>Transport</th><th>Switches</th><th>Oversubscription</th><th class="num">Server-facing</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${escW(r[0])}</td><td>${escW(r[1])}</td><td>${escW(r[2])}</td><td>${escW(r[3])}</td><td class="num">${escW(r[4])}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">${note}</div>
  </section>`;
}

function capacityCard(w) {
  const pct = (v) => (v / w.rawTB) * 100;
  return `<section class="card">
    <h2>Where the raw capacity goes</h2>
    <div class="stackbar">
      <div style="width:${pct(w.split.net)}%;background:var(--series-1)"></div>
      <div style="width:${pct(w.split.parity)}%;background:var(--series-2)"></div>
      <div style="width:${pct(w.split.spare)}%;background:var(--series-3)"></div>
      <div style="width:${pct(w.split.reserve)}%;background:var(--surface-2)"></div>
    </div>
    <div class="legend">
      <div class="legend-item"><span class="swatch" style="background:var(--series-1)"></span>Usable ${nfW(w.split.net, 0)} TB · ${nfW(pct(w.split.net), 0)}%</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-2)"></span>Parity ${nfW(w.split.parity, 0)} TB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-3)"></span>Hot spare ${nfW(w.split.spare, 0)} TB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--surface-2);border:1px solid var(--border)"></span>WEKA reserve ${nfW(w.split.reserve, 0)} TB</div>
    </div>
    <div class="table-scroll" style="margin-top:14px"><table>
      <thead><tr><th>Step</th><th class="num">Capacity</th><th>Applied</th></tr></thead>
      <tbody>${w.waterfall.map((x) => `<tr><td${x.final ? ' style="font-weight:600"' : ''}>${escW(x.step)}</td><td class="num"${x.final ? ' style="font-weight:600"' : ''}>${nfW(x.tb, 1)} TB</td><td>${escW(x.applied)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Net = Raw × (FD − spares)/FD × D/(D+P) × 0.9, the formula published in Lenovo Press LP1698 and consistent with WEKA's planning documentation. Licensing is billed on net capacity — this design falls in <strong>${escW(w.licenseTier)}</strong>.</div>
  </section>`;
}

function storageNodeCard(w) {
  const p = w.pod;
  const c = w.ceiling;
  const memRows = [
    ['Base (fixed)', w.mem.base], ['Frontend processes', w.mem.frontend],
    ['Compute processes', w.mem.compute], ['Drive processes', w.mem.drives],
    ['SSD capacity management', w.mem.ssdMgmt], ['Core allocation', w.mem.cores],
    ['Operating system', w.mem.os], ['NFS / SMB / S3 protocols', w.mem.protocols],
    ['RDMA', w.mem.rdma],
  ].filter((r) => r[1] > 0);
  return `<section class="card">
    <h2>WEKApod node — configuration, memory and throughput ceiling</h2>
    <div class="two-col">
      <div>
        <div class="table-scroll"><table>
          <thead><tr><th>Per-node configuration</th><th class="num"></th></tr></thead>
          <tbody>
            <tr><td>Model</td><td class="num">${escW(p.model)}</td></tr>
            <tr><td>CPU</td><td class="num">${escW(p.cpu)}</td></tr>
            <tr><td>Memory</td><td class="num">${nfW(p.ramGB)} GB</td></tr>
            <tr><td>Data drives</td><td class="num">${p.drives} × ${p.driveTB} TB ${escW(p.driveType)}</td></tr>
            ${p.writeTier ? `<tr><td>Write tier</td><td class="num">${escW(p.writeTier)}</td></tr>` : ''}
            <tr><td>Boot</td><td class="num">${escW(p.bootDesc)}</td></tr>
            <tr><td>Data network</td><td class="num">${escW(p.net)}</td></tr>
            <tr><td>Management</td><td class="num">${escW(p.mgmt)}</td></tr>
            <tr><td>Form factor</td><td class="num">${p.ru}U</td></tr>
            <tr><td>Power</td><td class="num">${nfW(p.watts)} W</td></tr>
          </tbody>
        </table></div>
      </div>
      <div>
        <div class="table-scroll"><table>
          <thead><tr><th>Memory budget</th><th class="num">GiB</th></tr></thead>
          <tbody>
            ${memRows.map((r) => `<tr><td>${escW(r[0])}</td><td class="num">${nfW(r[1], 2)}</td></tr>`).join('')}
            <tr><td><strong>WEKA requires</strong></td><td class="num"><strong>${nfW(w.mem.totalGiB, 1)}</strong></td></tr>
            <tr><td>Installed</td><td class="num">${nfW((p.ramGB * 1e9) / 1024 ** 3, 1)}</td></tr>
          </tbody>
        </table></div>
      </div>
    </div>
    <div class="table-scroll" style="margin-top:14px"><table>
      <thead><tr><th>Per-node throughput ceiling</th><th class="num">GB/s</th></tr></thead>
      <tbody>${c.limits.map((l) => `<tr><td>${escW(l.label)}${l.id === c.bottleneck.id ? ' <span class="pill">binding</span>' : ''}</td><td class="num">${nfW(l.value, 1)}</td></tr>`).join('')}
        <tr><td><strong>Modelled read ceiling</strong></td><td class="num"><strong>${nfW(c.read, 1)}</strong></td></tr>
        <tr><td>WEKA published per node</td><td class="num">${nfW(p.readGBs, 0)}</td></tr>
      </tbody>
    </table></div>
    <div class="card-note">Memory follows WEKA's published per-server formula; the ceiling takes the lowest of the network, drive and CPU limits. The modelled ceiling sits ${c.read >= p.readGBs ? 'above' : 'below'} WEKA's published figure — a peak-sequential ceiling should sit above a real-world number.</div>
  </section>`;
}

function protectionCard(w) {
  return `<section class="card">
    <h2>Protection scheme trade-off at ${w.nodes} nodes</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Scheme</th><th class="num">Net capacity</th><th class="num">Efficiency</th><th class="num">Drive failures</th><th class="num">Min failure domains</th></tr></thead>
      <tbody>${w.alternatives.map((a) => `<tr${a.current ? ' class="highlight"' : ''}>
        <td${a.current ? ' style="font-weight:600"' : ''}>${escW(a.scheme.id)}</td>
        <td class="num">${nfW(a.netTB, 0)} TB</td>
        <td class="num">${(a.scheme.efficiency * 100).toFixed(1)}%</td>
        <td class="num">${a.scheme.driveFailures}</td>
        <td class="num">${a.scheme.stripe}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">Only schemes whose stripe width fits inside ${w.nodes} failure domains are listed. Wider stripes yield more usable capacity but rebuild across more nodes. Protection cannot be changed after the cluster is formed. Every level tolerates 2 simultaneous server failures.</div>
  </section>`;
}

function bomCard(r, fac, w) {
  const rk = r.node.rack;
  const bom = hardwareBOM({ r, fac, weka: w });
  const num = (v, d = 0) => (v == null || v === '' ? '—' : nfW(v, d));
  const body = bom.rows.map((x) => `<tr>
      <td${x.indent ? ' style="padding-left:22px;color:var(--text-secondary)"' : ''}>${escW(x.item)}${x.model ? ` <span style="color:var(--text-muted)">— ${escW(x.model)}</span>` : ''}</td>
      <td class="num">${nfW(x.qty)}</td>
      <td class="num">${x.unitW == null ? '—' : `${nfW(x.unitW)} W`}</td>
      <td class="num">${x.totalW == null ? '<span style="opacity:.55">in the line above</span>' : `${nfW(x.totalW / 1000, 1)} kW`}</td>
      <td class="num">${x.unitKg == null ? '—' : `${nfW(x.unitKg, 1)} kg`}</td>
      <td class="num" style="color:var(--text-muted)">${escW(x.spec)}</td>
    </tr>`).join('');
  return `<section class="card"><h2>Bill of materials</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit power</th><th class="num">Total power</th><th class="num">Unit weight</th><th class="num">Configuration</th></tr></thead>
      <tbody>${body}
        <tr><td><strong>Total</strong></td><td class="num"></td><td class="num"></td>
          <td class="num"><strong>${nfW(bom.totalW / 1000, 1)} kW</strong></td>
          <td class="num"><strong>${nfW(bom.totalKg / 1000, 2)} t</strong></td><td class="num"></td></tr>
      </tbody>
    </table></div>
    <div class="card-note">${fac.nvidia
      ? `${escW(fac.profile.ra.name)} defines the node as a pattern and a minimum specification and publishes no node power or weight; those come from the representative NVIDIA-Certified system named on the node line — ${escW(r.node.src)}. Switch and WEKApod figures are the NVIDIA and WEKA datasheets.`
      : 'Part numbers and per-unit power come from the reference architecture BOM, the WEKApod material and NVIDIA datasheets.'}
      Indented lines are already inside the line above them and are not added again: the GPUs inside a node${rk ? `, and the trays, switch trays, power shelves and OOB pair inside an NVL72 rack — ${rk.powerShelves} × ${rk.shelfKw} kW shelves in a ${Math.ceil(rk.powerShelves / 2)}+${Math.floor(rk.powerShelves / 2)} arrangement give ${rk.usableKw} kW usable against a ${nfW(r.node.watts / 1000)} kW operating draw${fac.cdu && fac.cdu.spec.src ? `. CDU: ${escW(fac.cdu.spec.src)}` : ''}` : ''}.
      Switch power is NVIDIA's optically populated figure where it publishes one, so the transceivers in the optics BOM are costed inside the switch and never added twice. The total reconciles with the facility figures above. <strong>Export BOM</strong> on the top bar downloads these lines and the optics BOM as a spreadsheet.</div>
  </section>`;
}

function totalsCard(r, fac, w) {
  const rows = [
    [r.node.rackScale ? Units(r.node, r.nodes) : 'GPU nodes', nfW(r.nodes), `${escW(r.node.sublabel)} · ${nfW(r.gpusDeployed)} GPUs${r.node.rack ? ` · ${nfW(r.nodes * r.node.rack.computeTrays)} compute trays` : ''}`],
    ['Tensor parallel / replicas', `${r.tp} / ${nfW(r.deployedReplicas)}`, `batch ${nfW(r.batch)} per replica, limited by ${escW(r.batchLimit)}`],
    ['WEKApod nodes', nfW(w.nodes), `${nfW(w.drives)} NVMe drives · ${nfW(w.netTB, 0)} TB usable`],
    ['Fabric switches', nfW(fac.fabric.ewLeaves + fac.fabric.ewSpines + fac.fabric.nsLeaves + fac.fabric.nsSpines + fac.fabric.oobLeaves + fac.fabric.oobSpines + (fac.fabric.oobRackLeaves || 0)), `${nfW(fac.fabric.ewPorts)} east-west node ports${fac.fabric.oobRackLeaves ? ` · ${fac.fabric.oobRackLeaves} OOB switches inside the NVL72 racks` : ''}`],
    ['Racks', nfW(fac.totalRacks), rackBreakdown(fac)],
    ['Total IT load', `${nfW(fac.power.totalW / 1000, 1)} kW`, `${bigW(fac.coolingLoadBTU)} BTU/hr of cooling`],
    ['Total IT weight', `${nfW(fac.weight.totalKg / 1000, 2)} t`, `${nfW(fac.weight.totalKg, 0)} kg`],
    ['Per-rack feed', escW(r.node.feed || RACK.feed), r.node.dims ? `${RACK.totalU}U MGX rack · ${escW(r.node.dims)}` : `${RACK.totalU}U × ${RACK.widthMM} × ${RACK.depthMM} mm`],
    ['Cluster throughput', `${bigW(r.clusterTps)} tok/s`, `${bigW(r.reqPerHour)} requests/hour at ${nfW(r.ctxTokens)} tokens`],
    ['Storage throughput', `${nfW(w.readGBs, 0)} / ${nfW(w.writeGBs, 0)} GB/s`, `${nfW(w.readIops / 1e6, 1)}M / ${nfW(w.writeIops / 1e6, 1)}M IOPS`],
  ];
  return `<section class="card"><h2>Cluster totals</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th class="num">Value</th><th>Notes</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${escW(x[0])}</td><td class="num">${x[1]}</td><td>${x[2]}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function opticsCard(bom) {
  const byGroup = {};
  bom.rows.forEach((r) => { (byGroup[r.group] = byGroup[r.group] || []).push(r); });
  const body = Object.entries(byGroup).map(([g, rows]) => `
    <tr class="highlight"><td colspan="4"><strong>${escW(g)}</strong></td></tr>
    ${rows.map((r) => `<tr>
      <td>${escW(r.spec.label)}${r.note ? ` <span style="color:var(--text-muted)">— ${escW(r.note)}</span>` : ''}</td>
      <td><code>${escW(r.spec.pn)}</code></td>
      <td class="num">${nfW(r.qty)}</td>
      <td style="color:var(--text-muted)">${escW(r.spec.role)}</td>
    </tr>`).join('')}`).join('');

  return `<section class="card">
    <h2>Optics, transceivers and cabling</h2>
    <div class="tiles" style="margin-bottom:16px">
      <div class="tile"><div class="v">${nfW(bom.ports.ewPorts)}</div><div class="k">East-west node ports</div></div>
      <div class="tile"><div class="v">${nfW(bom.ports.nsPorts)}</div><div class="k">North-south node ports</div></div>
      <div class="tile"><div class="v">${nfW(bom.ports.ibPorts)}</div><div class="k">In-band ports</div></div>
      <div class="tile"><div class="v">${nfW(bom.ports.stPorts)}</div><div class="k">WEKApod ports</div></div>
      <div class="tile"><div class="v">${nfW(bom.ports.oobLinks)}</div><div class="k">Out-of-band links</div></div>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th>Part number</th><th class="num">Qty</th><th>Role</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <div class="table-scroll" style="margin-top:16px"><table>
      <thead><tr><th>Order total by part</th><th>Part number</th><th class="num">Qty</th></tr></thead>
      <tbody>${bom.totals.map((t) => `<tr><td>${escW(t.spec.label)}</td><td><code>${escW(t.spec.pn)}</code></td><td class="num">${nfW(t.qty)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">
      Part numbers and per-link ratios follow NVIDIA RA-11337-001 Table 9.1. That table sizes a 4 SU, 256-node SuperPOD, and feeding its own configuration back into this model reproduces its quantities exactly — 2,048 node transceivers, 2,048 twin-port switch transceivers and 4,096 node-leaf fibres for 2,048 compute ports.
      Cable counts are double the port counts because a twin-port OSFP cage carries two links. Ethernet (F4) variants are listed since this design builds a Spectrum fabric; the InfiniBand equivalents are given in the role column. Cable <em>lengths</em> are not sized here — the listed fibre is the RA's 30 m part, and a real order needs a length schedule from the floor plan.
    </div>
  </section>`;
}

function sourcesCard(fac) {
  const nv = fac && fac.nvidia;
  const ra = nv ? fac.profile.ra : null;
  const v = nv ? fac.profile.verified : null;
  const pts = (t) => t ? Object.entries(t).map(([n, x]) => `${n} ${v.unit}s: ${x[0]} leaf + ${x[1]} spine`).join('; ') : '';
  const raLine = nv ? `<li><strong>${escW(ra.name)}</strong> — <a href="${escW(ra.url)}" target="_blank" rel="noopener">${escW(ra.cite)}</a>. Node pattern ${escW(ra.pattern)}; scalable unit, tested range, fabric rules, converged-fabric allocations and control plane are taken from it. The engine reproduces the RA's published switch counts exactly${v.ew ? ` — east-west ${pts(v.ew)}` : ''}${v.ns ? `; north-south ${pts(v.ns)}` : ''}. Node power and weight come from the representative NVIDIA-Certified system: ${escW(fac.node.src)}.</li>` : '';
  const inferxLine = nv ? '' : `<li><strong>InferX reference architecture</strong> — node power, weight and rack composition. Verified against the elevations' own totals: air B300 rack 28,986 W, liquid rack 115,380 W, 128-node fleet 1,779,072 W, 64 compute racks air / 16 liquid.</li>`;
  const smcLine = nv && !fac.rackScale ? `<li><strong>Supermicro NVIDIA AI Factory builds</strong> — <a href="https://www.supermicro.com/datasheet/Datasheet_Supermicro_NVIDIA_AI_Factories_HGX_B300.pdf" target="_blank" rel="noopener">HGX B300</a> (SYS-822GS-NB3RT, 15 kW per node, four nodes per rack at 60 kW) and <a href="https://www.supermicro.com/datasheet/Datasheet_Supermicro_NVIDIA_AI_Factories_HGX.pdf" target="_blank" rel="noopener">HGX B200</a> (SYS-A22GA-NBRT-G1, 13.4 kW, 53.6 kW per rack), NVIDIA-endorsed implementations of the Enterprise RAs and the source of the four-nodes-per-rack rule; the <a href="https://www.supermicro.com/solutions/Solution-Brief_OVX.pdf" target="_blank" rel="noopener">Supermicro OVX 3.0 solution brief</a> for the L40S node.</li>` : '';
  return `<section class="card"><h2>Sources and method</h2>
    <ul class="sources">
      ${raLine}${inferxLine}${smcLine}
      <li><strong>GB300 NVL72</strong> — <a href="https://www.nvidia.com/en-us/data-center/gb300-nvl72/" target="_blank" rel="noopener">NVIDIA GB300 NVL72 datasheet</a> for the per-GPU rates (1,440 | 1,080 PFLOPS FP4, 720 PFLOPS FP8, 24 POPS INT8, 576 TB/s and 130 TB/s NVLink across 72 GPUs, sparse unless noted); <a href="https://www.supermicro.com/datasheet/datasheet_SuperCluster_GB300_NVL72.pdf" target="_blank" rel="noopener">Supermicro SRS-GB300-NVL72</a> for the rack (18 × ARS-121GL-NB3-LC, 9 NVLink switch trays, 8 × 33 kW shelves 4+4, 132–140 kW, 2236 × 600 × 1068 mm) and the three CDU options; the <a href="https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/components.html" target="_blank" rel="noopener">NVIDIA NVL72 AI Factory RA</a> for the per-tray networking (4 × ConnectX-8 800G, one dual-port BlueField-3 B3240, 2 × SN2201 per rack, up to 142 kW); <a href="https://lenovopress.lenovo.com/lp2357-lenovo-nvidia-gb300-nvl72-rack-scale-ai" target="_blank" rel="noopener">Lenovo LP2357</a> for the 48U MGX rack and tray weights; Supermicro DCBBS datasheets for the in-row (1.8 MW, 20 kW, 1,560 kg), in-rack (250 kW, 3 kW, 114 kg) and L2A sidecar (200 kW, 19 kW, 1,145 kg) CDUs. Populated rack weight (~1,360 kg) is NVIDIA's site-preparation figure, not a datasheet value, and per-GPU TDP is not published for the NVL72.</li>
      <li><strong>WEKA NeuralMesh and WEKApod</strong> — appliance models and performance. The engine reproduces WEKA's published configurations exactly: 8 × WPS155-SAE = 484 TB usable, 568/256 GB/s, 18M/4.7M IOPS, 8RU, 6.4 kW, 74 kg.</li>
      <li><a href="https://lenovopress.lenovo.com/lp1698-lenovo-everyscale-design-architecture-for-weka-storage" target="_blank" rel="noopener">Lenovo Press LP1698</a> — the net-capacity formula, reproduced exactly on both of its worked examples.</li>
      <li><a href="https://docs.weka.io/planning-and-installation/bare-metal/planning-a-weka-system-installation" target="_blank" rel="noopener">WEKA planning documentation</a> — protection limits, per-server memory formula, process layout.</li>
      <li><a href="https://github.com/onepunk/open-gpu-db" target="_blank" rel="noopener">open-gpu-db</a> (Apache-2.0) — GPU specifications; its TDP figures independently agree with the RA BOM.</li>
      <li><strong>GPU specifications</strong> — the per-part figures come from NVIDIA's own platform tables and datasheets, halved to dense wherever the source marks a rate sparse: the HGX columns give the B300 144 | 108 PFLOPS FP4 and the B200 144 | 72 across 8 GPUs, both on 72 PFLOPS FP8 and 36 PFLOPS FP16/BF16 sparse, and the RTX PRO 6000 Blackwell Server Edition's 4 PFLOPS FP4 is its sparsity rate. SM, CUDA-core and tensor-core counts are published for the Hopper, Ada and RTX Blackwell parts but not for the HGX Blackwell ones, so the spec sheet reads <em>not published</em> there; vector FP32 is published for all of them.</li>
      <li><a href="https://github.com/kkpkishan/llm-infra-planner" target="_blank" rel="noopener">LLMcalc</a> and <a href="https://github.com/onepunk/llmsizer" target="_blank" rel="noopener">llmsizer</a> (MIT) — memory and roofline formulas.</li>
    </ul>
    <div class="disclaimer">
      <strong>What is solid and what is not.</strong> Capacity, memory and facility figures are arithmetic from published formulas, and they reproduce the reference architecture's and WEKA's own numbers exactly. Inference <em>throughput</em> is a roofline model at ${Math.round(SERVING.bwEfficiency * 100)}% of peak bandwidth in decode and ${Math.round(SERVING.flopEfficiency * 100)}% of dense peak in prefill — the least-grounded numbers here, reflecting typical vLLM and TensorRT-LLM behaviour rather than a benchmark of this architecture. ${nv ? 'Fabric switch counts follow the NVIDIA RA\'s own rules and match its published tables at the design points it documents; between those points they are the same rules applied, not a port map.' : 'Fabric switch counts are derived from oversubscription rules, not a port map.'} Treat performance as a planning estimate and validate before committing to an SLA.
    </div>
  </section>`;
}

/* ---------- rack drawings ----------
   Shared by the results card and the PowerPoint export, so the deck carries
   every view whichever one the card is showing. */
function rackFigures(s) {
  const { inf, fac, layout, plan, weka } = s;

  // Racks of the same kind are identical bar the node numbering, and a core
  // design can run to dozens. Draw one of each and badge the repeat count
  // rather than emitting 68 near-identical SVGs the user must scroll past.
  const groups = [];
  layout.racks.forEach((rk) => {
    const sig = rk.kind + '|' + rk.devices.map((d) => `${d.type}:${d.ru}@${d.uTop}`).join(',');
    const hit = groups.find((g) => g.sig === sig);
    if (hit) hit.count++; else groups.push({ sig, rack: rk, count: 1 });
  });

  // Every rack in the row gets the same header height so the frames line up.
  const minLines = Math.max(0, ...groups.map((g) => RARack.headerLines(g.rack, plan).length));
  const CC = RARack.CLASS_COLOURS, RO = RARack.ROLES;
  return {
    groups,
    rack: (g, side, i) => RARack.renderRack(g.rack, side,
      { totalU: RACK.totalU, showLabels: true, showCables: true, showBlanks: true, plan, minLines }, `${side}${i}`),
    overview: RARack.renderOverview(groups, RACK.totalU),
    topology: RARack.renderTopology(plan, { racks: layout.racks }),
    overviewLegend: [
      { color: CC.gpu, text: inf.node.rackScale ? 'Compute tray (4 GPU + 2 Grace)' : 'GPU node' },
      inf.node.rackScale ? { color: CC.nvswitch, text: 'NVLink switch tray' } : null,
      inf.node.rackScale ? { color: CC.power, text: 'Power shelf 33 kW' } : null,
      { color: CC.switchEw, text: 'East-west switch' },
      { color: CC.switchNs, text: 'North-south switch' },
      { color: CC.switchOob, text: 'OOB switch' },
      weka.nodes ? { color: CC.wekapod, text: 'WEKApod' } : null,
      { color: CC.infra, text: 'Platform / storage' },
      fac.cdu ? { color: CC.cdu, text: fac.cdu.inRack ? 'CDU' : fac.cdu.spec.racksPerUnit > 1 ? 'In-row CDU cabinet' : 'Sidecar CDU cabinet' } : null,
      { color: CC.blank, text: 'Blanking panel' },
    ].filter(Boolean),
    cableLegend: [
      { color: RO.ew.colour, text: `East-west · ${inf.node.eastWest}` },
      { color: RO.ns.colour, text: `North-south · ${inf.node.northSouth}${weka.nodes ? ' and WEKApod data ports' : ''}` },
      { color: RO.oob.colour, text: 'Out-of-band · BMC, 1GbE' },
      { color: 'var(--text-muted)', dashed: true, text: 'Leaf-to-spine uplinks' },
    ],
  };
}

/* Every design check in one list: the inference notes, the facility notes
   the reference architecture imposes, and the storage-bandwidth floor. */
function designNotes(s) {
  const { inf, fac, weka } = s;
  const st = storageCheck(fac, weka, inf.gpusDeployed);
  return [...inf.notes, ...(fac.notes || []), ...(st ? [st] : []), ...specNotes(s)];
}

/* ---------- platform step: every server's CPU, memory and disk ----------
   One card per role the current deployment actually contains, holding the
   controls, what the build works out to, what it presents to each network and
   how it measures against the specification NVIDIA publishes for that role.

   The defaults are the reference architecture's own build, so an untouched
   journey reproduces the published elevations exactly; the checks say where
   that build sits against NVIDIA's guideline rather than quietly moving it. */

/* How many of each role the solution contains, so a card can price itself. */
function roleCount(s, roleKey) {
  const r = SERVER_ROLES[roleKey];
  const { inf, fac } = s;
  if (r.kind === 'gpu') return inf.nodes;
  if (roleKey === 'tier2') return fac.tier2Count;
  if (roleKey === 'cp-node') return fac.mgmt.cpCount || 0;
  // From the rack as sized, not the catalogue's fixed list: the CPU compute
  // node count is adjustable, so the two differ as soon as it is changed.
  return (fac.mgmt.contents || RACK.mgmtRack.contents).filter((k) => k === roleKey).length;
}

const partOpts = (pool, keys, sel) => keys.map((k) => {
  const p = pool[k];
  return `<option value="${k}"${k === sel ? ' selected' : ''}>${escW(p.label)}${p.nvRec ? ' — NVIDIA RA' : ''}</option>`;
}).join('');

/* The processor select. Options are grouped by whether the part satisfies the
   role's reference architecture, and each is labelled with its cores, clock
   and TDP so the trade the choice makes is visible in the list rather than
   only after picking. */
const cpuOpts = (r, sel) => cpuGroups(r).map((g) => {
  const body = g.keys.map((k) => {
    const c = SERVER_PARTS.cpu[k];
    return `<option value="${k}"${k === sel ? ' selected' : ''}>${escW(c.label)} · ${c.cores}C/${c.threads}T · ${c.ghz} GHz · ${c.w} W${c.nvRec ? ' · RA-named' : ''}</option>`;
  }).join('');
  return g.label ? `<optgroup label="${escW(g.label)}">${body}</optgroup>` : body;
}).join('');
const qtyOpts = (max, sel, step) => {
  const out = [];
  for (let i = 0; i <= max; i += 1) if (i === 0 || i === sel || i % (step || 1) === 0 || i === max) out.push(i);
  return out.map((i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${i} ×</option>`).join('');
};

/* Where a role has more than one chassis family, say so: the processor choice
   is also a platform choice, and the reference architecture allows either. */
function platformNote(r, sp) {
  const plats = r.cpu.platforms || {};
  const names = Object.keys(plats);
  if (names.length < 2) return '';
  const vendors = [...new Set(names.map((k) => (k === 'sp5' ? 'AMD EPYC' : 'Intel Xeon')))];
  return ` · ${vendors.join(' or ')} — the RA specifies a minimum, not a vendor`;
}

function specCard(s, roleKey) {
  const sp = serverSpec(roleKey);
  const r = sp.def;
  const n = roleCount(s, roleKey);
  const rec = sp.rec;
  const bounds = roleCountBounds(roleKey);
  const head = `<h2>${escW(r.label)}${n ? `<span class="pill">× ${nfW(n)}</span>` : ''}${sp.changed ? '<span class="pill">changed</span>' : ''}${bounds && n !== bounds.def ? '<span class="pill">count changed</span>' : ''}</h2>
    <span class="hint">${escW(roleChassis(r, sp.cfg && sp.cfg.cpu))}${rec.ru ? ` · ${rec.ru}U` : ''} · ${nfW(sp.watts)} W${sp.deltaW ? ` (${sp.deltaW > 0 ? '+' : ''}${nfW(sp.deltaW)} W vs the reference build)` : ''} · ${nfW(sp.weightKg, 1)} kg each</span>`;

  /* How many of this role the design runs, where that is a sizing decision
     rather than a fixture. The reference architecture's own recommendation is
     the starting point and is named beside the control; the ceiling is what
     the rack physically holds at the pitch the elevation draws them. */
  const countRow = !bounds ? '' : `<div class="field"><label>How many</label>
    <div class="spec-row"><input type="number" class="spec-qty" data-role="${roleKey}" data-part="count"
      min="${bounds.min}" max="${bounds.max}" step="1" value="${n}">
      <span class="hint" style="flex:1">${roleKey === 'cp-node'
        ? `${escW(s.fac.profile.ra.name)} recommends ${bounds.def}`
        : `The InferX reference design has ${bounds.def}`}${n !== bounds.def ? ` — this design runs ${nfW(n)}` : ''}. Up to ${bounds.max} fit the rack.</span></div>
    <span class="hint">${nfW(n)} × ${nfW(sp.watts)} W = <strong>${nfW(n * sp.watts)} W</strong>${sp.nets.filter((x) => x.fabric === 'ns').length ? ` · ${nfW(n * sp.nets.filter((x) => x.fabric === 'ns').reduce((a, x) => a + x.totalPorts, 0))} north-south ports` : ''}</span></div>`;

  const nets = `<table class="spec-net"><tbody>${sp.nets.map((x) =>
    `<tr><td>${escW(NET_FABRICS[x.fabric].label)}</td><td>${escW(x.label)}</td>
      <td class="num">${x.qty > 1 ? `${x.qty} × ` : ''}${x.ports} × ${x.gb >= 1000 ? `${x.gb / 1000}T` : `${x.gb}G`}</td></tr>`).join('')}</tbody></table>`;

  if (sp.fixed) {
    return `<div class="card">${head}
      <div class="check-item info">${escW(r.fixedNote)}</div>
      <table class="spec-sum"><tbody>
        <tr><td>Processor</td><td class="num">${escW(sp.cpuLabel)}</td></tr>
        <tr><td>Memory</td><td class="num">${escW(sp.memLabel)}</td></tr>
        <tr><td>Boot</td><td class="num">${escW(sp.bootLabel)}</td></tr>
        <tr><td>Data cache</td><td class="num">${escW(sp.dataLabel)}</td></tr>
      </tbody></table>${nets}</div>`;
  }

  const b = sp.build;
  const g = roleGuide(r) ? SPEC_GUIDES[roleGuide(r)] : null;
  const row = (label, hint, body) => `<div class="field"><label>${escW(label)}</label>${body}
    <span class="hint">${hint}</span></div>`;
  const sel = (part, pool, keys, cur) =>
    `<select data-role="${roleKey}" data-part="${part}">${partOpts(pool, keys, cur)}</select>`;
  const pair = (part, qtyPart, pool, keys, cur, curQty, max, stepBy) =>
    `<div class="spec-row"><select class="spec-qty" data-role="${roleKey}" data-part="${qtyPart}">${qtyOpts(max, curQty, stepBy)}</select>
      <select data-role="${roleKey}" data-part="${part}">${partOpts(pool, keys, cur)}</select></div>`;

  const gTxt = (v, want, fmt) => want ? ` · guideline ${fmt(want)}` : '';
  const gb = fmtDisk;

  return `<div class="card">${head}
    ${countRow}
    ${row('Processor', `${r.cpu.sockets} sockets · <strong>${nfW(sp.cores)} cores / ${nfW(sp.threads)} threads</strong>${gTxt(sp.cores, g && g.cores, (v) => `${v} cores`)}${platformNote(r, sp)}`,
      `<select data-role="${roleKey}" data-part="cpu">${cpuOpts(r, sp.cfg.cpu)}</select>`)}
    ${row('Memory', `${memSlots(r, sp.cfg.cpu)} DIMM slots · ${memChannels(b.cpu.socket)} channels per socket · <strong>${escW(fmtMem(sp.ramGB))}</strong>${gTxt(sp.ramGB, g && g.ramGB, fmtMem)}`,
      pair('dimm', 'dimmQty', SERVER_PARTS.dimm, r.mem.options, sp.cfg.dimm, b.dimmQty, memSlots(r, sp.cfg.cpu), r.cpu.sockets))}
    ${row('Boot media', `${r.boot.bays} ${escW(r.boot.form.toUpperCase())} bays · <strong>${gb(sp.bootGB)}</strong>${gTxt(sp.bootGB, g && g.bootGB, gb)}`,
      pair('boot', 'bootQty', SERVER_PARTS.boot, r.boot.options.filter((k) => ['any', r.boot.form].includes(SERVER_PARTS.boot[k].form)), sp.cfg.boot, b.bootQty, r.boot.bays, 1))}
    ${row('Data cache', `${r.data.bays} ${escW(r.data.form.toUpperCase())} bays · <strong>${gb(sp.dataGB)}</strong>${gTxt(sp.dataGB, g && g.dataGB, gb)}`,
      pair('data', 'dataQty', SERVER_PARTS.data, r.data.options.filter((k) => ['any', r.data.form].includes(SERVER_PARTS.data[k].form)), sp.cfg.data, b.dataQty, r.data.bays, r.data.bays > 12 ? 6 : 1))}
    ${nets}
    ${g ? `<div class="check-item ${sp.checks.length ? (sp.checks.some((c) => c.level === 'critical') ? 'critical' : sp.checks.some((c) => c.level === 'warning') ? 'warning' : 'info') : g.cores ? 'good' : 'info'}">
      ${sp.checks.length ? sp.checks.map((c) => escW(c.text)).join('<br>')
        : g.cores ? `Meets ${escW(g.name)}.` : escW(g.src)}</div>
      ${g.cores ? `<details class="spec-src"><summary>${escW(g.name)}</summary>${escW(g.src)}${g.url ? ` <a href="${escW(g.url)}" target="_blank" rel="noopener">source</a>` : ''}</details>`
        : g.url ? `<div class="spec-src"><a href="${escW(g.url)}" target="_blank" rel="noopener">source</a></div>` : ''}` : ''}
  </div>`;
}

function renderSpecStep() {
  const s = STATE;
  if (!s || s.error) { $w('spec-cards').innerHTML = ''; return; }
  const stack = s.fac.profile.stack === 'nvidia' ? 'nvidia' : 'inferx';
  const keys = rolesFor({ stack, nodeKey: s.nodeKey });
  const pod = WEKAPODS[s.podKey];
  const podCard = `<div class="card">
    <h2>Storage node<span class="pill">× ${nfW(s.weka.nodes)}</span></h2>
    <span class="hint">${escW(pod.label)} · ${pod.ru}U · ${nfW(pod.watts)} W · ${nfW(pod.weightKg, 2)} kg</span>
    <div class="check-item info">A WEKApod is a qualified appliance: WEKA sells it as a fixed configuration and certifies its performance against that build, so its processor, memory and drives are chosen by picking a model on the storage step rather than part by part.</div>
    <table class="spec-sum"><tbody>
      <tr><td>Processor</td><td class="num">${escW(pod.cpu)}</td></tr>
      <tr><td>Memory</td><td class="num">${escW(fmtMem(pod.ramGB))}</td></tr>
      <tr><td>Drives</td><td class="num">${pod.drives} × ${pod.driveTB} TB ${escW(pod.driveType)}</td></tr>
      <tr><td>Throughput</td><td class="num">${pod.readGBs} / ${pod.writeGBs} GB/s per node</td></tr>
    </tbody></table>
    <table class="spec-net"><tbody>
      <tr><td>${escW(NET_FABRICS.ns.label)}</td><td>${escW(pod.net)}</td><td class="num">${pod.ports} × ${pod.portGb}G</td></tr>
      <tr><td>${escW(NET_FABRICS.oob.label)}</td><td>${escW(pod.mgmt)}</td><td class="num">${pod.mgmtPorts} × 1G</td></tr>
    </tbody></table></div>`;
  $w('spec-cards').innerHTML = keys.map((k) => specCard(s, k)).join('') + podCard;

  const specs = keys.map(serverSpec);
  const graded = specs.filter((x) => !x.fixed && roleGuide(x.def) && SPEC_GUIDES[roleGuide(x.def)].cores);
  const off = graded.filter((x) => !x.meets);
  const changed = specs.filter((x) => x.changed);
  $w('btn-spec-align').disabled = off.length === 0;
  const recounted = keys.filter((k) => { const b = roleCountBounds(k); return b && roleCount(s, k) !== b.def; });
  $w('btn-spec-reset').disabled = changed.length === 0 && recounted.length === 0;
  $w('w-spec-hint').innerHTML = off.length
    ? `${off.length} of the ${graded.length} roles NVIDIA publishes a specification for sit below the guideline NVIDIA publishes for them — ${off.map((x) => escW(x.def.label.toLowerCase())).join(', ')}. Aligning raises each to the processor the reference architecture names where its socket accepts one, or else the lowest-power part in its own option list that clears the figure, and leaves everything already over the bar alone.`
    : `Every configurable role meets its NVIDIA guideline.${changed.length ? ` ${changed.length} differ${changed.length === 1 ? 's' : ''} from the reference build.` : ''}${recounted.length ? ` ${recounted.map((k) => escW(SERVER_ROLES[k].label.toLowerCase())).join(' and ')} run${recounted.length === 1 ? 's' : ''} a different count from the reference architecture's.` : ''}`;

  $w('w-spec-basis').innerHTML = `NVIDIA's NCP material — the <a href="https://docs.nvidia.com/ncx/ncp-software-reference-guide/latest/software-reference-guide.html" target="_blank" rel="noopener">NCP Software Reference Guide</a> and <a href="https://docs.nvidia.com/dsx/ncp/nvidia-requirements-for-ai-clouds/introduction" target="_blank" rel="noopener">NVIDIA Requirements for AI Clouds</a> — is written as outcomes rather than parts: it states that compliance is judged on whether an implementation meets the stated outcome, and refers hardware detail to an access-controlled reference. It publishes no processor, memory or disk figures. The prescriptive specifications NVIDIA does publish are in the <a href="https://docs.nvidia.com/enterprise-reference-architecture/latest/index.html" target="_blank" rel="noopener">Enterprise Reference Architectures</a> and the NVL72 AI Factory RA, and those are the guideline used here — the same ones every NVIDIA-Certified system carrying these roles is built to.`;

  const totalW = specs.reduce((a, x) => a + x.watts * roleCount(s, x.role), 0);
  const cores = specs.reduce((a, x) => a + (x.cores || 0) * roleCount(s, x.role), 0);
  const ram = specs.reduce((a, x) => a + (x.ramGB || 0) * roleCount(s, x.role), 0);
  const disk = specs.reduce((a, x) => a + ((x.dataGB || 0) + (x.bootGB || 0)) * roleCount(s, x.role), 0);
  $w('live-spec').innerHTML = tiles([
    [nfW(specs.reduce((a, x) => a + roleCount(s, x.role), 0)), 'Servers configured'],
    [bigW(cores), 'x86 / Arm cores'],
    [`${nfW(ram / 1024, 0)}<small>TiB</small>`, 'System memory'],
    [`${nfW(disk / 1000, 0)}<small>TB</small>`, 'Local NVMe and SAS'],
    [`${nfW(totalW / 1000, 1)}<small>kW</small>`, 'Server power'],
    [off.length ? `${off.length} short` : 'Aligned', 'Against the NVIDIA guideline'],
  ]);
}

/* Findings the platform step contributes to the results page's design checks,
   so a build that sits under NVIDIA's guideline is visible from the summary
   and not only from the step that set it. */
function specNotes(s) {
  const stack = s.fac.profile.stack === 'nvidia' ? 'nvidia' : 'inferx';
  return rolesFor({ stack, nodeKey: s.nodeKey }).map(serverSpec).flatMap((sp) =>
    sp.checks.filter((c) => c.level !== 'info').map((c) => ({ level: c.level, text: `${sp.def.label}: ${c.text}` })));
}

/* ---------- results ---------- */
function renderResults() {
  const s = STATE;
  if (!s || s.error) {
    $w('results').innerHTML = `<div class="card"><div class="check-item critical"><span>${escW(s ? s.error : 'Cannot size')}</span></div></div>`;
    return;
  }
  const { inf, fac, layout, plan, weka } = s;
  const p = fac.power;
  const fig = rackFigures(s);
  const { groups } = fig;
  const allNotes = designNotes(s);

  const racksHtml = (side) => groups.map((g, i) => `
    <div class="ra-rack-unit" data-group="${i}">
      <div class="ra-name">${escW(g.rack.name.replace(/ \d+$/, ''))}${g.count > 1 ? ` <span style="color:var(--accent)">× ${g.count}</span>` : ''}</div>
      <div class="ra-sub">${g.rack.kind === 'cooling' ? `floor cabinet · ${escW(g.rack.devices[0].floorMM || '')}` : `${g.rack.devices.reduce((a, d) => a + d.ru, 0)}U used`}${g.count > 1 ? ` · ${g.count} identical ${g.rack.kind === 'cooling' ? 'cabinets' : 'racks'}` : ''}</div>
      ${fig.rack(g, side, i)}
    </div>`).join('');

  const sw = (col) => `<span class="swatch" style="background:${col}"></span>`;
  const line = (col, dashed) => `<span class="ra-line${dashed ? ' dashed' : ''}" style="--c:${col}"></span>`;
  const overviewLegend = `<div class="legend ra-legend">${fig.overviewLegend.map((l) => `<div class="legend-item">${sw(l.color)}${escW(l.text)}</div>`).join('')}</div>`;
  const cableLegend = `<div class="legend ra-legend">${fig.cableLegend.map((l) => `<div class="legend-item">${line(l.color, l.dashed)}${escW(l.text)}</div>`).join('')}</div>`;

  const viewHint = {
    front: inf.node.rackScale
      ? `Drawn to the real unit — ${inf.node.rack.computeTrays} × ${inf.node.rack.trayRu}U compute trays and ${inf.node.rack.switchTrays} × ${inf.node.rack.switchTrayRu}U NVLink switch trays in a ${RACK.totalU}U MGX rack, power shelves top and bottom${fac.cdu && fac.cdu.inRack ? ', CDU in the spare units' : ''}${weka.nodes ? `, WEKApod as a ${weka.pod.ru}U chassis` : ''}. Scroll sideways for the other racks, or click a rack in the overview.`
      : `Drawn to the real unit — ${escW(inf.node.label)} at ${layout.nodeRu}U${fac.cooling.cdu ? ' (DLC chassis)' : ''}${weka.nodes ? `, WEKApod as a ${weka.pod.ru}U chassis` : ''}. Scroll sideways for the other racks, or click a rack in the overview.`,
    rear: inf.node.rackScale
      ? 'An NVL72 tray is cabled from the front — its rear is busbar, manifold and NVLink cartridge — so the NVL72 racks are shown front-on here; the other racks show their port side. Ribbons run into the cable channel and out of the top of the rack toward the leaves that serve them.'
      : 'Ports face the rear. Ribbons run into the cable channel and out of the top of the rack toward the leaves that serve them; each header line gives the count, speed and destination.',
    topology: fac.nvidia
      ? `One leaf–spine panel per plane. Switch counts follow ${fac.profile.ra.name}'s own rules and match its published tables; the fan-out is schematic — a port map is detailed design.`
      : 'One leaf–spine panel per plane. Switch counts follow the oversubscription rules on the networking step; the fan-out is schematic — a port map is detailed design.',
  }[rackView];

  const rackBody = rackView === 'topology'
    ? `<div class="ra-topology">${fig.topology}</div>`
    : `<div class="ra-rack-row">${racksHtml(rackView)}</div>${rackView === 'rear' ? cableLegend : ''}`;

  $w('results').innerHTML = `
  <section class="card">
    <div class="hero">
      <div class="hero-figure"><div class="value">${nfW(inf.gpusDeployed)}</div>
        <div class="label">${escW(inf.gpu.short)} GPUs · ${nfW(inf.nodes)} ${escW(units(inf.node, inf.nodes))}</div></div>
      <div class="hero-figure"><div class="value">${nfW(fac.totalRacks)}<span class="unit">racks</span></div>
        <div class="label">${rackBreakdown(fac, 'mgmt')}</div></div>
      <div class="hero-figure"><div class="value">${nfW(p.totalW / 1000, 0)}<span class="unit">kW</span></div>
        <div class="label">Total IT load</div></div>
      <div class="hero-figure"><div class="value">${bigW(inf.clusterTps)}<span class="unit">tok/s</span></div>
        <div class="label">Cluster throughput</div></div>
      <div class="hero-driver">${escW(inf.model.label)} · ${escW(inf.precision.label)} · ${escW(fac.cooling.label)}</div>
    </div>
  </section>

  <section class="card">
    <h2>Solution summary</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Domain</th><th>Configuration</th><th class="num">Power</th><th class="num">Racks</th></tr></thead>
      <tbody>
        <tr><td><strong>Compute</strong></td><td>${nfW(inf.nodes)} × ${escW(inf.node.label)} (${escW(inf.node.sublabel)}), ${nfW(inf.gpusDeployed)} GPUs, TP ${inf.tp}, ${nfW(inf.deployedReplicas)} replicas</td><td class="num">${nfW(p.gpuNodeW / 1000, 1)} kW</td><td class="num">${fac.computeRacks}</td></tr>
        <tr><td><strong>Networking</strong></td><td>${fac.fabric.ewLeaves + fac.fabric.ewSpines} × ${escW(fac.fabric.ewSwitch.label)} east-west (${escW(FABRIC_TRANSPORTS[fac.fabric.ewTech].label)}, ${fac.fabric.ewOversub}:1), ${fac.fabric.nsLeaves + fac.fabric.nsSpines} × ${escW(fac.fabric.nsSwitch.label)} north-south (${escW(FABRIC_TRANSPORTS[fac.fabric.nsTech].label)}, ${fac.fabric.nsOversub}:1), ${fac.fabric.oobLeaves + fac.fabric.oobSpines} OOB${fac.fabric.oobRackLeaves ? ` + ${fac.fabric.oobRackLeaves} in-rack OOB` : ''}</td><td class="num">${nfW(p.switchW / 1000, 1)} kW</td><td class="num">${fac.fabricRacks}</td></tr>
        <tr><td><strong>Storage</strong></td><td>${nfW(weka.nodes)} × ${escW(weka.pod.model)} (${nfW(weka.ru)}U) · ${nfW(weka.netTB, 0)} TB usable at ${escW(weka.scheme.id)}+${weka.spares}VHS · ${nfW(weka.readGBs, 0)}/${nfW(weka.writeGBs, 0)} GB/s${fac.tier2Count ? ` · plus ${fac.tier2Count} × Tier 2 block storage` : fac.nvidia ? ' · NVIDIA-Certified Storage partner' : ''}</td><td class="num">${nfW(p.storageW / 1000, 1)} kW</td><td class="num">${fac.storageRacks}</td></tr>
        <tr><td><strong>Platform</strong></td><td>${fac.nvidia ? `Control-plane rack — ${escW(fac.mgmt.cpDesc)}` : 'Management rack — routers, platform servers, Tier 3, OOB firewalls, break-glass'}</td><td class="num">${nfW(p.mgmtW / 1000, 1)} kW</td><td class="num">1</td></tr>
        ${fac.cdu ? `<tr><td><strong>Cooling</strong></td><td>${fac.cdu.units} × ${escW(fac.cdu.spec.label)}${fac.cdu.inRack ? ' (in the compute racks)' : fac.cdu.spec.racksPerUnit > 1 ? ` (one per ${fac.cdu.spec.racksPerUnit} racks)` : ' (one beside each rack)'}</td><td class="num">${nfW(p.cduW / 1000, 1)} kW</td><td class="num">${fac.cduRacks || '—'}</td></tr>` : ''}
        <tr><td colspan="2"><strong>Total</strong></td><td class="num"><strong>${nfW(p.totalW / 1000, 1)} kW</strong></td><td class="num"><strong>${fac.totalRacks}</strong></td></tr>
      </tbody>
    </table></div>
  </section>

  <section class="card">
    <h2>Performance and facility</h2>
    <div class="tiles">
      <div class="tile"><div class="v">${nfW(inf.perUserTps, 1)}<small>tok/s</small></div><div class="k">Per-user speed</div></div>
      <div class="tile"><div class="v">${nfW(inf.tpotMs, 1)}<small>ms</small></div><div class="k">TPOT</div></div>
      <div class="tile"><div class="v">${nfW(inf.ttftMs, 0)}<small>ms</small></div><div class="k">TTFT</div></div>
      <div class="tile"><div class="v">${bigW(inf.reqPerHour)}</div><div class="k">Requests / hour</div></div>
      <div class="tile"><div class="v">${nfW(inf.deployedConcurrency)}</div><div class="k">Concurrency served</div></div>
      <div class="tile"><div class="v">${nfW(weka.readGBs / Math.max(1, inf.gpusDeployed), 1)}<small>GB/s</small></div><div class="k">Storage read per GPU</div></div>
      <div class="tile"><div class="v">${nfW(fac.weight.totalKg / 1000, 1)}<small>t</small></div><div class="k">Total IT weight</div></div>
      <div class="tile"><div class="v">${bigW(fac.coolingLoadBTU)}<small>BTU/hr</small></div><div class="k">Heat rejection</div></div>
      ${fac.tier2InCompute
        ? `<div class="tile"><div class="v">${nfW(p.rackWithTier2W / 1000, 1)}<small>kW</small></div><div class="k">Rack w/ Tier 2 (first ${fac.tier2Count})</div></div>
      <div class="tile"><div class="v">${nfW(p.rackPlainW / 1000, 1)}<small>kW</small></div><div class="k">Rack without Tier 2</div></div>`
        : `<div class="tile"><div class="v">${nfW(p.rackPlainW / 1000, 1)}<small>kW</small></div><div class="k">${fac.rackScale ? 'Per NVL72 rack' : `Per compute rack (${fac.cooling.gpuNodesPerRack} nodes)`}${fac.cdu && fac.cdu.inRack ? ' incl. CDU' : ''}</div></div>
      <div class="tile"><div class="v">${nfW(p.mgmtRackW / 1000, 1)}<small>kW</small></div><div class="k">${fac.nvidia ? 'Control-plane rack' : 'Management rack incl. Tier 2'}</div></div>`}
      <div class="tile"><div class="v">${escW(inf.node.feed || RACK.feed)}</div><div class="k">Per-rack feed</div></div>
    </div>
  </section>

  ${computeMemoryCard(inf)}
  ${gpuSpecCard(inf)}
  ${fabricCard(fac)}
  <section class="card">${storageTable(weka, fac)}</section>
  ${capacityCard(weka)}
  ${storageNodeCard(weka)}
  ${protectionCard(weka)}
  ${bomCard(inf, fac, weka)}
  ${opticsCard(cablingBOM({ fac, node: inf.node, gpuNodes: inf.nodes, weka }))}
  ${totalsCard(inf, fac, weka)}

  ${allNotes.length ? `<section class="card"><h2>Design checks</h2>
    ${[...allNotes].sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.level] - { critical: 0, warning: 1, info: 2 }[b.level]))
      .map((n) => `<div class="check-item ${escW(n.level)}"><span>${escW(n.text)}</span></div>`).join('')}
  </section>` : ''}

  <section class="card" id="ra-card">
    <h2>Racks and fabric — ${nfW(layout.racks.length)} racks, ${nfW(groups.length)} distinct layout${groups.length > 1 ? 's' : ''}</h2>
    <div class="ra-overview">${fig.overview}</div>
    ${overviewLegend}
    <div class="view-toggle">
      <button data-view="front" class="${rackView === 'front' ? 'on' : ''}">Front</button>
      <button data-view="rear" class="${rackView === 'rear' ? 'on' : ''}">Rear + cabling</button>
      <button data-view="topology" class="${rackView === 'topology' ? 'on' : ''}">Fabric topology</button>
      <span class="view-hint">${viewHint}</span>
    </div>
    ${rackBody}
    <div class="card-note">
      ${inf.node.rackScale
        ? `Elevations follow NVIDIA's and Supermicro's NVL72 rack: the OOB pair and four power shelves at the top, ${inf.node.rack.traysAbove} compute trays, the ${inf.node.rack.switchTrays} NVLink switch trays in the middle, ${inf.node.rack.computeTrays - inf.node.rack.traysAbove} more compute trays and the other four shelves${fac.cdu && fac.cdu.inRack ? ', with the 4U in-rack CDU in the spare units below' : ''}. The RA's ${fac.mgmt.cpCount} management nodes take a control-plane rack of their own${fac.cduRacks ? `; the ${fac.cduRacks} CDU cabinet${fac.cduRacks > 1 ? 's' : ''} take${fac.cduRacks > 1 ? '' : 's'} a floor position each` : ''}.`
        : fac.nvidia
          ? `Elevations follow ${escW(fac.profile.ra.name)} as an end-of-row design: ${fac.cooling.gpuNodesPerRack} GPU nodes per ${escW(fac.cooling.label.toLowerCase().replace(/ — .*$/, ''))} rack${fac.cooling.cdu ? ' with a 250 kW CDU at the base' : ''}${fac.fabric.oobRackLeaves ? ' under an in-rack SN2201' : ''}, the RA's ${fac.mgmt.cpCount} control-plane nodes in a rack of their own, the switch fabric ordered out-of-band then north-south then east-west in the fabric rack, and WEKApod chassis stacked from the top of the storage rack. The RA leaves nodes per rack to the available rack power; four is how Supermicro's NVIDIA-endorsed builds of it are racked.`
          : `Elevations follow the reference architecture: fixed management rack, ${fac.cooling.gpuNodesPerRack} GPU nodes per ${escW(fac.cooling.label.toLowerCase())} rack${fac.cooling.cdu ? ' with a 250 kW CDU at the base' : ''}, switch fabric ordered out-of-band then north-south then east-west, and WEKApod chassis stacked from the top of the storage rack.`} Unoccupied units are drawn as blanking panels, as in the source elevations.
      Cabling and topology are a planning sketch, not a wiring schedule — port-level assignment, cable lengths and breakout are detailed design.
    </div>
  </section>

  ${sourcesCard(fac)}`;

  $w('results').querySelectorAll('.view-toggle button').forEach((b) =>
    b.addEventListener('click', () => { rackView = b.dataset.view; renderResults(); }));
  // Clicking a rack in the overview brings its elevation into view.
  $w('results').querySelectorAll('.ra-ov-group').forEach((g) =>
    g.addEventListener('click', () => {
      if (rackView === 'topology') { rackView = 'front'; renderResults(); }
      const unit = $w('results').querySelector(`.ra-rack-unit[data-group="${g.dataset.group}"]`);
      if (unit) unit.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }));
}

/* ---------- navigation ----------
   Every step is always in the DOM; the workload step is simply skipped over
   when the compute step is running the default profile, so the journey is
   Compute -> Networking without it. It stays visible in the stepper, greyed,
   rather than disappearing — a step that vanishes reads as a bug, and the
   greyed one advertises that manual parameters exist. */
function workloadManual() {
  return $w('w-wlmode').value === 'manual';
}

function stepEnabled(i) {
  return i !== WORKLOAD_STEP || workloadManual();
}

/* The next enabled step in `dir`, or null at either end. */
function seek(from, dir) {
  for (let i = from + dir; i >= 0 && i <= LAST_STEP; i += dir) {
    if (stepEnabled(i)) return i;
  }
  return null;
}

function paint() {
  document.querySelectorAll('.step').forEach((el) => { el.hidden = +el.dataset.step !== step; });

  const order = STEPS.map((_, i) => i).filter(stepEnabled);
  $w('stepper').querySelectorAll('button').forEach((b, i) => {
    b.disabled = !stepEnabled(i);
    b.classList.toggle('skipped', !stepEnabled(i));
    b.classList.toggle('active', i === step);
    b.classList.toggle('done', stepEnabled(i) && i < step);
    b.title = stepEnabled(i) ? '' : 'Skipped — the compute step is using the default workload profile';
  });

  $w('w-back').disabled = seek(step, -1) === null;
  $w('w-next').textContent = step === LAST_STEP ? 'Done' : 'Next →';
  $w('w-next').disabled = seek(step, 1) === null;
  $w('w-pos').textContent = `Step ${order.indexOf(step) + 1} of ${order.length} — ${STEPS[step]}`;

  if (step === LAST_STEP) renderResults();
}

function go(n) {
  let target = Math.max(0, Math.min(LAST_STEP, n));
  // Landing on a skipped step (a stale position left behind by switching back
  // to the default workload, say) carries on in the direction of travel rather
  // than trapping the user on a hidden step.
  if (!stepEnabled(target)) {
    const dir = target >= step ? 1 : -1;
    target = seek(target, dir) ?? seek(target, -dir) ?? 0;
  }
  step = target;
  paint();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function refresh() {
  // Default mode pins the workload controls to the reference profile, so a set
  // of values left behind by an earlier manual session cannot quietly go on
  // driving the sizing from a step the user can no longer see.
  const manual = workloadManual();
  if (!manual) {
    Object.entries(DEFAULT_WORKLOAD).forEach(([id, v]) => { $w(id).value = v; });
  }
  $w('w-wlmode-hint').textContent = manual
    ? 'The workload step is in the journey; set the model, concurrency and latency targets there.'
    : 'The workload step is skipped. Performance is calculated from the reference profile below.';

  $w('w-tpot-val').textContent = $w('w-tpot').value;
  $w('w-ttft-val').textContent = $w('w-ttft').value;
  $w('w-gbpergpu-val').textContent = $w('w-gbpergpu').value;

  // Nodes and racks are two views of the same quantity, so only one is editable;
  // the other is locked and shows what it works out to.
  const basis = $w('w-basis').value;
  const byNodes = basis === 'nodes';
  const byRacks = basis === 'racks';
  $w('w-nodes').disabled = !byNodes;
  $w('w-racks').disabled = !byRacks;
  $w('f-nodes').classList.toggle('locked', !byNodes);
  $w('f-racks').classList.toggle('locked', !byRacks);
  const profNow = RA_PROFILES[$w('w-profile').value];
  const nodeNow = syncNodeOptions(profNow);
  const coolNow = syncCoolingOptions(profNow, nodeNow);
  const coolRule = RACK.cooling[coolNow];
  const perRackNow = coolRule.gpuNodesPerRack;
  const rs = !!nodeNow.rackScale;
  const su = profNow.stack === 'nvidia' && profNow.suNodes > 1 ? profNow.suNodes : 0;
  $w('f-nodes').querySelector('label').textContent = rs ? Units(nodeNow, 2) : 'GPU nodes';
  $w('f-racks').querySelector('label').textContent = rs ? 'Compute racks (same thing)' : 'Compute racks';
  $w('w-basis-hint').textContent = basis === 'workload'
    ? 'Concurrency and the latency target decide the fleet; both fields below are derived.'
    : rs ? 'The NVL72 is bought by the rack, so the two counts are one and the same.'
      : byNodes ? `Node count is fixed; rack count follows from the cooling choice.${su ? ` ${profNow.ra.name} grows in ${su}-node scalable units.` : ''}`
        : 'Rack count is fixed; node count follows from the cooling choice.';
  $w('w-racks-hint').textContent = rs
    ? `One ${nodeNow.label} system per rack — ${nodeNow.rack.computeTrays} compute trays × ${nodeNow.rack.gpusPerTray} GPUs, one NVLink domain; the RA's scalable unit.`
    : `${perRackNow} GPU nodes per ${coolNow === 'liquid' ? 'DLC' : 'air-cooled'} rack${coolNow === 'air4' ? (su === 4 ? ' — one scalable unit per rack, as Supermicro\'s NVIDIA-endorsed builds of this RA and the DGX SuperPOD RA rack them' : ', as the DGX SuperPOD RA racks them') : ''}.`;

  // The three storage inputs are three views of one cluster, so only the one
  // the basis names is editable; the others stay visible but locked, showing
  // what the chosen basis works out to.
  const mode = $w('w-stmode').value;
  const byRatio = mode === 'ratio';
  const byCap = mode === 'capacity';
  const byManual = mode === 'manual';
  $w('w-gbpergpu').disabled = !byRatio;
  $w('w-captb').disabled = !byCap;
  $w('w-stnodes').disabled = !byManual;
  $w('f-ratio').classList.toggle('locked', !byRatio);
  $w('f-cap').classList.toggle('locked', !byCap);
  $w('f-manual').classList.toggle('locked', !byManual);

  const prof = profNow;
  const node = nodeNow;
  $w('w-profile-hint').textContent = prof.desc;
  // The node hint quotes the build as configured on the platform step, not the
  // catalogue's reference figure, so the two steps cannot disagree about what
  // a node draws.
  const nodeW = specWatts($w('w-node').value, node.watts);
  const nodeKg = specWeight($w('w-node').value, node.weightKg);
  const rep = node.system ? ` · representative NVIDIA-Certified system: ${node.system}` : '';
  $w('w-node-hint').textContent = node.rackScale
    ? `Whole ${RACK.totalU}U rack · ${node.rack.computeTrays} × ${node.rack.trayRu}U trays (${node.rack.gpusPerTray}× ${GPUS[node.gpuKey].short} + ${node.rack.cpusPerTray}× Grace each) · ${node.rack.switchTrays} NVLink switch trays · ${node.gpuCount} GPUs in one NVLink domain · ${nfW(nodeW / 1000)} kW · ~${nfW(nodeKg)} kg · ${nfW(node.ramGB / 1000, 1)} TB LPDDR5X${rep}`
    : `${node.ru}U · ${node.gpuCount}× ${GPUS[node.gpuKey].short} · ${nfW(nodeW)} W · ${nfW(nodeKg, 1)} kg · ${escW(serverSpec($w('w-node').value).cpuLabel || node.cpu)} · ${node.eastWest}${rep}`;
  const coolSpec = RACK.cooling[$w('w-cooling').value];
  const cduSpec = coolSpec && coolSpec.cdu ? INFRA[coolSpec.cduKey || 'cdu'] : null;
  const airN = prof.coolingSet === 'nvidia' ? 4 : 2;
  $w('w-cool-hint').textContent = node.rackScale
    ? (coolSpec.inRack
      ? `Liquid-cooled only. A 4U ${cduSpec.label.replace(/^Supermicro /, '')} sits in the rack's spare units (${cduSpec.watts / 1000} kW, ${cduSpec.weightKg} kg) — facility water to every rack.`
      : cduSpec.racksPerUnit > 1
        ? `Liquid-cooled only. One ${cduSpec.label.replace(/^Supermicro /, '')} cabinet serves up to ${cduSpec.racksPerUnit} racks (${cduSpec.watts / 1000} kW, ${nfW(cduSpec.weightKg)} kg, ${cduSpec.floorMM}) — facility water to the row.`
        : `Liquid-cooled only. A ${cduSpec.label.replace(/^Supermicro /, '')} cabinet beside every rack rejects the heat to room air (${cduSpec.watts / 1000} kW, ${nfW(cduSpec.weightKg)} kg, ${cduSpec.floorMM}) — no facility water, but the room must carry the load.`)
    : node.liquidCapable
      ? `Air puts ${airN} nodes in a rack${airN === 4 ? ` (${nfW(4 * nodeW / 1000, 1)} kW)` : ''}; DLC puts 8 in ${node.ruLiquid || node.ru}U chassis with a 250 kW CDU.`
      : `${node.sublabel.replace(/ — .*$/, '')} is air-cooled only${airN === 4 ? `: ${airN} nodes per rack, ${nfW(4 * nodeW / 1000, 1)} kW` : ''}.`;
  const m = MODELS[$w('w-model').value];
  $w('w-model-hint').textContent = `${(m.params / 1e9).toFixed(1)}B params${m.moe ? ` (${(m.activeParams / 1e9).toFixed(1)}B active)` : ''} · ${m.layers} layers · ${m.kvHeads} KV heads`;

  // Whichever mode is active, show what the sizing is actually running on.
  $w('w-wl-summary').innerHTML = `<tbody>
    <tr><td>Model</td><td class="num">${escW(m.label)}</td></tr>
    <tr><td>Precision</td><td class="num">${escW(PRECISIONS[$w('w-precision').value].label)}</td></tr>
    <tr><td>Concurrent requests</td><td class="num">${nfW(+$w('w-conc').value)}</td></tr>
    <tr><td>Prompt / output tokens</td><td class="num">${nfW(+$w('w-prompt').value)} / ${nfW(+$w('w-out').value)}</td></tr>
    <tr><td>TPOT target</td><td class="num">${nfW(+$w('w-tpot').value)} ms</td></tr>
    <tr><td>TTFT target</td><td class="num">${nfW(+$w('w-ttft').value)} ms</td></tr>
    <tr><td>Tensor parallel</td><td class="num">${$w('w-tp').value || 'Auto'}</td></tr>
  </tbody>`;

  STATE = computeAll();
  // Reflect the solved figures back into whichever field is locked.
  if (STATE && !STATE.error) {
    if (!byNodes) $w('w-nodes').value = STATE.inf.nodes;
    if (!byRacks) $w('w-racks').value = STATE.fac.computeRacks;
    const wk = STATE.weka;
    if (!byManual) $w('w-stnodes').value = wk.nodes;
    if (!byCap) $w('w-captb').value = Math.round(wk.netTB);
    if (!byRatio) {
      const perGpu = wk.readGBs / Math.max(1, STATE.inf.gpusDeployed);
      $w('w-gbpergpu').value = Math.min(20, Math.max(1, Math.round(perGpu)));
      $w('w-gbpergpu-val').textContent = $w('w-gbpergpu').value;
    }
  }
  renderLive();
  renderSpecStep();
  if (stepEnabled(step)) paint(); else go(step);
}

/* The bill of materials on its own, as a spreadsheet: the hardware lines and
   the optics lines, from the same functions the results page renders. */
function exportBOMXLSX() {
  if (!STATE || STATE.error) return;
  const { inf, fac, weka } = STATE;
  const p = fac.power;
  const date = new Date().toISOString().slice(0, 10);
  const stack = fac.profile.stack === 'nvidia' ? 'nvidia' : 'inferx';
  XLSXExport.exportBOM({
    hardware: hardwareBOM({ r: inf, fac, weka }),
    optics: cablingBOM({ fac, node: inf.node, gpuNodes: inf.nodes, weka }),
    specs: rolesFor({ stack, nodeKey: STATE.nodeKey })
      .map((k) => ({ spec: serverSpec(k), qty: roleCount(STATE, k), guides: SPEC_GUIDES, guideKey: roleGuide(SERVER_ROLES[k]) })),
    meta: {
      title: 'InferX Solution Sizing — Bill of Materials',
      context: [
        ['Generated', date],
        ['Reference architecture', fac.nvidia ? `${fac.profile.ra.name} — ${fac.profile.ra.pattern}` : `InferX reference design — ${fac.profile.label}`],
        ['Compute', `${nfW(inf.nodes)} × ${inf.node.label} (${inf.node.sublabel}) · ${nfW(inf.gpusDeployed)} × ${inf.gpu.short}`],
        ['Cooling', fac.cooling.label],
        ['Fabric', `${fac.fabric.ewLeaves + fac.fabric.ewSpines} × ${fac.fabric.ewSwitch.label} ${fac.fabric.consolidated ? 'converged' : 'east-west'}, ${fac.fabric.nsLeaves + fac.fabric.nsSpines} × ${fac.fabric.nsSwitch.label} north-south, ${fac.fabric.oobLeaves + fac.fabric.oobSpines + (fac.fabric.oobRackLeaves || 0)} out-of-band`],
        ['Storage', `${nfW(weka.nodes)} × ${weka.pod.model} · ${nfW(weka.netTB, 0)} TB usable at ${weka.scheme.id}+${weka.spares}VHS`],
        ['Racks', `${nfW(fac.totalRacks)} — ${rackBreakdown(fac)}`],
        ['Total IT load', `${nfW(p.totalW / 1000, 1)} kW`],
        ['Total IT weight', `${nfW(fac.weight.totalKg / 1000, 2)} t`],
        ['Workload sized against', `${inf.model.label} at ${inf.precision.label}`],
        ['Server builds', Object.keys(SERVER_CONFIG).length
          ? `${Object.keys(SERVER_CONFIG).length} role(s) configured away from the reference build — see the Server Specifications sheet`
          : 'Every server as its reference architecture specifies it'],
      ],
    },
    fileName: `inferx-bill-of-materials-${date}.xlsx`,
  });
}

function exportCSV() {
  if (!STATE || STATE.error) return;
  const { inf, fac, weka, stNodes } = STATE;
  const spec = gpuSpecSheet(inf.gpu, inf.gpusDeployed);
  const rows = [
    ['InferX guided sizing'], ['Generated', new Date().toISOString()], [],
    ['Compute'],
    ['Reference architecture', fac.nvidia ? `${fac.profile.ra.name} — ${fac.profile.ra.pattern}` : `InferX — ${fac.profile.label}`],
    ['Model', inf.model.label], ['Precision', inf.precision.label],
    ['GPU node', `${inf.node.label} (${inf.node.sublabel})`],
    [Units(inf.node, 2), inf.nodes], ['GPUs', inf.gpusDeployed], ['Tensor parallel', inf.tp],
    ['Batch per replica', inf.batch], ['Batch limited by', inf.batchLimit],
    ['Per-user tok/s', inf.perUserTps.toFixed(1)], ['TPOT ms', inf.tpotMs.toFixed(1)],
    ['TTFT ms', inf.ttftMs.toFixed(0)], ['Cluster tok/s', Math.round(inf.clusterTps)],
    ['Concurrency served', inf.deployedConcurrency],
    [],
    ['GPU specification (per GPU, dense rates)'],
    ...spec.rows.map(([k, v, note]) => [k, String(v).replace(/<[^>]*>/g, ''), note]),
    ['Fleet FP16 PFLOPS', (spec.fleet.fp16PFLOPS || 0).toFixed(1)],
    ['Fleet INT8 POPS', (spec.fleet.int8POPS || 0).toFixed(1)],
    ['Fleet GPU memory TB', spec.fleet.memTB.toFixed(1)],
    ['Fleet memory bandwidth TB/s', spec.fleet.bwTBs.toFixed(1)],
    [],
    ['Networking'],
    ['East-west transport', `${FABRIC_TRANSPORTS[fac.fabric.ewTech].label} — ${fac.fabric.ewSwitch.label}`],
    ['East-west', `${fac.fabric.ewLeaves} leaf + ${fac.fabric.ewSpines} spine @ ${fac.fabric.ewOversub}:1`],
    ['North-south transport', `${FABRIC_TRANSPORTS[fac.fabric.nsTech].label} — ${fac.fabric.nsSwitch.label}`],
    ['North-south', `${fac.fabric.nsLeaves} leaf + ${fac.fabric.nsSpines} spine @ ${fac.fabric.nsOversub}:1`],
    ['Out-of-band', `${fac.fabric.oobLeaves} leaf + ${fac.fabric.oobSpines} spine`],
    [],
    ['Storage'],
    ['Appliance', `${weka.pod.family} ${weka.pod.model}`],
    ['Nodes', weka.nodes], ['Rack units', weka.ru],
    ['NVMe per node', `${weka.pod.drives} x ${weka.pod.driveTB} TB ${weka.pod.driveType}`],
    ['Raw TB', weka.rawTB.toFixed(0)], ['Usable TB', weka.netTB.toFixed(0)],
    ['Protection', `${weka.scheme.id}+${weka.spares}VHS`],
    ['Read GB/s', weka.readGBs.toFixed(0)], ['Write GB/s', weka.writeGBs.toFixed(0)],
    ['Read IOPS', Math.round(weka.readIops)], ['Write IOPS', Math.round(weka.writeIops)],
    ['Storage kW', (weka.watts / 1000).toFixed(1)], ['Storage kg', weka.weightKg.toFixed(0)],
    [],
    ['Facility'],
    ['Cooling', fac.cooling.label], ['Total racks', fac.totalRacks],
    ['Compute racks', fac.computeRacks], ['Fabric racks', fac.fabricRacks],
    ['Storage racks', fac.storageRacks], ['CDU cabinets', fac.cduRacks || 0],
    ...(fac.cdu ? [['CDU', `${fac.cdu.units} x ${fac.cdu.spec.label}`], ['CDU kW', (fac.power.cduW / 1000).toFixed(1)]] : []),
    ['Total IT kW', (fac.power.totalW / 1000).toFixed(1)],
    ['Per compute rack kW', (fac.power.perComputeRackW / 1000).toFixed(1)],
    ['Total weight kg', fac.weight.totalKg.toFixed(0)],
    ['Cooling BTU/hr', Math.round(fac.coolingLoadBTU)],
    [],
    ['Design checks'], ...designNotes(STATE).map((n) => [n.level, n.text]),
  ];
  const csv = rows.map((r) => r.map((c) => {
    const v = String(c ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'inferx-guided-sizing.csv'; a.click();
  URL.revokeObjectURL(url);
}

/* Slide copy for the PowerPoint export: the title and teal strapline of each
   card's slide, the bold takeaway under it where one earns its place, and the
   five at-a-glance cards. Keyed by the card's on-page heading. */
function deckCopy(s) {
  const { inf, fac, weka, layout, plan } = s;
  const p = fac.power, fb = fac.fabric;
  const switches = fb.ewLeaves + fb.ewSpines + fb.nsLeaves + fb.nsSpines + fb.oobLeaves + fb.oobSpines;
  const notes = designNotes(s);
  const crit = notes.filter((n) => n.level === 'critical').length;
  const warn = notes.filter((n) => n.level === 'warning').length;
  const groups = new Set(layout.racks.map((rk) => rk.kind + '|' + rk.devices.map((d) => `${d.type}:${d.ru}@${d.uTop}`).join(','))).size;
  const ewT = FABRIC_TRANSPORTS[fb.ewTech].label, nsT = FABRIC_TRANSPORTS[fb.nsTech].label;
  const ratio = (r) => `${r}:1${r === 1 ? ' non-blocking' : ''}`;

  const copy = [
    [/^Solution summary/, { title: 'Solution Summary', sub: `${nfW(inf.gpusDeployed)} ${inf.gpu.short} GPUs across ${nfW(fac.totalRacks)} racks at ${nfW(p.totalW / 1000, 0)} kW`,
      takeaway: `${nfW(inf.nodes)} × ${inf.node.label} serving ${inf.model.label} at ${inf.precision.label}, ${fac.cooling.label.toLowerCase()}.` }],
    [/^Performance and facility/, { title: 'Performance and Facility', sub: `${nfW(inf.perUserTps, 1)} tok/s per user · ${nfW(inf.deployedConcurrency)} concurrent requests`,
      takeaway: `${bigW(inf.clusterTps)} tok/s cluster throughput at ${nfW(inf.tpotMs, 1)} ms TPOT and ${nfW(inf.ttftMs, 0)} ms TTFT.` }],
    [/^Memory per GPU/, { title: 'Memory per GPU', sub: `${inf.gpu.short} · ${nfW(inf.gpuMemGB)} GB ${inf.gpu.memType} · batch ${nfW(inf.batch)} per replica`,
      takeaway: `Batch is capped by ${inf.batchLimit}: KV memory allows ${nfW(inf.memBatch)}, the TPOT target allows ${nfW(inf.tpotBatch)}.` }],
    [/^GPU specification/, { title: 'GPU Specification', sub: `${inf.node.sublabel} × ${nfW(inf.gpusDeployed)}` }],
    [/^Fabric$/, { title: 'Network Fabric', sub: `${ewT} east-west ${fb.ewOversub}:1 · ${nsT} north-south ${fb.nsOversub}:1`,
      takeaway: `${switches} switches: ${fb.ewLeaves + fb.ewSpines} east-west, ${fb.nsLeaves + fb.nsSpines} north-south, ${fb.oobLeaves + fb.oobSpines} out-of-band.` }],
    [/^WEKApod storage/, { title: 'WEKApod Storage', sub: `${nfW(weka.netTB, 0)} TB usable · ${nfW(weka.readGBs, 0)} GB/s read · ${nfW(weka.nodes)} × ${weka.pod.model}`,
      takeaway: `${nfW(weka.readGBs / Math.max(1, inf.gpusDeployed), 1)} GB/s of read throughput per GPU.` }],
    [/^Where the raw capacity goes/, { title: 'Capacity Waterfall', sub: `${nfW((weka.netTB / weka.rawTB) * 100, 0)}% of raw capacity is usable at ${weka.scheme.id}+${weka.spares}VHS` }],
    [/^WEKApod node/, { title: 'WEKApod Node', sub: `${weka.pod.model} · configuration, memory and throughput ceiling` }],
    [/^Protection scheme/, { title: 'Protection Scheme', sub: `Trade-off at ${nfW(weka.nodes)} nodes · ${weka.scheme.id} selected` }],
    [/^Bill of materials/, { title: 'Bill of Materials', sub: `${nfW(inf.nodes)} GPU nodes · ${switches} switches · ${nfW(weka.nodes)} WEKApods` }],
    [/^Optics, transceivers/, { title: 'Optics and Cabling', sub: `${nfW(fb.ewPorts)} east-west node ports · ${nfW(fb.nsPorts)} north-south endpoint ports` }],
    [/^Cluster totals/, { title: 'Cluster Totals', sub: `${nfW(p.totalW / 1000, 0)} kW · ${nfW(fac.weight.totalKg / 1000, 1)} t · ${nfW(fac.totalRacks)} racks` }],
    [/^Design checks/, { title: 'Design Checks', sub: `${nfW(notes.length)} note${notes.length === 1 ? '' : 's'}${crit || warn ? ` · ${crit} critical, ${warn} warning` : ' · no critical findings'}` }],
    [/^Racks and fabric/, { title: 'Racks and Fabric', sub: `${nfW(layout.racks.length)} racks, ${nfW(groups)} distinct layout${groups > 1 ? 's' : ''}`,
      takeaway: `${rackBreakdown(fac)}, ${fac.cooling.label.toLowerCase()}.` }],
  ];

  const cards = [
    { n: '01', title: 'Compute', status: `${inf.gpu.short} · ${fac.cooling.label}`, value: `${nfW(inf.gpusDeployed)} GPUs`,
      body: `${nfW(inf.nodes)} × ${inf.node.sublabel}.\n${inf.model.label} at ${inf.precision.label}, TP ${inf.tp}, ${nfW(inf.deployedReplicas)} replicas.` },
    { n: '02', title: 'Networking', status: `${ewT} · ${ratio(fb.ewOversub)}`, value: `${switches} switches`,
      body: `${fb.ewLeaves + fb.ewSpines} east-west, ${fb.nsLeaves + fb.nsSpines} north-south, ${fb.oobLeaves + fb.oobSpines} out-of-band.\n${nfW(fb.ewPorts)} × ${fb.ewSwitch.portGb}G node ports.` },
    { n: '03', title: 'Storage', status: `WEKApod · ${weka.scheme.id}+${weka.spares}VHS`, value: `${nfW(weka.netTB, 0)} TB usable`,
      body: `${nfW(weka.nodes)} × ${weka.pod.model}.\n${nfW(weka.readGBs, 0)} / ${nfW(weka.writeGBs, 0)} GB/s read / write.` },
    { n: '04', title: 'Facility', status: `${fac.totalRacks} racks · ${inf.node.feed || RACK.feed}`, value: `${nfW(p.totalW / 1000, 0)} kW`,
      body: `${rackBreakdown(fac).replace(/ · /g, ', ')}.\n${nfW(fac.weight.totalKg / 1000, 1)} t · ${bigW(fac.coolingLoadBTU)} BTU/hr.` },
    { n: '05', title: 'Performance', status: 'Roofline estimate', value: `${bigW(inf.clusterTps)} tok/s`, highlight: true,
      body: `${nfW(inf.perUserTps, 1)} tok/s per user at ${nfW(inf.tpotMs, 1)} ms TPOT.\n${nfW(inf.deployedConcurrency)} concurrent requests, ${bigW(inf.reqPerHour)} requests/hour.` },
  ];

  return {
    kicker: 'INFERX SOLUTION SIZING',
    title: 'InferX Solution Sizing',
    subtitle: `${inf.model.label} · ${inf.precision.label} · ${fac.cooling.label}`,
    cards,
    glance: { title: 'Solution at a Glance', sub: `${inf.model.label} at ${inf.precision.label} on ${inf.node.sublabel}`,
      takeaway: fac.nvidia
        ? `Sized on ${fac.profile.ra.name} (${fac.profile.ra.pattern}): ${inf.node.rackScale ? 'GB300 NVL72 rack-scale compute' : `${inf.node.label} nodes`}, Spectrum-X fabric per the RA and WEKA as NVIDIA-Certified Storage.`
        : `Sized on the InferX reference architecture: Supermicro compute, ${ewT} fabric and WEKA storage.` },
    copy: (heading) => {
      const hit = copy.find(([re]) => re.test(heading));
      if (hit) return hit[1];
      const [title, ...rest] = heading.split(' — ');
      return { title, sub: rest.join(' — ') };
    },
  };
}

/* The deck is built from the rendered results, so they are rendered first if
   the user exports from an earlier step. */
async function exportPPTX() {
  if (!STATE || STATE.error) return;
  const btn = $w('btn-pptx');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Exporting…';
  try {
    if (step !== LAST_STEP) renderResults();
    const fig = rackFigures(STATE);
    const date = new Date().toISOString().slice(0, 10);
    await PPTXExport.exportDeck({
      results: $w('results'),
      figures: {
        groups: fig.groups, rack: fig.rack, overview: fig.overview,
        topology: (only) => RARack.renderTopology(STATE.plan, { racks: STATE.layout.racks, only }),
        planes: Object.keys(STATE.plan.roles).filter((r) => STATE.plan.roles[r].leaves).map((r) => ({ key: r, title: STATE.plan.roles[r].title })),
        overviewLegend: fig.overviewLegend.map((l) => ({ text: l.text, color: l.color })),
        cableLegend: fig.cableLegend.map((l) => ({ text: l.text, color: l.color, line: true, dashed: !!l.dashed })),
      },
      meta: { ...deckCopy(STATE), date, fileName: `inferx-solution-sizing-${date}.pptx` },
    });
  } catch (e) {
    console.error(e);
    alert(`PowerPoint export failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

fill();
document.querySelectorAll('.wizard select, .wizard input').forEach((el) => {
  el.addEventListener('input', refresh);
  el.addEventListener('change', refresh);
});
$w('w-back').addEventListener('click', () => { const n = seek(step, -1); if (n !== null) go(n); });
$w('w-next').addEventListener('click', () => { const n = seek(step, 1); if (n !== null) go(n); });
$w('btn-print').addEventListener('click', () => window.print());
$w('btn-csv').addEventListener('click', exportCSV);
$w('btn-bom').addEventListener('click', exportBOMXLSX);

/* The platform cards are rebuilt on every refresh, so their controls are
   bound by delegation rather than individually. */
$w('spec-cards').addEventListener('change', (e) => {
  const el = e.target.closest('select[data-role], input[data-role]');
  if (!el) return;
  const { role, part } = el.dataset;
  if (part === 'count') {
    const b = roleCountBounds(role);
    SERVER_COUNTS[role] = Math.max(b.min, Math.min(b.max, Math.round(+el.value) || b.def));
    refresh();
    return;
  }
  const cfg = SERVER_CONFIG[role] || (SERVER_CONFIG[role] = { ...serverDefaults(role) });
  cfg[part] = part.endsWith('Qty') ? +el.value : el.value;
  refresh();
});
$w('btn-spec-align').addEventListener('click', () => {
  if (!STATE || STATE.error) return;
  const stack = STATE.fac.profile.stack === 'nvidia' ? 'nvidia' : 'inferx';
  rolesFor({ stack, nodeKey: STATE.nodeKey }).forEach((k) => {
    const cfg = alignToGuide(k);
    if (cfg) SERVER_CONFIG[k] = cfg;
  });
  refresh();
});
$w('btn-spec-reset').addEventListener('click', () => {
  Object.keys(SERVER_CONFIG).forEach((k) => delete SERVER_CONFIG[k]);
  Object.keys(SERVER_COUNTS).forEach((k) => delete SERVER_COUNTS[k]);
  refresh();
});
$w('btn-pptx').addEventListener('click', exportPPTX);
$w('btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme',
    cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'));
});

refresh();
go(0);
