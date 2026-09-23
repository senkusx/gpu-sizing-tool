/* Compute sizing page — form wiring and rendering. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const big = (n) => (n >= 1e6 ? `${nf(n / 1e6, 1)}M` : n >= 1e3 ? `${nf(n / 1e3, 1)}k` : nf(n, 0));

let LAST = null;

/* The profile decides which nodes and cooling options are offered: the
   InferX tiers list the InferX chassis with air/DLC, each NVIDIA reference
   architecture lists its own node with the RA's four-per-rack air rule or
   DLC, and the NVL72 its three CDU arrangements. Lists are rebuilt only when
   the profile changes, keeping the current choice where it is still offered. */
function syncNodeOptions(profile) {
  const sel = $('node');
  const have = [...sel.options].map((o) => o.value);
  if (have.join() !== profile.nodes.join()) {
    const keep = profile.nodes.includes(sel.value) ? sel.value : profile.defaultNode;
    sel.innerHTML = profile.nodes.map((k) => `<option value="${k}">${esc(GPU_NODES[k].sublabel)}</option>`).join('');
    sel.value = keep;
  }
  return GPU_NODES[sel.value];
}
function syncCoolingOptions(profile, node) {
  const sel = $('cooling');
  const set = profile.coolingSet || 'inferx';
  const want = Object.keys(RACK.cooling).filter((k) => (RACK.cooling[k].sets || ['inferx']).includes(set));
  const have = [...sel.options].map((o) => o.value);
  if (have.join() !== want.join()) {
    sel.innerHTML = want.map((k) => `<option value="${k}">${esc(RACK.cooling[k].label)}</option>`).join('');
    sel.value = node.rackScale ? (node.defaultCooling || want[0]) : (profile.defaultCooling || want[0]);
  }
  const lc = sel.querySelector('option[value="liquid"]');
  if (lc) {
    lc.disabled = !node.liquidCapable;
    lc.textContent = node.liquidCapable ? 'Direct liquid cooled — 8 nodes/rack + CDU' : 'Direct liquid cooled — not available for this node';
    if (!node.liquidCapable && sel.value === 'liquid') sel.value = profile.defaultCooling || want[0];
  }
  return sel.value;
}

function fillSelects() {
  const groups = [['inferx', 'InferX federation tiers'], ['nvidia', 'NVIDIA reference architectures']];
  $('profile').innerHTML = groups.map(([g, title]) => `<optgroup label="${esc(title)}">${Object.entries(RA_PROFILES)
    .filter(([, v]) => v.group === g).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</optgroup>`).join('');
  $('profile').value = 'regional';
  syncNodeOptions(RA_PROFILES.regional);
  $('model').innerHTML = Object.entries(MODELS)
    .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('precision').innerHTML = Object.entries(PRECISIONS)
    .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('node').value = 'smc-b300';
  $('model').value = 'llama31-70b';
  $('precision').value = 'fp8';
}

function readInput() {
  return {
    profileKey: $('profile').value,
    nodeKey: $('node').value,
    coolingKey: $('cooling').value,
    modelKey: $('model').value,
    precisionKey: $('precision').value,
    concurrentRequests: Math.max(1, +$('concurrent').value || 1),
    promptTokens: Math.max(1, +$('promptTokens').value || 1),
    outputTokens: Math.max(1, +$('outputTokens').value || 1),
    tpotTargetMs: +$('tpot').value,
    ttftTargetMs: +$('ttft').value,
    tpOverride: $('tp').value ? +$('tp').value : null,
    wekapods: Math.max(0, +$('wekapods').value || 0),
    basis: $('basis').value,
    fixedNodesInput: Math.max(1, +$('fixedNodes').value || 1),
    fixedRacksInput: Math.max(1, +$('fixedRacks').value || 1),
    customModel: null,
  };
}

/* ---------- cards ---------- */
function heroCard(r, f) {
  return `<section class="card">
    <div class="hero">
      <div class="hero-figure">
        <div class="value">${nf(r.gpusDeployed)}</div>
        <div class="label">${esc(r.gpu.short)} GPUs across ${nf(r.nodes)} node${r.nodes > 1 ? 's' : ''}${r.fixedNodes ? ' (fixed)' : ''}</div>
      </div>
      <div class="hero-figure">
        <div class="value" style="${r.shortfall ? 'color:var(--warning)' : ''}">${nf(r.deployedConcurrency)}</div>
        <div class="label">Concurrent requests carried${r.shortfall ? ' — short of target' : ''}</div>
      </div>
      <div class="hero-figure">
        <div class="value">${nf(f.totalRacks)}<span class="unit">racks</span></div>
        <div class="label">${f.computeRacks} compute · ${f.fabricRacks} fabric · ${f.storageRacks} storage · ${f.mgmtRacks} mgmt</div>
      </div>
      <div class="hero-figure">
        <div class="value">${nf(f.power.totalW / 1000, 0)}<span class="unit">kW</span></div>
        <div class="label">Total IT load</div>
      </div>
      <div class="hero-driver">TP ${r.tp} · batch ${r.batch} · ${r.deployedReplicas} replica${r.deployedReplicas > 1 ? 's' : ''}</div>
    </div>
  </section>`;
}

function perfCard(r) {
  const tiles = [
    ['Per-user speed', `${nf(r.perUserTps, 1)}<small>tok/s</small>`, 'What one request sees'],
    ['TPOT', `${nf(r.tpotMs, 1)}<small>ms</small>`, 'Time per output token'],
    ['TTFT', `${nf(r.ttftMs, 0)}<small>ms</small>`, 'Prefill, compute bound'],
    ['Cluster throughput', `${big(r.clusterTps)}<small>tok/s</small>`, 'Aggregate decode'],
    ['Requests / hour', big(r.reqPerHour), `At ${nf(r.ctxTokens)} tokens each`],
    ['Concurrency served', nf(r.deployedConcurrency), `${nf(r.batch)} per replica`],
  ];
  return `<section class="card">
    <h2>Delivered performance</h2>
    <div class="tiles">
      ${tiles.map(([k, v, s]) => `<div class="tile"><div class="v">${v}</div><div class="k">${esc(k)}</div><div class="k" style="opacity:.7">${esc(s)}</div></div>`).join('')}
    </div>
    <div class="card-note">
      Decode is memory-bandwidth bound: each step streams the active weights once plus the KV cache of every sequence in the batch, so per-user speed falls as batch grows while aggregate throughput rises. Batch here is capped by <strong>${esc(r.batchLimit)}</strong> — KV memory would allow ${nf(r.memBatch)}, the TPOT target allows ${nf(r.tpotBatch)}.
      Prefill is compute bound at 2 FLOPs per active parameter per prompt token.
    </div>
  </section>`;
}

function memoryCard(r) {
  const weightsPerGpu = r.weightsGB / r.tp;
  const kvPerGpu = (r.batch * r.kvPerSeqGB) / r.tp;
  const ws = SERVING.workspaceGB;
  const total = r.gpuMemGB;
  const seg = (v, c, l) => `<div style="width:${(v / total) * 100}%;background:${c}" title="${l}"></div>`;
  return `<section class="card">
    <h2>Memory per GPU — ${esc(r.gpu.short)}, ${nf(total)} GB ${esc(r.gpu.memType)}</h2>
    <div style="display:flex;height:22px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border);margin-bottom:12px">
      ${seg(weightsPerGpu, 'var(--series-1)', 'Weights')}
      ${seg(kvPerGpu, 'var(--series-2)', 'KV cache')}
      ${seg(ws, 'var(--series-3)', 'Workspace')}
      <div style="flex:1;background:var(--surface-2)"></div>
    </div>
    <div class="legend">
      <div class="legend-item"><span class="swatch" style="background:var(--series-1)"></span>Weights ${nf(weightsPerGpu, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-2)"></span>KV cache ${nf(kvPerGpu, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--series-3)"></span>Workspace ${nf(ws, 1)} GB</div>
      <div class="legend-item"><span class="swatch" style="background:var(--surface-2);border:1px solid var(--border)"></span>Free ${nf(Math.max(0, total - r.perGpuMemGB), 1)} GB</div>
    </div>
    <div class="card-note">
      Full model at ${esc(r.precision.label)} is ${nf(r.weightsGB, 1)} GB across ${r.tp} GPU${r.tp > 1 ? 's' : ''}. Each sequence costs ${nf(r.kvPerSeqGB * 1024, 1)} MB of KV at ${nf(r.ctxTokens)} tokens, sized on ${r.model.kvHeads} KV heads rather than ${r.model.heads} attention heads — grouped-query attention is what makes long context affordable.
    </div>
  </section>`;
}

function gpuSpecCard(r) {
  const s = gpuSpecSheet(r.gpu, r.gpusDeployed);
  const f = s.fleet;
  const na = (v, unit, dp = 1) => (v === null ? '<span style="opacity:.55">n/p</span>' : `${nf(v, dp)}<small>${unit}</small>`);
  const tiles = [
    [na(f.fp16PFLOPS, 'PFLOPS'), 'FP16 / BF16 dense', `${nf(r.gpusDeployed)} × ${nf(r.gpu.denseTFLOPS.bf16 || 0)} TFLOPS`],
    [na(f.fp8PFLOPS, 'PFLOPS'), 'FP8 dense', 'Serving precision on this fleet'],
    [na(f.int8POPS, 'POPS'), 'INT8 dense', 'Same tensor rate as FP8'],
    [f.fp4PFLOPS === null ? '<span style="opacity:.55">—</span>' : na(f.fp4PFLOPS, 'PFLOPS'), 'FP4 dense', f.fp4PFLOPS === null ? 'Not supported by this GPU' : 'Blackwell only'],
    [na(f.memTB, 'TB', 1), 'Aggregate GPU memory', `${nf(r.gpu.memGB)} GB × ${nf(r.gpusDeployed)}`],
    [na(f.bwTBs, 'TB/s', 1), 'Aggregate memory bandwidth', 'What decode actually spends'],
    [f.tensorCores === null ? '<span style="opacity:.55">n/p</span>' : nf(f.tensorCores), 'Tensor cores', f.cudaCores === null ? 'Count not published for this part' : `${nf(f.cudaCores)} CUDA cores`],
    [f.fp32TFLOPS === null ? '<span style="opacity:.55">n/p</span>' : `${nf(f.fp32TFLOPS)}<small>TFLOPS</small>`, 'FP32 vector', 'Non-tensor kernels'],
  ];
  return `<section class="card">
    <h2>GPU specification — ${esc(r.gpu.label)}</h2>
    <div class="tiles" style="margin-bottom:16px">
      ${tiles.map(([v, k, sub]) => `<div class="tile"><div class="v">${v}</div><div class="k">${esc(k)}</div><div class="k" style="opacity:.7">${esc(sub)}</div></div>`).join('')}
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>Per GPU</th><th class="num">Figure</th><th class="num">Note</th></tr></thead>
      <tbody>${s.rows.map(([k, v, note]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td class="num" style="color:var(--text-muted)">${esc(note)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">
      Every tensor figure is the <strong>dense</strong> rate. ${esc(s.sparsityNote)} FP16 and BF16 share a tensor-core rate, and INT8 runs at the FP8 rate — NVIDIA's own datasheets list them as the same number. FP32 is the vector rate on the CUDA cores, which is why it sits three orders of magnitude below the tensor columns; it matters for pre- and post-processing, not for serving.
      ${r.gpu.tensorCores ? '' : 'NVIDIA does not publish SM, CUDA-core or tensor-core counts for the HGX Blackwell parts, so those rows read <em>not published</em> rather than carrying a guess; vector FP32 it does publish. '}Source: ${esc(r.gpu.src)}.
    </div>
  </section>`;
}

function facilityCard(f, input) {
  const p = f.power;
  const rows = [
    ['GPU compute nodes', `${nf(p.gpuNodeW / 1000, 1)} kW`],
    f.cooling.cdu ? ['CDUs', `${nf(p.cduW / 1000, 1)} kW`] : null,
    p.tier2W ? [`Tier 2 block storage (${f.tier2Count} unit${f.tier2Count > 1 ? 's' : ''})`, `${nf(p.tier2W / 1000, 1)} kW`] : null,
    ['Fabric switching', `${nf(p.switchW / 1000, 1)} kW`],
    p.storageW ? ['WEKApod storage', `${nf(p.storageW / 1000, 1)} kW`] : null,
    [f.nvidia ? `Control-plane rack (${f.mgmt.cpCount} nodes)` : 'Management rack', `${nf(p.mgmtW / 1000, 1)} kW`],
  ].filter(Boolean);
  const unitWord = f.rackScale ? 'NVL72 rack' : 'compute rack';

  return `<section class="card">
    <h2>Facility</h2>
    <div class="tiles" style="margin-bottom:16px">
      <div class="tile"><div class="v">${nf(f.totalRacks)}</div><div class="k">Racks, ${RACK.totalU}U ${RACK.widthMM}×${RACK.depthMM} mm</div></div>
      ${f.tier2InCompute
        ? `<div class="tile"><div class="v">${nf(p.rackWithTier2W / 1000, 1)}<small>kW</small></div><div class="k">Compute rack with Tier 2 (first ${f.tier2Count})</div></div>
      <div class="tile"><div class="v">${nf(p.rackPlainW / 1000, 1)}<small>kW</small></div><div class="k">Compute rack without</div></div>`
        : `<div class="tile"><div class="v">${nf(p.rackPlainW / 1000, 1)}<small>kW</small></div><div class="k">Per ${esc(unitWord)}${f.cdu && f.cdu.inRack ? ' incl. CDU' : ''}</div></div>
      <div class="tile"><div class="v">${nf(p.mgmtRackW / 1000, 1)}<small>kW</small></div><div class="k">${f.nvidia ? 'Control-plane rack' : 'Management rack'}</div></div>`}
      <div class="tile"><div class="v">${nf(f.weight.totalKg / 1000, 1)}<small>t</small></div><div class="k">Total IT weight</div></div>
      <div class="tile"><div class="v">${big(f.coolingLoadBTU)}<small>BTU/hr</small></div><div class="k">Heat rejection</div></div>
      <div class="tile"><div class="v">${nf(f.rackUsedPct, 0)}<small>%</small></div><div class="k">Compute rack U used (${f.rackU} of ${RACK.totalU})</div></div>
      <div class="tile"><div class="v">${esc(f.node.feed || RACK.feed)}</div><div class="k">Per-rack power feed</div></div>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>Power draw</th><th class="num">Load</th></tr></thead>
      <tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('')}
        <tr><td><strong>Total IT load</strong></td><td class="num"><strong>${nf(p.totalW / 1000, 1)} kW</strong></td></tr>
      </tbody>
    </table></div>
    <div class="card-note">
      ${f.nvidia
        ? `Rack composition follows ${esc(f.profile.ra.name)}: ${f.rackScale ? 'one NVL72 rack per scalable unit' : `${f.cooling.gpuNodesPerRack} GPU nodes per ${esc(f.cooling.label.toLowerCase().replace(/ — .*$/, ''))} rack${f.cooling.cdu ? ' alongside a 250 kW CDU' : ''}`}, no Tier 2 block storage, and the RA's ${f.mgmt.cpCount} control-plane nodes in a rack of their own. The RA leaves nodes per rack to the available rack power; four per rack is how Supermicro's NVIDIA-endorsed builds of the Enterprise RAs and the DGX SuperPOD RA rack them.`
        : `Rack composition follows the reference architecture exactly: ${f.cooling.gpuNodesPerRack} GPU nodes per ${esc(f.cooling.label.toLowerCase())} rack${f.cooling.cdu ? ' alongside a 250 kW CDU' : ''}, with Tier 2 block storage at the base of the first ${f.tier2Count} compute rack${f.tier2Count > 1 ? 's' : ''} only — the reference designs carry exactly ${RACK.tier2Units} Tier 2 units regardless of how many racks they run to, which is why the elevations quote two different compute-rack totals.
      ${f.cooling.cdu ? '' : `At ${nf(p.rackPlainW / 1000, 1)} kW the air-cooled rack sits well inside what a ${esc(RACK.feed)} feed could carry, so the two-node limit is a thermal and fabric choice rather than a power one.`}`}
      Heat rejection is the IT load converted at 3.412 BTU/hr per watt and excludes facility overhead — apply your target PUE on top.
    </div>
  </section>`;
}

function fabricCard(f) {
  const fb = f.fabric;
  const ew = fb.ewSwitch, ns = fb.nsSwitch;
  const nv = f.nvidia;
  const rows = [
    [fb.consolidated ? 'Converged leaf (E/W + N/S)' : 'East-west leaf', `${fb.ewLeaves} × ${ew.label}`, `${fb.ewOversub}:1${fb.ewOversub === 1 ? ' non-blocking' : ''}${nv && fb.linksPerPort > 1 ? ', dual plane' : ''}`, nv ? `${nf(fb.ewPorts)} × 400G links` : `${nf(fb.ewPorts)} node ports`],
    [fb.consolidated ? 'Converged spine' : 'East-west spine', fb.ewSpines ? `${fb.ewSpines} × ${ew.label}` : '—', `${fb.ewOversub}:1`, '—'],
    ['North-south leaf', fb.consolidated ? '— on the converged leaves' : `${fb.nsLeaves} × ${ns.label}`, fb.consolidated ? 'consolidated' : `${fb.nsOversub}:1${fb.nsOversub === 1 ? ' non-blocking' : ''}`, nv ? `${nf(fb.nsPorts)} node ports + storage, customer, support, uplinks` : `${nf(fb.nsPorts)} node ports`],
    ['North-south spine', fb.nsSpines ? `${fb.nsSpines} × ${ns.label}` : fb.nsCollapsed ? '— leaf pair with inter-switch link' : '—', fb.consolidated ? '—' : `${fb.nsOversub}:1`, '—'],
    ['OOB leaf', `${fb.oobLeaves} × ${FABRIC.sn2201.label}${fb.oobRackLeaves ? ` + ${fb.oobRackLeaves} in the compute racks` : ''}`, nv ? 'single-homed' : 'dual-homed', `${nf(fb.oobPorts)} ${nv ? 'links' : 'ports'}`],
    ['OOB spine', fb.oobSpines ? `${fb.oobSpines} × ${FABRIC.sn4600c.label}` : nv ? '— uplinks land on the converged fabric' : '—', '—', '—'],
  ];
  return `<section class="card">
    <h2>Fabric</h2>
    <div class="table-scroll"><table>
      <thead><tr><th>Layer</th><th>Switches</th><th>Oversubscription</th><th class="num">Server-facing</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td class="num">${esc(r[3])}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="card-note">
      ${nv
        ? `Switch counts follow <strong>${esc(f.profile.ra.name)}</strong> — its scalable unit, dual-plane or single-plane compute fabric, converged north-south allocations and out-of-band rule — and reproduce the RA's published switch counts at every design point it documents. Out-of-band counts every device (the RA's CAT6 table covers the compute nodes alone), which can add one SN2201 over the RA's node-only figure.`
        : `Switch counts are <strong>derived</strong> from the oversubscription rules — both planes default to 1:1 non-blocking, against the reference architecture's 4:1 north-south — with cages treated as 2×400G because the BOM specifies MMS4X00-NS twin-port transceivers. They are not read from a port map, so a detailed design may differ by a switch or two; at the reference settings this model derives 29 SN5610 on the 2 MW core design against the 32 in the elevation. Transport is chosen on the <a href="index.html">guided journey</a>; this page sizes the Ethernet fabric.`}
    </div>
  </section>`;
}

function checksCard(r, f) {
  const all = [...r.notes, ...((f && f.notes) || [])];
  if (!all.length) {
    return `<section class="card"><h2>Design checks</h2><div class="check-item good"><span>All checks passed.</span></div></section>`;
  }
  const order = { critical: 0, warning: 1, info: 2 };
  const notes = all.sort((a, b) => order[a.level] - order[b.level]);
  return `<section class="card">
    <h2>Design checks</h2>
    ${notes.map((n) => `<div class="check-item ${esc(n.level)}"><span>${esc(n.text)}</span></div>`).join('')}
  </section>`;
}

function bomCard(r, f, input) {
  // Watts are carried as numbers so the table can total them. The GPU line is a
  // component of the node above it, so it is priced per unit but excluded from
  // the sum — its power is already inside the node figure.
  const kw = (w) => (w >= 10000 ? `${nf(w / 1000, 1)} kW` : `${nf(w)} W`);
  const rows = [
    [`${esc(r.node.label)} — ${esc(r.node.sublabel)}${r.node.system ? ` (${esc(r.node.system)})` : ''}`, r.nodes, r.node.watts, `${nf(r.node.weightKg, 1)} kg`],
    [`${esc(r.gpu.label)}`, r.gpusDeployed, r.gpu.tdpW, `${nf(r.gpu.memGB)} GB`, true],
    [`${f.fabric.ewSwitch.label} — east-west, ${FABRIC_TRANSPORTS[f.fabric.ewTech].label}`, f.fabric.ewLeaves + f.fabric.ewSpines, f.fabric.ewSwitch.watts, `${nf(f.fabric.ewSwitch.weightKg, 1)} kg`],
    [`${f.fabric.nsSwitch.label} — north-south, ${FABRIC_TRANSPORTS[f.fabric.nsTech].label}`, f.fabric.nsLeaves + f.fabric.nsSpines, f.fabric.nsSwitch.watts, `${nf(f.fabric.nsSwitch.weightKg, 1)} kg`],
    [`${FABRIC.sn2201.label} — OOB leaf`, f.fabric.oobLeaves, FABRIC.sn2201.watts, `${nf(FABRIC.sn2201.weightKg, 1)} kg`],
    f.fabric.oobSpines ? [`${FABRIC.sn4600c.label} — OOB spine`, f.fabric.oobSpines, FABRIC.sn4600c.watts, `${nf(FABRIC.sn4600c.weightKg, 1)} kg`] : null,
    input.wekapods ? [`${INFRA.wekapod.label}`, input.wekapods, INFRA.wekapod.watts, `${nf(INFRA.wekapod.weightKg, 1)} kg`] : null,
    f.cdu ? [`${f.cdu.spec.label}`, f.cdu.units, f.cdu.spec.watts, `${nf(f.cdu.spec.weightKg, 1)} kg`] : null,
    f.fabric.oobRackLeaves ? [`${FABRIC.sn2201.label} — in-rack OOB`, f.fabric.oobRackLeaves, FABRIC.sn2201.watts, `${nf(FABRIC.sn2201.weightKg, 1)} kg`] : null,
    // Tier 2 sits at the base of the first few compute racks in every design, so
    // it follows the facility model's count rather than the rack count — that is
    // what makes the total below reconcile with the Facility card.
    f.power.tier2W ? [`${INFRA.tier2.label} — ${INFRA.tier2.model}`, f.tier2Count, INFRA.tier2.watts, `${nf(INFRA.tier2.weightKg, 1)} kg`] : null,
    f.nvidia
      ? [`${INFRA['cp-node'].label} — ${esc(f.mgmt.cpDesc)}`, f.mgmt.cpCount, INFRA['cp-node'].watts, `${nf(INFRA['cp-node'].weightKg, 1)} kg`]
      : [`Management rack (${RACK.mgmtRack.contents.length} devices)`, 1, RACK.mgmtRack.watts, `${nf(RACK.mgmtRack.weightKg, 1)} kg`],
  ].filter(Boolean);
  const rowTotal = rows.reduce((sum, x) => sum + (x[4] ? 0 : x[1] * x[2]), 0);

  // Compute power, three ways: the whole GPU fleet, one node, one GPU. The
  // per-GPU figure is the node's draw divided by its GPUs, so it carries the
  // CPU, NIC and fan overhead the bare TDP leaves out.
  const computeW = r.nodes * r.node.watts;
  const perGpuW = r.node.watts / r.node.gpuCount;
  const siliconW = r.gpusDeployed * r.gpu.tdpW;
  const tiles = [
    [`${nf(computeW / 1000, 1)}<small>kW</small>`, 'GPU compute, cluster-wide', `${nf(r.nodes)} node${r.nodes > 1 ? 's' : ''} · ${nf((computeW / f.power.totalW) * 100, 0)}% of IT load`],
    [`${nf(r.node.watts)}<small>W</small>`, 'Per GPU node', `${esc(r.node.sublabel)}, ${r.node.gpuCount}× ${esc(r.gpu.short)}`],
    [`${nf(perGpuW, 0)}<small>W</small>`, 'Per GPU, node share', `Node draw ÷ ${r.node.gpuCount} GPUs`],
    [`${nf(r.gpu.tdpW, 0)}<small>W</small>`, 'Per GPU, silicon TDP', `${nf(siliconW / 1000, 1)} kW of the ${nf(computeW / 1000, 1)} kW — ${nf((siliconW / computeW) * 100, 0)}%`],
  ];

  return `<section class="card">
    <h2>Bill of materials</h2>
    <div class="tiles" style="margin-bottom:16px">
      ${tiles.map(([v, k, s]) => `<div class="tile"><div class="v">${v}</div><div class="k">${esc(k)}</div><div class="k" style="opacity:.7">${s}</div></div>`).join('')}
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit power</th><th class="num">Total power</th><th class="num">Unit weight / spec</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${x[0]}</td><td class="num">${nf(x[1])}</td><td class="num">${nf(x[2])} W</td><td class="num">${x[4]
        ? `<span style="opacity:.6">${kw(x[1] * x[2])} in node</span>` : kw(x[1] * x[2])}</td><td class="num">${x[3]}</td></tr>`).join('')}
        <tr><td><strong>Total IT load</strong></td><td class="num"></td><td class="num"></td><td class="num"><strong>${nf(rowTotal / 1000, 1)} kW</strong></td><td class="num"></td></tr>
      </tbody>
    </table></div>
    <div class="card-note">
      ${f.nvidia ? `${esc(f.profile.ra.name)} defines the node as a pattern and a minimum specification and publishes no node power or weight; those come from the representative NVIDIA-Certified system named on the node line (${esc(r.node.src)}).` : 'Part numbers and per-unit power come from the reference architecture BOM and rack elevations.'} The GPU line is priced per unit for reference only — those watts are already inside the node's ${nf(r.node.watts)} W, so the total counts each node once. Every figure is nameplate draw at full load; a fleet running a real serving mix sits below it, and none of it includes cooling or facility overhead.
    </div>
  </section>`;
}

function sourcesCard(r, f) {
  const raLine = f && f.nvidia
    ? `<li><strong>${esc(f.profile.ra.name)}</strong> — <a href="${esc(f.profile.ra.url)}" target="_blank" rel="noopener">${esc(f.profile.ra.cite)}</a>. Node pattern ${esc(f.profile.ra.pattern)}; scalable unit, tested range, fabric rules and control plane are taken from it and the engine reproduces its published switch counts. Node power and weight: ${esc(r.node.src)}.</li>`
    : `<li><strong>Node power, weight, rack composition</strong> — InferX reference architecture elevations and BOM. Verified against their own totals: air B300 rack 28,986 W, liquid rack 115,380 W, 128-node fleet 1,779,072 W.</li>`;
  return `<section class="card">
    <h2>Sources and method</h2>
    <ul class="sources">
      ${raLine}
      <li><a href="https://github.com/onepunk/open-gpu-db" target="_blank" rel="noopener">open-gpu-db</a> (Apache-2.0) — GPU specifications. Its TDP figures independently agree with the BOM (B300 1400 W, RTX PRO 6000 600 W). It carries no bandwidth data, so bandwidth and dense low-precision compute come from NVIDIA's published specs.</li>
      <li><strong>Die-level figures</strong> — SM, CUDA-core and tensor-core counts are NVIDIA's published values for the Hopper, Ada and RTX Blackwell parts; it publishes none of them for the HGX Blackwell parts, so the spec sheet says <em>not published</em> there rather than carrying an estimate. Vector FP32 is published for all of them. FP16 is shown at the BF16 tensor rate, and INT8 at the FP8 rate except where a part publishes its own figure — Blackwell Ultra trades INT8 for NVFP4 and is far slower at it than its FP8 rate would suggest. Every tensor figure is dense: where NVIDIA quotes a rate with sparsity, it is halved here.</li>
      <li><a href="https://github.com/kkpkishan/llm-infra-planner" target="_blank" rel="noopener">LLMcalc</a> (MIT) — memory and roofline formulas: weights, KV cache, activation and throughput.</li>
      <li><a href="https://github.com/onepunk/llmsizer" target="_blank" rel="noopener">llmsizer</a> (MIT) — quantisation-aware sizing and tensor-parallel scaling behaviour.</li>
    </ul>
    <div class="disclaimer">
      <strong>What is solid and what is not.</strong> Memory arithmetic is exact — weights and KV cache follow directly from the model architecture, and the facility roll-up reproduces the reference architecture's own rack and power totals. The <em>performance</em> figures are a roofline model: ${Math.round(SERVING.bwEfficiency * 100)}% of peak bandwidth in decode and ${Math.round(SERVING.flopEfficiency * 100)}% of dense peak in prefill. Those two efficiency factors are the least-grounded numbers here — they reflect typical vLLM and TensorRT-LLM behaviour, not a benchmark of this reference architecture. Real throughput depends on the serving stack, scheduling, chunked prefill and speculative decoding. Treat throughput as a planning estimate and validate against a benchmark before committing to an SLA.
    </div>
  </section>`;
}

/* ---------- render ---------- */
function render() {
  const input = readInput();
  $('tpot-val').textContent = input.tpotTargetMs;
  $('ttft-val').textContent = input.ttftTargetMs;

  const profile = RA_PROFILES[input.profileKey];
  const node = syncNodeOptions(profile);
  input.nodeKey = $('node').value;
  $('profile-hint').textContent = profile.desc;
  $('node-hint').textContent = node.rackScale
    ? `Whole ${RACK.totalU}U rack · ${node.rack.computeTrays} trays × ${node.rack.gpusPerTray} ${GPUS[node.gpuKey].short} · ${nf(node.watts / 1000)} kW · ~${nf(node.weightKg)} kg${node.system ? ` · representative build: ${node.system}` : ''}`
    : `${node.ru}U · ${node.gpuCount}× ${GPUS[node.gpuKey].short} · ${nf(node.watts)} W · ${node.cpu} · ${nf(node.ramGB)} GB RAM${node.system ? ` · representative NVIDIA-Certified system: ${node.system}` : ''}`;
  const m = MODELS[input.modelKey];
  $('model-hint').textContent = `${(m.params / 1e9).toFixed(1)}B params${m.moe ? ` (${(m.activeParams / 1e9).toFixed(1)}B active)` : ''} · ${m.layers} layers · ${m.kvHeads} KV heads · ${nf(m.ctxMax)} ctx`;

  // Cooling options follow the profile's set; liquid only where the node
  // supports it.
  const coolSel = $('cooling');
  syncCoolingOptions(profile, node);

  // Sizing basis. Nodes and racks are two views of the same quantity, so only
  // one is editable; the other is locked and shows what it works out to.
  const perRack = RACK.cooling[coolSel.value].gpuNodesPerRack;
  const byNodes = input.basis === 'nodes';
  const byRacks = input.basis === 'racks';
  $('fixedNodes').disabled = !byNodes;
  $('fixedRacks').disabled = !byRacks;
  $('f-nodes').classList.toggle('locked', !byNodes);
  $('f-racks').classList.toggle('locked', !byRacks);
  $('basis-hint').textContent = input.basis === 'workload'
    ? 'Concurrency and the latency target decide the fleet; both fields below are derived.'
    : byNodes ? 'Node count is fixed; rack count follows from the cooling choice.'
      : 'Rack count is fixed; node count follows from the cooling choice.';
  $('racks-hint').textContent = node.rackScale
    ? `One NVL72 rack per scalable unit — ${node.rack.computeTrays} trays × ${node.rack.gpusPerTray} GPUs.`
    : `${perRack} GPU nodes per ${coolSel.value === 'liquid' ? 'DLC' : 'air-cooled'} rack${coolSel.value === 'air4' ? ' (one scalable unit)' : ''}.`;
  input.fixedNodes = byNodes ? input.fixedNodesInput
    : byRacks ? input.fixedRacksInput * perRack : null;

  const r = sizeInference(input);
  if (r.error) {
    $('results').innerHTML = `<section class="card"><h2>Cannot size this configuration</h2>
      <div class="check-item critical"><span>${esc(r.error)}</span></div></section>`;
    LAST = null;
    return;
  }

  const f = sizeFacility({
    gpuNodes: r.nodes, nodeKey: input.nodeKey, coolingKey: coolSel.value,
    profileKey: input.profileKey, storageNodes: input.wekapods,
  });

  if (!f.nvidia && r.nodes < profile.minGpuNodes) {
    r.notes.push({ level: 'info', text: `The ${profile.label} profile assumes at least ${profile.minGpuNodes} GPU nodes; this workload needs ${r.nodes}. The smaller footprint is fine, but the profile's fabric and storage assumptions may be heavier than required.` });
  }

  // Reflect the solved figures back into whichever field is locked.
  if (!byNodes) $('fixedNodes').value = r.nodes;
  if (!byRacks) $('fixedRacks').value = f.computeRacks;

  LAST = { input, r, f };
  // Published for the rack elevation page.
  try {
    localStorage.setItem('inferx-compute-config', JSON.stringify({
      ...input, coolingKey: coolSel.value, gpuNodes: r.nodes,
    }));
  } catch (e) { /* private mode */ }

  $('results').innerHTML = [
    heroCard(r, f), perfCard(r), gpuSpecCard(r), memoryCard(r),
    facilityCard(f, input), fabricCard(f), bomCard(r, f, input),
    checksCard(r, f), sourcesCard(r, f),
  ].join('');
}

function exportCSV() {
  if (!LAST) return;
  const { input, r, f } = LAST;
  const rows = [
    ['InferX compute sizing'],
    ['Generated', new Date().toISOString()],
    [],
    ['Workload'],
    ['Model', r.model.label], ['Precision', r.precision.label],
    ['Prompt tokens', input.promptTokens], ['Output tokens', input.outputTokens],
    ['Concurrent requests', input.concurrentRequests],
    ['TPOT target ms', input.tpotTargetMs], ['TTFT target ms', input.ttftTargetMs],
    [],
    ['Compute'],
    ['Reference architecture', f.nvidia ? `${f.profile.ra.name} — ${f.profile.ra.pattern}` : `InferX — ${f.profile.label}`],
    ['GPU node', `${r.node.label} (${r.node.sublabel})`],
    ['Nodes', r.nodes], ['GPUs', r.gpusDeployed], ['GPU model', r.gpu.label],
    ['Tensor parallel', r.tp], ['Batch per replica', r.batch], ['Batch limited by', r.batchLimit],
    ['Replicas', r.deployedReplicas], ['Concurrency served', r.deployedConcurrency],
    ['GPU compute load kW', ((r.nodes * r.node.watts) / 1000).toFixed(1)],
    ['Per GPU node kW', (r.node.watts / 1000).toFixed(2)],
    ['Per GPU node share W', (r.node.watts / r.node.gpuCount).toFixed(0)],
    ['Per GPU silicon TDP W', r.gpu.tdpW],
    [],
    ['GPU specification (per GPU, dense rates)'],
    ...gpuSpecSheet(r.gpu, r.gpusDeployed).rows.map(([k, v, note]) =>
      [k, String(v).replace(/<[^>]*>/g, ''), note]),
    [],
    ['Performance (modelled)'],
    ['Per-user tokens/sec', r.perUserTps.toFixed(1)],
    ['TPOT ms', r.tpotMs.toFixed(1)], ['TTFT ms', r.ttftMs.toFixed(0)],
    ['Cluster tokens/sec', Math.round(r.clusterTps)],
    ['Requests/hour', Math.round(r.reqPerHour)],
    [],
    ['Facility'],
    ['Cooling', f.cooling.label],
    ['Total racks', f.totalRacks], ['Compute racks', f.computeRacks],
    ['Fabric racks', f.fabricRacks], ['Storage racks', f.storageRacks],
    ['Total IT load kW', (f.power.totalW / 1000).toFixed(1)],
    ['Per compute rack kW', (f.power.perComputeRackW / 1000).toFixed(1)],
    ['Total weight kg', f.weight.totalKg.toFixed(0)],
    ['Cooling load BTU/hr', Math.round(f.coolingLoadBTU)],
    [],
    ['Fabric'],
    ['East-west leaf', f.fabric.ewLeaves], ['East-west spine', f.fabric.ewSpines],
    ['North-south leaf', f.fabric.nsLeaves], ['North-south spine', f.fabric.nsSpines],
    ['OOB leaf', f.fabric.oobLeaves], ['OOB spine', f.fabric.oobSpines],
    [],
    ['Design checks'],
    ...[...r.notes, ...(f.notes || [])].map((n) => [n.level, n.text]),
  ];
  const csv = rows.map((row) => row.map((c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'inferx-compute-sizing.csv'; a.click();
  URL.revokeObjectURL(url);
}

fillSelects();
document.querySelectorAll('select, input').forEach((el) => {
  el.addEventListener('input', render);
  el.addEventListener('change', render);
});
$('btn-print').addEventListener('click', () => window.print());
$('btn-csv').addEventListener('click', exportCSV);
$('btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark'
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', next);
});
render();
