/* Inference sizing engine — pure functions, no DOM.

   Method follows the formulas documented by LLMcalc (kkpkishan/llm-infra-planner,
   MIT) and llmsizer (onepunk/llmsizer, MIT):

     weights   = params x bytes_per_param
     KV cache  = 2 x layers x kv_heads x head_dim x bytes  (per token, per sequence)
     decode    = roofline on memory bandwidth
     prefill   = roofline on dense low-precision FLOPS

   The decode model is the standard batched one: each decode step streams the
   whole weight set once plus the KV of every sequence in the batch, so

     step_time    = (weights + batch x kv_per_seq) / effective_bandwidth
     cluster_tps  = batch / step_time
     per_user_tps = 1 / step_time

   Per-user speed therefore falls as batch grows while aggregate throughput
   rises — which is exactly the trade-off a TPOT service level pins down. */

const GiB = 1024 ** 3;

/* KV cache bytes for one token of one sequence. Two tensors (K and V) per
   layer, sized by the grouped-query KV head count rather than the full head
   count — the difference is large on modern models. */
function kvBytesPerToken(model, precision) {
  return 2 * model.layers * model.kvHeads * model.headDim * precision.kvBytes;
}

/* Weight footprint in bytes, including packing overhead. MoE models must hold
   every expert resident even though only a few activate per token. */
function weightBytes(model, precision) {
  return model.params * precision.bytes * SERVING.weightOverhead;
}

/* Tensor-parallel efficiency. Splitting a model across N GPUs costs a fixed
   fraction per doubling, and costs far more without NVLink. */
/* Efficiency of a tensor-parallel group `tp` GPUs wide.

   Each doubling costs a fixed fraction, and which fraction applies depends on
   what that doubling crosses. Doublings that stay inside one coherent domain —
   an NVSwitch baseboard, or the 72-GPU NVLink domain of an NVL72 — pay the
   NVLink cost; on a PCIe part they pay the PCIe cost. Doublings that take the
   group past the domain cross the east-west fabric, which carries an order of
   magnitude less bandwidth than NVLink, and pay the fabric cost.

   This used to charge the NVLink rate for every doubling however wide the
   group grew, which contradicted the note the results page prints for a
   rack-scale system — that tensor parallelism up to 72 "stays on NVLink",
   implying the opposite of something that is true on an 8-GPU chassis. */
function tpEfficiency(tp, gpu, gpusPerNode) {
  if (tp <= 1) return 1;
  const perNode = Math.max(1, gpusPerNode || 1);
  const domain = gpu.nvlink ? (gpu.nvlinkDomain || perNode) : perNode;
  const inside = gpu.nvlink ? SERVING.tpScalingLoss : SERVING.tpScalingLossPcie;
  const steps = Math.log2(tp);
  const local = Math.min(steps, Math.log2(Math.max(1, domain)));
  return Math.pow(1 - inside, local)
    * Math.pow(1 - SERVING.tpScalingLossFabric, Math.max(0, steps - local));
}

/* Smallest tensor-parallel width that fits weights + workspace + a minimum KV
   allowance, constrained to powers of two and to whole nodes' worth of GPUs. */
function minTensorParallel({ model, precision, gpu, gpusPerNode, minKvGB }) {
  const wB = weightBytes(model, precision);
  const cap = gpu.memGB * GiB;
  const maxTp = gpusPerNode * 64; // allow scaling well beyond a single node
  for (let tp = 1; tp <= maxTp; tp *= 2) {
    const perGpu = wB / tp + SERVING.workspaceGB * GiB + (minKvGB * GiB) / tp;
    if (perGpu <= cap) return tp;
  }
  return null;
}

/* Throughput of one model replica occupying `tp` GPUs at a given batch size. */
function replicaThroughput({ model, precision, gpu, tp, batch, ctxTokens, gpusPerNode }) {
  const eff = tpEfficiency(tp, gpu, gpusPerNode);
  const bw = gpu.bwGBs * 1e9 * tp * SERVING.bwEfficiency * eff;

  // Decode streams active weights (MoE reads only the routed experts) plus KV.
  const activeW = model.activeParams * precision.bytes * SERVING.weightOverhead;
  const kvSeq = kvBytesPerToken(model, precision) * ctxTokens;
  const stepBytes = activeW + batch * kvSeq;
  const stepTime = stepBytes / bw;

  const clusterTps = batch / stepTime;   // tokens/sec across the whole batch
  const perUserTps = 1 / stepTime;       // tokens/sec seen by one request
  return { clusterTps, perUserTps, tpotMs: stepTime * 1000 };
}

/* Prefill is compute bound: 2 FLOPs per active parameter per prompt token. */
function prefillTTFT({ model, precision, gpu, tp, promptTokens, gpusPerNode }) {
  const eff = tpEfficiency(tp, gpu, gpusPerNode);
  const peak = (gpu.denseTFLOPS[precision.flopKey] || gpu.denseTFLOPS.bf16) * 1e12;
  const flops = peak * tp * SERVING.flopEfficiency * eff;
  const work = 2 * model.activeParams * promptTokens;
  return (work / flops) * 1000; // ms
}

/* Largest batch a replica can serve without breaching the TPOT target. */
function batchForTpot({ model, precision, gpu, tp, ctxTokens, tpotTargetMs, gpusPerNode }) {
  let lo = 1, hi = 4096, best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { tpotMs } = replicaThroughput({ model, precision, gpu, tp, batch: mid, ctxTokens, gpusPerNode });
    if (tpotMs <= tpotTargetMs) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/* Concurrent sequences a replica can hold, limited by leftover KV memory. */
function batchForMemory({ model, precision, gpu, tp, ctxTokens }) {
  const free = gpu.memGB * GiB * tp
    - weightBytes(model, precision)
    - SERVING.workspaceGB * GiB * tp;
  if (free <= 0) return 0;
  const kvSeq = kvBytesPerToken(model, precision) * ctxTokens;
  return Math.floor((free * SERVING.kvUtilisation) / kvSeq);
}

/* What one purchasable unit of a node record is called: a chassis is a "node",
   a GB300 NVL72 is an "NVL72 rack". Messages and labels go through this so the
   rack-scale track never reads as "2 nodes" when it means two racks. */
function unitName(node, n) {
  const one = node.unit || 'node', many = node.unitPlural || `${one}s`;
  return n === 1 ? one : many;
}

/* ---------- top-level sizing ---------- */
function sizeInference(input) {
  const model = input.customModel || MODELS[input.modelKey];
  const precision = PRECISIONS[input.precisionKey];
  const node = GPU_NODES[input.nodeKey];
  const gpu = GPUS[node.gpuKey];
  const ctxTokens = input.promptTokens + input.outputTokens;

  const notes = [];
  if (ctxTokens > model.ctxMax) {
    notes.push({ level: 'critical', text: `Requested context of ${ctxTokens.toLocaleString()} tokens exceeds ${model.label}'s ${model.ctxMax.toLocaleString()}-token maximum.` });
  }

  // Tensor-parallel width: enough GPUs to hold the weights plus a working KV pool.
  const minKvGB = 8;
  const tp = input.tpOverride || minTensorParallel({
    model, precision, gpu, gpusPerNode: node.gpuCount, minKvGB,
  });
  if (!tp) {
    return { error: `${model.label} at ${precision.label} cannot be held even across 64 ${unitName(node, 64)} of ${gpu.short}.`, model, precision, node, gpu };
  }

  const memBatch = batchForMemory({ model, precision, gpu, tp, ctxTokens });
  const tpotBatch = batchForTpot({ model, precision, gpu, tp, ctxTokens, tpotTargetMs: input.tpotTargetMs, gpusPerNode: node.gpuCount });

  if (memBatch < 1) {
    return { error: `No KV memory left after weights: ${model.label} at ${precision.label} needs a wider tensor-parallel group or a smaller context.`, model, precision, node, gpu };
  }

  // The binding constraint is whichever allows fewer concurrent sequences.
  const batch = Math.max(1, Math.min(memBatch, tpotBatch || 1));
  const batchLimit = tpotBatch && tpotBatch < memBatch ? 'latency (TPOT)' : 'KV memory';

  const perf = replicaThroughput({ model, precision, gpu, tp, batch, ctxTokens, gpusPerNode: node.gpuCount });
  const ttftMs = prefillTTFT({ model, precision, gpu, tp, promptTokens: input.promptTokens, gpusPerNode: node.gpuCount });

  // Replicas needed to carry the requested concurrency, then rounded up to
  // whole nodes — GPUs are bought by the chassis, not individually.
  const replicas = Math.max(1, Math.ceil(input.concurrentRequests / batch));
  const gpusNeeded = replicas * tp;
  const autoNodes = Math.ceil(gpusNeeded / node.gpuCount);

  // Capacity-led sizing: the buyer fixes the fleet and asks what it delivers,
  // rather than stating a load and asking what it costs. Both directions matter
  // — one answers "what do I need", the other "what will this carry".
  const fixed = input.fixedNodes ? Math.max(1, Math.floor(input.fixedNodes)) : null;
  const nodes = fixed || autoNodes;
  const gpusDeployed = nodes * node.gpuCount;

  // What the delivered hardware actually carries, which is usually more than
  // the request: a node holds gpuCount GPUs and every spare group of `tp` runs
  // another replica. Reporting only the requested figure would understate the
  // build and hide the rounding waste.
  const deployedReplicas = Math.floor(gpusDeployed / tp);
  if (deployedReplicas < 1) {
    return {
      error: `${nodes} ${unitName(node, nodes)} give ${gpusDeployed} GPUs, but ${model.label} at ${precision.label} needs ${tp} GPUs for a single replica. Add ${unitName(node, 2)}, lower the precision, or pick a larger-memory accelerator.`,
      model, precision, node, gpu,
    };
  }
  const deployedConcurrency = deployedReplicas * batch;
  const clusterTps = deployedReplicas * perf.clusterTps;
  const requestedTps = replicas * perf.clusterTps;
  const reqPerHour = input.outputTokens > 0 ? (clusterTps * 3600) / input.outputTokens : 0;
  const gpuUtilPct = (gpusNeeded / gpusDeployed) * 100;

  const shortfall = fixed && deployedConcurrency < input.concurrentRequests;
  if (shortfall) {
    notes.push({
      level: 'warning',
      text: `${nodes} ${unitName(node, nodes)} ${nodes === 1 ? 'carries' : 'carry'} about ${deployedConcurrency.toLocaleString()} concurrent requests, short of the ${input.concurrentRequests.toLocaleString()} asked for. Meeting it needs ${autoNodes} ${unitName(node, autoNodes)}, or a looser TPOT target to raise batch size.`,
    });
  } else if (gpusNeeded < gpusDeployed) {
    notes.push({
      level: 'info',
      text: fixed
        ? `${nodes} ${unitName(node, nodes)} ${nodes === 1 ? 'carries' : 'carry'} about ${deployedConcurrency.toLocaleString()} concurrent requests — ${(deployedConcurrency / Math.max(1, input.concurrentRequests)).toFixed(1)}x the stated load. ${autoNodes} ${unitName(node, autoNodes)} would meet it exactly.`
        : `Rounding to whole ${unitName(node, 2)} deploys ${gpusDeployed} GPUs where ${gpusNeeded} would serve the stated load. The spare capacity runs ${deployedReplicas - replicas} further replica(s), taking headroom to about ${deployedConcurrency.toLocaleString()} concurrent requests.`,
    });
  }

  if (ttftMs > input.ttftTargetMs) {
    notes.push({ level: 'warning', text: `Modelled TTFT of ${Math.round(ttftMs)} ms exceeds the ${input.ttftTargetMs} ms target. Widen tensor parallelism or shorten the prompt.` });
  }
  if (tp > node.gpuCount) {
    notes.push({ level: 'warning', text: `Tensor parallelism of ${tp} spans ${tp / node.gpuCount} ${unitName(node, tp / node.gpuCount)}, so the model crosses the east-west fabric. Non-blocking 1:1 east-west is required, as specified in the reference architecture.` });
  }
  if (node.rackScale && gpu.nvlinkDomain) {
    // The rack-scale advantage is the NVLink domain itself: every GPU in the
    // rack is a tensor-parallel peer, where an HGX chassis stops at eight.
    const maxTp = Math.pow(2, Math.floor(Math.log2(gpu.nvlinkDomain)));
    notes.push({ level: 'info', text: `${node.sublabel}: all ${gpu.nvlinkDomain} GPUs in a rack share one NVLink domain (${gpu.nvlinkDomainTBs} TB/s aggregate, ${gpu.nvlinkGBs.toLocaleString()} GB/s per GPU), so tensor parallelism up to ${maxTp} stays on NVLink at the ${Math.round(SERVING.tpScalingLoss * 100)}% per-doubling cost${tp > 8 && tp <= gpu.nvlinkDomain ? ` — this TP-${tp} replica would have crossed the east-west fabric on an 8-GPU chassis` : tp === 1 ? ` — ${model.label} at ${precision.label} fits one GPU, so that headroom is unused here` : ''}. The east-west fabric carries only rack-to-rack traffic.` });
  }
  if (!gpu.nvlink && tp > 1) {
    notes.push({ level: 'warning', text: `${gpu.short} has no NVLink, so tensor parallelism pays a ${Math.round(SERVING.tpScalingLossPcie * 100)}% penalty per doubling over PCIe. Prefer one replica per GPU where the model fits.` });
  }
  if (model.moe) {
    notes.push({ level: 'info', text: `${model.label} is mixture-of-experts: all ${(model.params / 1e9).toFixed(0)}B parameters stay resident, but only ${(model.activeParams / 1e9).toFixed(1)}B activate per token, so throughput follows the active set.` });
  }
  if (batchLimit === 'latency (TPOT)' && tpotBatch < memBatch) {
    notes.push({ level: 'info', text: `Batch is capped at ${batch} by the ${input.tpotTargetMs} ms TPOT target; KV memory would allow ${memBatch}. Relaxing TPOT would raise throughput per GPU.` });
  }

  const perGpuMemGB = (weightBytes(model, precision) / tp + SERVING.workspaceGB * GiB
    + (batch * kvBytesPerToken(model, precision) * ctxTokens) / tp) / GiB;

  return {
    model, precision, node, gpu, ctxTokens, nodeKey: input.nodeKey,
    tp, batch, batchLimit, memBatch, tpotBatch, replicas, deployedReplicas,
    gpusNeeded, gpusDeployed, nodes, gpuUtilPct, deployedConcurrency,
    autoNodes, fixedNodes: fixed, shortfall,
    perUserTps: perf.perUserTps, tpotMs: perf.tpotMs, ttftMs,
    clusterTps, requestedTps, reqPerHour,
    perGpuMemGB, gpuMemGB: gpu.memGB,
    weightsGB: weightBytes(model, precision) / GiB,
    kvPerSeqGB: (kvBytesPerToken(model, precision) * ctxTokens) / GiB,
    notes,
  };
}

/* ---------- facility roll-up ----------
   Rack composition follows the reference architecture exactly: two GPU nodes
   per air-cooled rack, eight plus a 250 kW CDU per liquid-cooled rack, one
   fixed management rack, and a dedicated switch-fabric rack for regional and
   core profiles. */
/* ---------- GPU specification sheet ----------
   One place that turns a catalog record into the spec table both pages show,
   so the two never drift apart.

   FP16 and INT8 are derived rather than stored: FP16 runs at the BF16
   tensor-core rate and INT8 at the FP8 rate on every part in the catalog, so
   storing them again would only create two more numbers to keep in step.

   Every tensor figure is the dense rate. Doubling it gives NVIDIA's headline
   sparsity number, which needs a 2:1 pruned model to reach.

   `gpuCount` is optional; pass the deployed GPU count to get the fleet
   aggregates alongside the per-GPU figures. */
function gpuSpecSheet(gpu, gpuCount) {
  const d = gpu.denseTFLOPS || {};
  const NP = 'Not published';
  const rows = [
    ['Architecture', gpu.arch || '—', ''],
    ['Memory capacity', `${gpu.memGB} GB`, gpu.memType],
    ['Memory bandwidth', `${gpu.bwGBs.toLocaleString('en-US')} GB/s`, `${(gpu.bwGBs / 1000).toFixed(2)} TB/s`],
    ['FP32 (vector)', gpu.fp32TFLOPS ? `${gpu.fp32TFLOPS} TFLOPS` : NP, 'CUDA cores, not tensor cores'],
    ['FP16 / BF16 tensor', d.bf16 ? `${d.bf16.toLocaleString('en-US')} TFLOPS` : NP, 'Dense; same rate for both'],
    ['FP8 tensor', d.fp8 ? `${d.fp8.toLocaleString('en-US')} TFLOPS` : NP, 'Dense'],
    gpu.int8TOPS != null
      ? ['INT8 tensor', `${gpu.int8TOPS.toLocaleString('en-US')} TOPS`, 'Dense; published separately — Blackwell Ultra trades INT8 for NVFP4']
      : ['INT8 tensor', d.fp8 ? `${d.fp8.toLocaleString('en-US')} TOPS` : NP, 'Dense; runs at the FP8 rate'],
    ['FP4 tensor', d.fp4 ? `${d.fp4.toLocaleString('en-US')} TFLOPS` : 'Not supported', d.fp4 ? 'Dense' : 'Pre-Blackwell part'],
    ['Tensor cores', gpu.tensorCores ? gpu.tensorCores.toLocaleString('en-US') : NP, gpu.smCount ? `${gpu.smCount} SMs` : ''],
    ['CUDA cores', gpu.cudaCores ? gpu.cudaCores.toLocaleString('en-US') : NP, ''],
    ['Interconnect', gpu.interconnect || (gpu.nvlink ? 'NVLink' : 'PCIe'), gpu.nvlinkGBs ? `${gpu.nvlinkGBs.toLocaleString('en-US')} GB/s per GPU${gpu.nvlinkDomainTBs ? `; ${gpu.nvlinkDomainTBs} TB/s per ${gpu.nvlinkDomain}-GPU domain` : ''}` : ''],
    ['Board power', `${gpu.tdpW.toLocaleString('en-US')} W`, 'TDP'],
  ];

  // Aggregates are what a fleet actually offers, and they are the figures a
  // capacity plan is written against.
  const n = gpuCount || 0;
  const fleet = n ? {
    gpus: n,
    fp16PFLOPS: d.bf16 ? (d.bf16 * n) / 1000 : null,
    fp8PFLOPS: d.fp8 ? (d.fp8 * n) / 1000 : null,
    int8POPS: gpu.int8TOPS != null ? (gpu.int8TOPS * n) / 1000 : d.fp8 ? (d.fp8 * n) / 1000 : null,
    fp4PFLOPS: d.fp4 ? (d.fp4 * n) / 1000 : null,
    fp32TFLOPS: gpu.fp32TFLOPS ? gpu.fp32TFLOPS * n : null,
    memTB: (gpu.memGB * n) / 1000,
    bwTBs: (gpu.bwGBs * n) / 1000,
    tensorCores: gpu.tensorCores ? gpu.tensorCores * n : null,
    cudaCores: gpu.cudaCores ? gpu.cudaCores * n : null,
  } : null;

  return { rows, fleet, sparsityNote: 'Sparsity doubles every tensor figure above, and needs a 2:1 structured-pruned model to reach.' };
}

/* Out-of-band links, counted once for the whole tool.

   The switch count and the CAT6 line in the cabling BOM used to count these
   two different ways — the facility model doubled every device, the BOM used
   three per node and one per box — so a design could be quoted a leaf count
   its own cable schedule disagreed with. Both now call this.

   Per device: a GPU node contributes what its record says (the RA's own
   figure — three per DGX chassis per RA-11337-001 Figure 4.9, six per HGX or
   RTX PRO node, 71 per NVL72 rack); a WEKApod its two 1GbE management ports;
   a switch its one management port; a platform or control-plane server two,
   for the BMC and host management; a CDU cabinet one. */
function oobLinkCount({ node, gpuNodes, switches, mgmtOobPorts, storageNodes, storagePod, cduRacks }) {
  const perPod = storagePod && storagePod.mgmtPorts ? storagePod.mgmtPorts : 2;
  return {
    nodes: gpuNodes * (node.oobLinksPerNode || CABLE_RATIOS.oobLinksPerNode),
    storage: (storageNodes || 0) * perPod,
    switches,
    // The management rack's own links, counted per device rather than as two
    // per rack position: a patch panel and a media converter are passive and
    // present no management interface, so charging them an out-of-band pair
    // put the SN2201 count above what the rack actually terminates.
    platform: mgmtOobPorts,
    cooling: cduRacks || 0,
    get total() { return this.nodes + this.storage + this.switches + this.platform + this.cooling; },
  };
}

/* Management rack of a profile. The InferX designs share one fixed rack of
   platform routers, servers, Tier 3, firewalls and break-glass; the NVIDIA
   reference architectures have a control-plane rack of the RA's own management
   nodes instead. Both come back in one shape so the roll-ups and the layout
   need not know which stack they are on. */
function mgmtRackSpec(profile) {
  if (profile.stack !== 'nvidia') {
    // The CPU compute nodes are this stack's control plane and their number is
    // a sizing decision, so the rack's contents are built rather than fixed.
    // The RA elevation's two are what its published 7,826 W and 187.18 kg
    // stand for; each node beyond that adds its own configured draw and mass.
    const cpuNodes = roleCountOf('cpu-node');
    const contents = RACK.mgmtRack.contents.filter((k) => k !== 'cpu-node')
      .concat(Array(cpuNodes).fill('cpu-node'));
    const extra = cpuNodes - RACK.mgmtRack.cpuNodes;
    // The rack's own north-south ports: a BlueField-3 in every platform
    // server, platform router and CPU compute node, per the RA BOM.
    const nsPorts = contents.reduce((a, k) => a + ((INFRA[k] && INFRA[k].nsPorts) || 0), 0);
    const dW = contents.reduce((a, k) => a + (specWatts(k, INFRA[k].watts) - INFRA[k].watts), 0);
    const dKg = contents.reduce((a, k) => a + (specWeight(k, INFRA[k].weightKg) - INFRA[k].weightKg), 0);
    return {
      label: RACK.mgmtRack.label, contents,
      watts: RACK.mgmtRack.watts + dW + extra * INFRA['cpu-node'].watts,
      weightKg: Math.round((RACK.mgmtRack.weightKg + dKg + extra * INFRA['cpu-node'].weightKg) * 100) / 100,
      inferx: true, cpuNodes, cpuNodesRef: RACK.mgmtRack.cpuNodes,
      nsPorts, nsGb: 400,
      oobPorts: contents.reduce((a, k) => a + (INFRA[k].oobPorts != null ? INFRA[k].oobPorts : 2), 0),
    };
  }
  const cp = profile.controlPlane;
  const unit = INFRA['cp-node'];
  const cpW = specWatts('cp-node', unit.watts);
  const cpKg = specWeight('cp-node', unit.weightKg);
  // The RA states a recommended control-plane count; the design may run more
  // or fewer, down to a high-availability pair.
  const count = roleCountOf('cp-node');
  return {
    label: 'Control-plane rack', contents: Array(count).fill('cp-node'),
    watts: count * cpW, weightKg: count * cpKg,
    oobPorts: count * 2,
    cpCount: count, cpCountRef: cp.count,
    cpRu: cp.ru || unit.ru, cpDesc: cp.desc, cpNsPorts: cp.nsPorts || 2, cpNsGb: cp.nsGb || 200,
    // The adapter is the profile's, not a fixed one: the Enterprise RAs
    // specify a BlueField-3 B3220, the NVL72 RA four ConnectX-7 200G, and
    // RA-11337-001 a 400G in-band adapter that is not a BlueField at all.
    cpAdapter: cp.nsAdapter || unit.dpu, cpAdapterQty: cp.nsAdapterQty || 1, cpAdapterSrc: cp.nsAdapterSrc || null,
    cpModel: cp.model || unit.model,
    nsPorts: count * (cp.nsPorts || 2), nsGb: cp.nsGb || 200,
  };
}

/* ---------- NVIDIA reference-architecture fabrics ----------
   The NVIDIA profiles size their fabrics the way the RA documents do rather
   than from the oversubscription controls, and reproduce the switch counts
   those documents publish at every design point (RA_PROFILES[..].verified).
   All three rules run Spectrum-X Ethernet, non-blocking, with a 64-cage
   switch treated as 128 × 400G through twin-port transceivers.

   Out-of-band is counted the RA's way too — the RA's own 1 GbE links per
   node, single-homed, with SN2201 uplinks landing on the converged fabric
   rather than an OOB spine — but every device is counted: the RA's CAT6
   tables cover only the compute nodes, so the switches' management ports,
   the control plane and the storage nodes can add an SN2201 over the RA's
   figure at a fully populated design point. */
function nvidiaFabric({ profile, node, gpuNodes, computeRacks, cpCount, storageNodes, storagePod, stPorts, cduRacks }) {
  // Every endpoint that lands on the converged north-south fabric, counted the
  // same way the InferX branch counts it: the GPU nodes' DPU ports, the
  // control plane's, and the storage nodes'. This used to report the GPU nodes
  // alone, which left the control-plane BlueFields looking unaccounted for
  // against a rack drawing that cabled all of them.
  const nsNodePorts = gpuNodes * (node.nsPortsPerNode || 2);
  const nsCpPorts = cpCount * ((profile.controlPlane && profile.controlPlane.nsPorts) || 2);
  const rules = profile.fabric;
  const sw = FABRIC.sn5610;                 // SN5600 and SN5610 are interchangeable in the RAs
  const LOGICAL = sw.ports * 2;             // 128 × 400G per switch
  const HALF = LOGICAL / 2;
  const evenUp = (n) => n + (n % 2);
  const consolidated = rules.consolidatedUpTo > 0 && gpuNodes <= rules.consolidatedUpTo;

  // --- east-west: links, not ports. A ConnectX-8 800G port is two 400G
  // links on the dual-plane fabric; a B3140H 400G port is one. ---
  const linksPerPort = node.ewLinksPerPort || (node.ewPortGb >= 800 ? 2 : 1);
  const ewLinks = gpuNodes * node.ewPortsPerNode * linksPerPort;
  let ewLeaves, ewSpines, ewDown = HALF, ewUp = HALF;
  const leafSpine = (links) => {
    const leaves = Math.max(2, Math.ceil(links / HALF));
    const spines = leaves <= 2 ? 0 : Math.max(2, Math.ceil((leaves * HALF) / LOGICAL));
    return [leaves, spines];
  };
  if (rules.rule === 'nvl72') {
    // Four leaves per plane per pair of racks, one per GPU position in every
    // tray; each leaf carries 36 downlinks and 36 uplinks of its 128 ports.
    const perPlane = 4 * Math.ceil(computeRacks / 2);
    const spinesPerPlane = evenUp(Math.ceil((perPlane * 36) / LOGICAL));
    ewLeaves = 2 * perPlane; ewSpines = 2 * spinesPerPlane; ewDown = 36; ewUp = 36;
  } else if (rules.rule === 'superpod') {
    // The RA builds the compute fabric for the whole scalable unit even when
    // fewer nodes are installed, and leaves the rest of it unused.
    const designNodes = Math.ceil(gpuNodes / profile.suNodes) * profile.suNodes;
    [ewLeaves, ewSpines] = leafSpine(designNodes * node.ewPortsPerNode * linksPerPort);
  } else {
    [ewLeaves, ewSpines] = leafSpine(ewLinks);
  }

  // --- north-south and out-of-band, iterated because the SN2201 uplinks
  // take converged ports and the converged switches take SN2201 ports. ---
  const nodeNs = gpuNodes * (node.nsPortsPerNode || 2) * ((node.nsPortGb || 400) / 400);
  const alloc = rules.converged(gpuNodes, computeRacks);
  const oobRackLeaves = rules.oobInRack ? computeRacks * rules.oobInRack : 0;
  const nodeOob = gpuNodes * (node.oobLinksPerNode || CABLE_RATIOS.oobLinksPerNode);
  let oobLeaves = 2, nsLeaves = 0, nsSpines = 0, nsDown = HALF, nsUp = HALF, nsCollapsed = false;
  let budget = null, nsLogical = 0, superpod = null, oob = null;
  for (let pass = 0; pass < 6; pass++) {
    if (rules.rule === 'superpod') {
      // Storage fabric: DGX-side leaves at 64 down / 48 up (the RA's "near
      // 4:3"), storage-side leaves at 1:1, one spine tier over both; plus the
      // in-band fabric, 128 ports per leaf and a spine pair beyond two leaves.
      const dgxStorage = gpuNodes * 2;
      const dgxLeaves = Math.max(1, Math.ceil(dgxStorage / HALF));
      const stLeaves = Math.max(1, Math.ceil(Math.max(1, stPorts) / HALF));
      const stgSpines = Math.max(2, evenUp(Math.ceil((dgxLeaves * 48 + stLeaves * HALF) / LOGICAL)));
      const ibPorts = gpuNodes * 2 + cpCount * 2;
      const ibLeaves = Math.max(2, Math.ceil(ibPorts / LOGICAL));
      const ibSpines = ibLeaves > 2 ? 2 : 0;
      superpod = { dgxLeaves, stLeaves, stgSpines, ibLeaves, ibSpines, dgxStorage, ibPorts };
      nsLeaves = dgxLeaves + stLeaves + ibLeaves; nsSpines = stgSpines + ibSpines;
      nsDown = HALF; nsUp = 48; nsLogical = dgxStorage + stPorts + ibPorts;
    } else {
      // The RA's converged allocations, in 800G cages, converted to 400G
      // logical ports: the nodes' DPU pair, storage (the RA's reservation or
      // the WEKApod ports, whichever is larger), customer uplinks, support
      // servers and the SN2201 uplinks.
      const mgmtCages = Math.max(4, Math.ceil((oobLeaves + oobRackLeaves) / 2));
      budget = {
        node: nodeNs,
        storage: Math.max(alloc.storage * 2, stPorts),
        customer: alloc.customer * 2,
        support: alloc.support * 2,
        mgmt: mgmtCages * 2,
      };
      nsLogical = Object.values(budget).reduce((a, b) => a + b, 0);
      if (consolidated) {
        // Small design points fold the converged network into the compute
        // leaves (RA Table 7 note): one fabric, no north-south switches. It is
        // a collapsed pair with an inter-switch link rather than a Clos, so
        // the ports face servers instead of splitting half upward — which is
        // how the RA gets two switches out of a 16-node RTX PRO design.
        nsLeaves = 0; nsSpines = 0; nsCollapsed = false;
        const all = ewLinks + nsLogical;
        if (all <= 2 * (LOGICAL - 32)) { ewLeaves = 2; ewSpines = 0; ewDown = Math.ceil(all / 2); ewUp = 0; }
        else [ewLeaves, ewSpines] = leafSpine(all);
      } else if (nsLogical <= 2 * (LOGICAL - 32)) {
        // A leaf pair with a 32-port inter-switch link, as the RAs draw the
        // converged network up to 64 HGX nodes or two NVL72 racks.
        nsLeaves = 2; nsSpines = 0; nsCollapsed = true; nsDown = Math.ceil(nsLogical / 2); nsUp = 0;
      } else {
        nsLeaves = Math.ceil(nsLogical / HALF);
        nsSpines = evenUp(Math.ceil((nsLeaves * HALF) / LOGICAL));
        nsCollapsed = false; nsDown = HALF; nsUp = HALF;
      }
    }
    const switches = ewLeaves + ewSpines + nsLeaves + nsSpines + oobLeaves + oobRackLeaves;
    oob = oobLinkCount({ node, gpuNodes, switches, mgmtOobPorts: cpCount * 2, storageNodes, storagePod, cduRacks });
    // A rack that carries its own OOB pair terminates its nodes there, so only
    // what sits outside the compute racks needs a fabric-rack leaf port.
    const outside = oob.total - (oobRackLeaves ? oob.nodes : 0);
    const next = Math.max(2, Math.ceil(outside / FABRIC_RULES.oobLeafPorts));
    if (next === oobLeaves) break;
    oobLeaves = next;
  }
  const oobPorts = oob.total;

  return {
    ewLeaves, ewSpines, nsLeaves, nsSpines, oobLeaves, oobSpines: 0, oobRackLeaves,
    ewPorts: ewLinks, ewNodePorts: gpuNodes * node.ewPortsPerNode, oobPorts,
    nsPorts: nsNodePorts + nsCpPorts + stPorts,
    nsNodePorts, nsMgmtPorts: nsCpPorts, nsTier2Ports: 0, nsStoragePorts: stPorts,
    nsPortsPerNode: node.nsPortsPerNode || 2, nsPortGb: node.nsPortGb || 400,
    oobLinks: oob,
    ewOversub: 1, nsOversub: 1, ewSwitch: sw, nsSwitch: sw, ewTech: 'ethernet', nsTech: 'ethernet',
    ewDown, ewUp, nsDown, nsUp, ewLeafPorts: LOGICAL, nsLeafPorts: LOGICAL, breakout: 2,
    rule: rules.rule, consolidated, nsCollapsed, nsLogical, budget, superpod, linksPerPort,
    oobUplinks: rules.oobUplinks, oobHomed: 'single',
    switchU: (ewLeaves + ewSpines + nsLeaves + nsSpines) * sw.ru + oobLeaves * FABRIC.sn2201.ru,
  };
}

function sizeFacility({ gpuNodes, nodeKey, coolingKey, profileKey, storageNodes, storagePodKey }) {
  const node = GPU_NODES[nodeKey];
  const profile = RA_PROFILES[profileKey];
  // Parts of the server model are the reference architecture's rather than
  // fixed — the control-plane node's adapter, its guideline, its recommended
  // count — so the model is told which one is being sized before anything
  // reads it. Doing it here makes every caller correct without each of them
  // having to remember.
  setServerContext(profileKey);
  const nvidia = profile.stack === 'nvidia';
  const rackScale = !!node.rackScale;

  // Cooling comes from the profile's own set: air/DLC for the InferX chassis
  // designs, four-per-rack air or DLC for the NVIDIA chassis RAs, the three
  // DLC arrangements for a rack-scale system. A key from the wrong set (the
  // compute page's air/liquid select, say) falls back to the profile default.
  const coolingSet = profile.coolingSet || 'inferx';
  let cooling = RACK.cooling[coolingKey];
  const fits = (c) => c && (c.sets || ['inferx']).includes(coolingSet) && !!c.rackScale === rackScale
    && !(c.cdu && !c.rackScale && !node.liquidCapable);
  if (!fits(cooling)) {
    coolingKey = rackScale ? (node.defaultCooling || 'inrow') : (profile.defaultCooling || 'air');
    cooling = RACK.cooling[coolingKey];
  }
  const cduSpec = cooling.cdu ? INFRA[cooling.cduKey || 'cdu'] : null;

  const perRack = cooling.gpuNodesPerRack;
  const computeRacks = Math.ceil(gpuNodes / perRack);
  const mgmt = mgmtRackSpec(profile);
  const pod = storagePodKey && WEKAPODS[storagePodKey] ? WEKAPODS[storagePodKey] : null;
  const stPorts = (storageNodes || 0) * (pod ? pod.ports : 2);

  // CDU count. A chassis rack carries its own 4U CDU; a rack-scale system
  // takes a 4U unit in its spare units (in-rack), a floor-standing cabinet per
  // eight racks (in-row) or a sidecar cabinet beside every rack. Cabinets take
  // a rack position on the floor, so they are counted and drawn as racks.
  const cduUnits = !cooling.cdu ? 0
    : cooling.inRack || !rackScale ? computeRacks
      : Math.ceil(computeRacks / (cduSpec.racksPerUnit || 1));
  const cduRacks = cooling.cdu && rackScale && !cooling.inRack ? cduUnits : 0;

  // Tier 2 block storage is InferX's: a fixed three units at the base of the
  // first three compute racks. The NVIDIA reference architectures have none.
  // Counted here because its BlueField-3 is a north-south endpoint the fabric
  // has to carry.
  const tier2InCompute = !nvidia && !rackScale;
  const tier2Count = nvidia ? 0 : tier2InCompute ? Math.min(RACK.tier2Units, computeRacks) : RACK.tier2Units;

  let fabric;
  if (nvidia) {
    fabric = nvidiaFabric({ profile, node, gpuNodes, computeRacks, cpCount: mgmt.cpCount, storageNodes, storagePod: pod, stPorts, cduRacks });
  } else {
    // Fabric. A leaf splits its ports between servers below and spines above; the
    // split is what sets oversubscription — at 1:1 half the ports face up, at 4:1
    // only a fifth do. Each plane runs on whichever transport was chosen, and the
    // two transports have different radix, so the port budget is per plane.
    const ewSw = FABRIC[FABRIC_TRANSPORTS[FABRIC_RULES.eastWestTech].switchKey];
    const nsSw = FABRIC[FABRIC_TRANSPORTS[FABRIC_RULES.northSouthTech].switchKey];
    const ewLeafPorts = ewSw.ports * FABRIC_RULES.breakout;
    const nsLeafPorts = nsSw.ports * FABRIC_RULES.breakout;
    const ewDown = Math.floor(ewLeafPorts / (1 + 1 / FABRIC_RULES.eastWestOversub));
    const ewUp = ewLeafPorts - ewDown;
    const ewPorts = gpuNodes * node.ewPortsPerNode;
    const ewLeaves = Math.max(2, Math.ceil(ewPorts / ewDown));
    // A leaf pair interconnects directly; spines only earn their place once the
    // fabric outgrows two leaves. Without this a single-node edge site would be
    // sized for a full two-tier Clos.
    const ewSpines = ewLeaves <= 2 ? 0 : Math.max(2, Math.ceil((ewLeaves * ewUp) / ewLeafPorts));

    const nsDown = Math.floor(nsLeafPorts / (1 + 1 / FABRIC_RULES.northSouthOversub));
    const nsUp = nsLeafPorts - nsDown;
    // Dual-attached BlueField-3 north-south: one DPU per chassis. The
    // management stack and the Tier 2 chassis land on the same fabric — the
    // RA BOM gives every platform server, platform router and CPU node a
    // B3240 and each Tier 2 a B3140H — as do the WEKApod data ports.
    const nsPortsPerNode = node.nsPortsPerNode || 2;
    const nodeNsPorts = gpuNodes * nsPortsPerNode;
    const mgmtNsPorts = mgmt.nsPorts || 0;
    const tier2NsPorts = tier2Count * (INFRA.tier2.nsPorts || 0);
    const nsPorts = nodeNsPorts + mgmtNsPorts + tier2NsPorts + stPorts;
    const nsLeaves = Math.max(2, Math.ceil(nsPorts / nsDown));
    const nsSpines = nsLeaves <= 2 ? 0 : Math.max(2, Math.ceil((nsLeaves * nsUp) / nsLeafPorts));

    // Out-of-band carries BMC plus host management for every node, switch and
    // platform box — not just the GPU nodes — counted by the same function the
    // cabling BOM uses, so the leaf count and the cable schedule agree.
    const oobRackLeaves = 0;
    let oobLeaves = 2, oob = null;
    for (let pass = 0; pass < 6; pass++) {
      const switches = ewLeaves + ewSpines + nsLeaves + nsSpines + oobLeaves;
      oob = oobLinkCount({ node, gpuNodes, switches, mgmtOobPorts: mgmt.oobPorts, storageNodes, storagePod: pod, cduRacks });
      const next = Math.max(2, Math.ceil(oob.total / FABRIC_RULES.oobLeafPorts));
      if (next === oobLeaves) break;
      oobLeaves = next;
    }
    const oobPorts = oob.total;
    // Every OOB leaf pair uplinks with 2 × 100G; the SN4600C spine has 64 ports.
    const oobUplinks = oobLeaves * 2;
    const oobSpines = oobLeaves > 2 ? Math.max(2, Math.ceil(oobUplinks / FABRIC.sn4600c.ports)) : 0;

    // The elevations stack switches contiguously — a 2U switch listed at U40 is
    // followed by the next at U38 — so there is no service gap to allow for.
    const switchU = (ewLeaves + ewSpines) * ewSw.ru + (nsLeaves + nsSpines) * nsSw.ru
      + oobLeaves * FABRIC.sn2201.ru + oobSpines * FABRIC.sn4600c.ru;
    fabric = { ewLeaves, ewSpines, nsLeaves, nsSpines, oobLeaves, oobSpines, oobRackLeaves, switchU, ewPorts, ewNodePorts: ewPorts, nsPorts, oobPorts, oobLinks: oob,
      nsPortsPerNode, nsPortGb: 400,
      nsNodePorts: nodeNsPorts, nsMgmtPorts: mgmtNsPorts, nsTier2Ports: tier2NsPorts, nsStoragePorts: stPorts,
      ewOversub: FABRIC_RULES.eastWestOversub, nsOversub: FABRIC_RULES.northSouthOversub,
      ewSwitch: ewSw, nsSwitch: nsSw,
      ewTech: FABRIC_RULES.eastWestTech, nsTech: FABRIC_RULES.northSouthTech,
      // Per-leaf port split, so the topology drawing labels uplinks and
      // downlinks with the same numbers the switch count came from.
      ewDown, ewUp, nsDown, nsUp, ewLeafPorts, nsLeafPorts, breakout: FABRIC_RULES.breakout,
      rule: 'inferx', consolidated: false, nsCollapsed: false, oobHomed: 'dual', linksPerPort: 1 };
  }
  const { ewLeaves, ewSpines, nsLeaves, nsSpines, oobLeaves, oobSpines, oobRackLeaves, switchU } = fabric;
  const ewSw = fabric.ewSwitch, nsSw = fabric.nsSwitch;

  // The regional reference design has a dedicated fabric rack for only eight
  // nodes, so this follows the profile rather than a switch-count threshold.
  /* The edge design has no fabric rack: its data-plane leaves stack in the
     management rack's spare units. That holds only while the fabric is a leaf
     pair or two — once it grows a spine tier, or more out-of-band leaves than
     the rack's pair, or more units than the rack has left, it needs a rack of
     its own like every other tier.

     The space left is measured the way the elevation stacks it, because the
     CPU compute nodes are adjustable and Tier 2 may be in this rack too: the
     leaves come down from just under the out-of-band pair and must stop above
     whatever is standing at the bottom. */
  const leafGap = tier2InCompute ? 1 : 0;
  const leafStartU = RACK.mgmtRack.cpuNodeCeilingU - (leafGap ? 2 : 0);
  const leafDrawnU = Math.max(0, nsLeaves * (nsSw.ru + leafGap) + ewLeaves * (ewSw.ru + leafGap) - leafGap);
  const bottomStackU = mgmt.cpuNodes != null ? mgmt.cpuNodes : RACK.mgmtRack.cpuNodes;
  const tier2StackU = tier2InCompute ? 0 : tier2Count * INFRA.tier2.ru;
  const fitsMgmtRack = !profile.dedicatedFabricRack
    && ewSpines + nsSpines + oobSpines === 0
    && oobLeaves <= RACK.mgmtOobLeaves
    && leafStartU - leafDrawnU >= bottomStackU + tier2StackU;
  // The out-of-band leaves the management rack already holds do not need
  // space in a fabric rack, so they come off the height it is sized from —
  // the same pair the drawing takes out. `switchU` stays the honest total.
  const mgmtOobHeld = nvidia ? 0 : Math.min(RACK.mgmtOobLeaves, oobLeaves);
  const fabricU = switchU - mgmtOobHeld * FABRIC.sn2201.ru;
  const fabricRacks = fitsMgmtRack ? 0
    : Math.max(1, Math.ceil(fabricU / (RACK.totalU - RACK.fabricReserveU)));

  // WEKApod Nitro is a 1U server; Prime 2218 is 2U. The caller passes the model
  // so the storage rack is drawn and sized at the right height.
  const podRu = pod ? pod.ru : 1;
  const wekaU = (storageNodes || 0) * podRu;
  // A rack per storage cluster wherever one is sized. This used to be gated on
  // the profile designating a WEKApod as its storage tier, which meant the
  // edge tier — whose own tier is Tier 2 block — counted the pods in power,
  // weight, fabric ports and the BOM but placed none of them in a rack, so the
  // elevation was short eight nodes and 32 north-south ports.
  const storageRacks = storageNodes ? Math.max(1, Math.ceil(wekaU / (RACK.totalU - RACK.storageReserveU))) : 0;

  const mgmtRacks = 1;
  const totalRacks = computeRacks + fabricRacks + storageRacks + mgmtRacks + cduRacks;

  // Power.
  const nodeW = specWatts(nodeKey, node.watts);
  const nodeKg = specWeight(nodeKey, node.weightKg);
  const tier2W1 = specWatts('tier2', INFRA.tier2.watts);
  const gpuNodeW = gpuNodes * nodeW;
  const cduW = cduUnits * (cduSpec ? cduSpec.watts : 0);
  const tier2W = tier2Count * tier2W1;
  // A rack-scale system's published operating power already includes the OOB
  // pair NVIDIA puts inside the rack, so counting those switches again here
  // would double-charge them. A DGX rack's in-rack SN2201 is a separate box
  // and does count.
  const oobSwitchesCharged = oobLeaves + (rackScale ? 0 : oobRackLeaves);
  const switchW = (ewLeaves + ewSpines) * ewSw.watts + (nsLeaves + nsSpines) * nsSw.watts
    + oobSwitchesCharged * FABRIC.sn2201.watts + oobSpines * FABRIC.sn4600c.watts;
  const podW = pod ? pod.watts : INFRA.wekapod.watts;
  const storageW = (storageNodes || 0) * podW;
  const mgmtW = mgmt.watts;
  const totalW = gpuNodeW + cduW + tier2W + switchW + storageW + mgmtW;

  // Weight.
  const gpuNodeKg = gpuNodes * nodeKg;
  const podKg = pod ? pod.weightKg : INFRA.wekapod.weightKg;
  const storageKg = (storageNodes || 0) * podKg;
  const switchKg = (ewLeaves + ewSpines) * ewSw.weightKg + (nsLeaves + nsSpines) * nsSw.weightKg
    + oobSwitchesCharged * FABRIC.sn2201.weightKg + oobSpines * FABRIC.sn4600c.weightKg;
  const cduKg = cduUnits * (cduSpec ? cduSpec.weightKg : 0);
  const totalKg = gpuNodeKg + storageKg + switchKg + mgmt.weightKg + cduKg
    + tier2Count * specWeight('tier2', INFRA.tier2.weightKg);

  // Two rack figures, because only the first few racks carry Tier 2. On the
  // rack-scale track the compute rack is the system plus, for the in-rack
  // option, its CDU; Tier 2 then lands on the management rack instead.
  const nodeRu = cooling.cdu && node.ruLiquid ? node.ruLiquid : node.ru;
  const inRackCduW = cooling.cdu && (cooling.inRack || !rackScale) ? cduSpec.watts : 0;
  const rackPlainW = perRack * nodeW + inRackCduW + (oobRackLeaves && !rackScale ? FABRIC.sn2201.watts * (profile.fabric.oobInRack || 0) : 0);
  const rackWithTier2W = tier2InCompute ? rackPlainW + tier2W1 : rackPlainW;
  const perComputeRackW = tier2InCompute && tier2Count > 0 ? rackWithTier2W : rackPlainW;
  const mgmtRackW = mgmtW + (tier2InCompute ? 0 : tier2W);

  const rackU = rackScale
    ? (node.rack.computeTrays * node.rack.trayRu + node.rack.switchTrays * node.rack.switchTrayRu
      + node.rack.powerShelves * node.rack.shelfRu + (node.rack.oobSwitches || 0) * FABRIC.sn2201.ru
      + (cooling.inRack ? INFRA.cdu.ru : 0))
    : perRack * nodeRu + (cooling.cdu ? INFRA.cdu.ru : 0) + (tier2InCompute ? INFRA.tier2.ru : 0)
      + (nvidia && profile.fabric.oobInRack ? profile.fabric.oobInRack * FABRIC.sn2201.ru : 0);

  // Design checks the reference architecture itself imposes: scalable-unit
  // multiples, the tested range, and the storage bandwidth it allocates.
  const notes = [];
  if (nvidia) {
    const unitName = profile.unit === 'rack' ? 'rack' : 'node';
    const units = gpuNodes;
    const su = profile.suNodes;
    if (units < profile.minGpuNodes) {
      notes.push({ level: 'warning', text: `${profile.ra.name} starts at ${profile.minGpuNodes} ${unitName}${profile.minGpuNodes > 1 ? 's' : ''} (one scalable unit); ${units} ${unitName}${units > 1 ? 's' : ''} sits below its tested range${fabric.rule === 'superpod' ? ' — the compute fabric is sized for the full scalable unit regardless, as the RA requires' : ''}.` });
    } else if (units > profile.maxGpuNodes) {
      notes.push({ level: 'warning', text: `${profile.ra.name} is tested to ${profile.maxGpuNodes} ${unitName}s (${profile.maxGpuNodes / su} scalable units); ${units} ${unitName}s is beyond that range. NVIDIA allows larger clusters on request${fabric.rule !== 'nvl72' ? ', typically with a super-spine tier the model does not add' : ''}.` });
    }
    if (su > 1 && units % su !== 0) {
      notes.push({ level: 'info', text: `${profile.ra.name} grows in ${su}-node scalable units; ${units} nodes is ${Math.ceil(units / su)} units with ${Math.ceil(units / su) * su - units} node${Math.ceil(units / su) * su - units > 1 ? 's' : ''} of the last one unfilled.` });
    }
    if (fabric.consolidated) {
      notes.push({ level: 'info', text: `At ${units} nodes the RA folds the converged north-south network into the compute leaves (one Spectrum-X fabric, VLAN-separated); dedicated north-south switches appear above ${profile.fabric.consolidatedUpTo} nodes.` });
    }
  }

  return {
    node, cooling, profile, rackScale, coolingKey, nvidia, gpuNodes,
    computeRacks, fabricRacks, storageRacks, mgmtRacks, cduRacks, totalRacks,
    cdu: cooling.cdu ? { spec: cduSpec, units: cduUnits, inRack: !!cooling.inRack || !rackScale, racks: cduRacks } : null,
    storage: { nodes: storageNodes || 0, u: wekaU, podRu, podKey: storagePodKey || null, ports: stPorts },
    mgmt,
    fabric,
    power: { gpuNodeW, cduW, tier2W, switchW, storageW, mgmtW, totalW,
      perComputeRackW, rackPlainW, rackWithTier2W, mgmtRackW },
    tier2Count, tier2InCompute, nodeRu, oobSwitchesCharged,
    weight: { totalKg },
    rackU, rackUsedPct: (rackU / RACK.totalU) * 100,
    coolingLoadBTU: totalW * 3.412,
    notes,
  };
}

/* ---------- WEKApod storage sizing ----------
   Capacity uses the same published net-capacity formula as the storage page.
   At WEKA's own 5D+2P+1VHS setting it reproduces both of their worked examples
   exactly: 8 x WPS155-SAE = 484 TB, 8 x WPS175-SAE = 968 TB. */
function sizeWekapod({ podKey, nodes, schemeId, hotSpares }) {
  const pod = WEKAPODS[podKey];
  const scheme = PROTECTION_SCHEMES.find((x) => x.id === (schemeId || WEKAPOD_DEFAULTS.schemeId));
  const spares = hotSpares == null ? WEKAPOD_DEFAULTS.hotSpares : hotSpares;
  const n = Math.max(pod.minNodes, Math.round(nodes) || pod.minNodes);

  const rawTB = n * pod.drives * pod.driveTB;
  const netTB = rawTB * ((n - spares) / n) * scheme.efficiency * WEKA.fsOverhead;

  const notes = [];
  if (scheme.stripe > n) {
    notes.push({ level: 'critical', text: `A ${scheme.id} stripe needs ${scheme.stripe} failure domains but there are only ${n} WEKApod nodes.` });
  }
  if (n < pod.minNodes) {
    notes.push({ level: 'warning', text: `WEKApod starts at ${pod.minNodes} nodes.` });
  }

  // Where the raw capacity goes, in the order the formula applies it.
  const afterSpare = rawTB * ((n - spares) / n);
  const afterParity = afterSpare * scheme.efficiency;
  const waterfall = [
    { step: 'Raw installed', tb: rawTB, applied: `${n} nodes × ${pod.drives} × ${pod.driveTB} TB` },
    { step: 'After hot-spare reserve', tb: afterSpare, applied: `× (${n} − ${spares}) / ${n}` },
    { step: 'After parity', tb: afterParity, applied: `× ${scheme.d}/${scheme.stripe}  (${scheme.id})` },
    { step: 'Net usable', tb: netTB, applied: `× ${WEKA.fsOverhead} filesystem overhead`, final: true },
  ];
  const split = {
    net: netTB,
    parity: afterSpare - afterParity,
    spare: rawTB - afterSpare,
    reserve: afterParity - netTB,
  };

  // Per-node budgets, using the same published formulas as the storage page.
  const mem = memoryPerServer({
    drivesPerNode: pod.drives, driveTB: pod.driveTB, frontendProcs: 2,
    protocols: true, rdma: true, installedRamGB: pod.ramGB,
  });
  const ceiling = nodeThroughput({
    drivesPerNode: pod.drives, drive: { tb: pod.driveTB, gbps: pod.driveGBs || 12 },
    nic: { gb: pod.portGb, ports: 1 }, nicCount: pod.ports,
    cores: pod.cores || 64, frontendProcs: 2, scheme,
  });

  // What the other protection schemes would give at this node count.
  const alternatives = PROTECTION_SCHEMES
    .filter((x) => x.stripe <= n)
    .map((x) => ({
      scheme: x,
      netTB: rawTB * ((n - spares) / n) * x.efficiency * WEKA.fsOverhead,
      current: x.id === scheme.id,
    }));

  return {
    pod, scheme, spares, nodes: n,
    rawTB, netTB, waterfall, split, mem, ceiling, alternatives,
    readGBs: n * pod.readGBs, writeGBs: n * pod.writeGBs,
    readIops: n * pod.readIops, writeIops: n * pod.writeIops,
    ru: n * pod.ru, watts: n * pod.watts, weightKg: n * pod.weightKg,
    ports: n * pod.ports, mgmtPorts: n * 2,
    drives: n * pod.drives,
    licenseTier: licenseTier(netTB),
    notes,
  };
}

/* Nodes needed to hit a usable-capacity or read-throughput target. */
function wekapodNodesFor({ podKey, targetTB, targetReadGBs, schemeId, hotSpares }) {
  const pod = WEKAPODS[podKey];
  let n = pod.minNodes;
  for (; n <= 4096; n++) {
    const r = sizeWekapod({ podKey, nodes: n, schemeId, hotSpares });
    if ((!targetTB || r.netTB >= targetTB) && (!targetReadGBs || r.readGBs >= targetReadGBs)) return n;
  }
  return n;
}

/* ---------- hardware bill of materials ----------
   Every purchasable line in the design, as data rather than as table markup,
   so the results card and the spreadsheet export cannot drift apart.

   `counts` marks whether a line adds to the totals. It is false for the two
   kinds of line that are already inside another: the GPU line (its watts are
   in the node's) and, on a rack-scale system, the trays, switch trays, power
   shelves and OOB pair that make up the rack. Summing the lines where
   `counts` is true reproduces the facility card's total IT load and weight
   exactly, which the verification script asserts. */
function hardwareBOM({ r, fac, weka }) {
  const node = r.node;
  const rk = node.rack;
  const fb = fac.fabric;
  const line = (item, model, qty, unitW, unitKg, spec, extra) =>
    Object.assign({ item, model: model || '', qty, unitW, unitKg, spec: spec || '', counts: true, indent: false }, extra || {});
  const inside = { counts: false, indent: true };

  // Servers take their configured build, not the record's reference one, so a
  // change on the platform step flows into the BOM's power and weight.
  const nodeSpec = serverSpec(r.nodeKey) || null;
  const t2Spec = serverSpec('tier2');
  const cpSpec = serverSpec('cp-node');
  const specLine = (sp) => sp && !sp.fixed && sp.changed
    ? ` · ${sp.cpuLabel} · ${sp.ramGB.toLocaleString('en-US')} GB · ${sp.bootLabel} boot · ${sp.dataLabel}` : '';

  const rows = [
    line(node.label, node.sublabel, r.nodes, specWatts(r.nodeKey, node.watts), specWeight(r.nodeKey, node.weightKg),
      `${r.gpusDeployed} × ${r.gpu.short}${node.system ? ` · representative system: ${node.system}` : ''}${specLine(nodeSpec)}`),
    // A rack-scale system is bought as a rack; these are what is inside it.
    rk ? line('Compute tray', rk.trayModel, r.nodes * rk.computeTrays, null, rk.trayKg,
      `${rk.gpusPerTray} × ${r.gpu.short} + ${rk.cpusPerTray} × Grace · ${rk.trayRu}U · ${rk.trayHbmGB} GB HBM3e · ${rk.trayLpddrGB} GB LPDDR5X`, inside) : null,
    rk ? line('NVLink switch tray', `${rk.nvswitchPerTray} × NVSwitch 5`, r.nodes * rk.switchTrays, null, rk.switchTrayKg,
      `${rk.switchTrayRu}U · 144 ports`, inside) : null,
    rk ? line(`Power shelf ${rk.shelfKw} kW`, `${rk.psusPerShelf} × ${rk.psuKw} kW PSU`, r.nodes * rk.powerShelves, null, null,
      `${Math.ceil(rk.powerShelves / 2)}+${Math.floor(rk.powerShelves / 2)} · ${rk.usableKw} kW usable per rack`, inside) : null,
    rk && rk.oobSwitches ? line(`${FABRIC.sn2201.label} — in-rack OOB`, FABRIC.sn2201.desc, r.nodes * rk.oobSwitches,
      FABRIC.sn2201.watts, FABRIC.sn2201.weightKg, 'inside the rack\'s published power', inside) : null,
    line(r.gpu.label, r.gpu.arch, r.gpusDeployed, r.gpu.tdpW, null,
      `${r.gpu.memGB} GB ${r.gpu.memType} · ${r.gpu.bwGBs.toLocaleString('en-US')} GB/s`,
      { counts: false, indent: true }),

    weka && weka.nodes ? line(weka.pod.label, weka.pod.model, weka.nodes, weka.pod.watts, weka.pod.weightKg,
      `${weka.pod.drives} × ${weka.pod.driveTB} TB ${weka.pod.driveType} · ${weka.pod.ru}U · ${weka.pod.net}`) : null,

    line(`${fb.ewSwitch.label} — ${fb.consolidated ? 'converged' : 'east-west'}`, fb.ewSwitch.desc,
      fb.ewLeaves + fb.ewSpines, fb.ewSwitch.watts, fb.ewSwitch.weightKg,
      `${fb.ewLeaves} leaf + ${fb.ewSpines} spine · ${FABRIC_TRANSPORTS[fb.ewTech].label}`),
    fb.nsLeaves + fb.nsSpines ? line(`${fb.nsSwitch.label} — north-south`, fb.nsSwitch.desc,
      fb.nsLeaves + fb.nsSpines, fb.nsSwitch.watts, fb.nsSwitch.weightKg,
      `${fb.nsLeaves} leaf + ${fb.nsSpines} spine · ${FABRIC_TRANSPORTS[fb.nsTech].label}`) : null,
    line(`${FABRIC.sn2201.label} — OOB leaf`, FABRIC.sn2201.desc, fac.oobSwitchesCharged,
      FABRIC.sn2201.watts, FABRIC.sn2201.weightKg,
      fb.oobRackLeaves ? `${fb.oobLeaves} in the fabric rack${fac.rackScale ? `; the ${fb.oobRackLeaves} in the compute racks are listed above` : ` + ${fb.oobRackLeaves} in the compute racks`}` : 'dual-homed management'),
    fb.oobSpines ? line(`${FABRIC.sn4600c.label} — OOB spine`, FABRIC.sn4600c.desc, fb.oobSpines,
      FABRIC.sn4600c.watts, FABRIC.sn4600c.weightKg, '100GbE aggregation') : null,

    fac.cdu ? line(fac.cdu.spec.label, fac.cdu.spec.model, fac.cdu.units, fac.cdu.spec.watts, fac.cdu.spec.weightKg,
      fac.cdu.spec.floorMM ? `${fac.cdu.spec.capacityKw} kW · floor cabinet ${fac.cdu.spec.floorMM}` : `${INFRA.cdu.ru}U in the compute rack`) : null,
    fac.tier2Count ? line(INFRA.tier2.label, INFRA.tier2.model, fac.tier2Count, t2Spec.watts, t2Spec.weightKg,
      `${INFRA.tier2.ru}U · 36 × 3.5" bays${specLine(t2Spec)}`) : null,
    fac.nvidia
      ? line(INFRA['cp-node'].label, fac.mgmt.cpModel, fac.mgmt.cpCount, cpSpec.watts, cpSpec.weightKg,
        `${fac.mgmt.cpDesc}${specLine(cpSpec)}`)
      : line('Management rack', `${RACK.mgmtRack.contents.length} devices`, 1, fac.mgmt.watts, fac.mgmt.weightKg,
        'routers, platform servers, Tier 3, OOB firewalls, break-glass'),
  ].filter(Boolean);

  const round2 = (v) => Math.round(v * 100) / 100;
  rows.forEach((x) => {
    x.totalW = x.counts && x.unitW ? x.qty * x.unitW : null;
    x.totalKg = x.counts && x.unitKg ? round2(x.qty * x.unitKg) : null;
  });
  const totalW = rows.reduce((a, x) => a + (x.totalW || 0), 0);
  const totalKg = round2(rows.reduce((a, x) => a + (x.totalKg || 0), 0));
  return { rows, totalW, totalKg };
}

/* ---------- optics and cabling bill of materials ----------
   Counts are derived from this design's own port totals using the per-link
   ratios NVIDIA publishes in RA-11337-001 Table 9.1 (one twin-port switch
   transceiver and two fibres per 800G node port, two leaf-spine twin-ports
   and fibres per port) — which in link terms is one transceiver per two
   links and one fibre per link. Feeding that document's own configuration
   back in reproduces its quantities: 256 nodes x 8 compute ports gives 2,048
   node transceivers, 2,048 twin-port switch transceivers and 4,096 node-leaf
   fibres. Stated per link, the same ratios reproduce the NVIDIA Enterprise RA
   cabling tables for 400G nodes too: an HGX H200 node's eight B3140H ports
   are eight links, so 32 nodes take 256 node transceivers, 128 switch-side
   twin-ports and 256 fibres, as that RA's Table 7 lists them. */
function cablingBOM({ fac, node, gpuNodes, weka }) {
  const fb = fac.fabric;
  const r = CABLE_RATIOS;
  const nvidia = !!fac.nvidia;
  const ewPorts = gpuNodes * node.ewPortsPerNode;
  // A ConnectX-8 800G port carries two 400G links through its twin-port
  // transceiver (the dual-plane compute fabric); a 400G port carries one.
  const linksPerPort = node.ewLinksPerPort || (node.ewPortGb >= 800 ? 2 : 1);
  const ewLinks = ewPorts * linksPerPort;
  // Storage / north-south and in-band management: one dual-port DPU plus a
  // bonded pair per chassis in the InferX designs; the NVIDIA RAs converge
  // storage and in-band on the BlueField-3 pair, so their nodes set the
  // in-band pair to 0. A 200G B3220 port lands four to a twin-port cage.
  const nsPorts = gpuNodes * (node.nsPortsPerNode || 2);
  const nsPerCage = 800 / (node.nsPortGb || 400);
  const ibPorts = gpuNodes * (node.ibPortsPerNode == null ? 2 : node.ibPortsPerNode);
  const stPorts = weka ? weka.ports : 0; // WEKApod data ports
  const mgmtDevices = fac.mgmt ? fac.mgmt.contents.length : RACK.mgmtRack.contents.length;
  const mgmtOobPorts = fac.mgmt && fac.mgmt.oobPorts != null ? fac.mgmt.oobPorts : mgmtDevices * 2;
  // The same count the leaf total was sized from, so the cable schedule and
  // the switch count can never disagree.
  const oobLinks = fb.oobLinks ? fb.oobLinks.total : fb.oobPorts;

  // Each stack orders its own part numbers: the InferX designs quote the
  // InferX BOM, the NVIDIA profiles the parts in NVIDIA's own RA tables.
  // Switch-side optics also come in InfiniBand trim under a different suffix,
  // so a plane running IB orders that variant of the same twin-port cage.
  const P = OPTIC_SETS[nvidia ? 'nvidia' : 'inferx'];
  const ewTwin = fb.ewTech === 'infiniband' ? 'osfp-twin-800-ib' : P.twin;
  const nsTwin = fb.nsTech === 'infiniband' ? 'osfp-twin-800-ib' : P.twin;
  const nsQsfp = fb.nsTech === 'infiniband' ? 'qsfp-400-ib' : P.nsNode;
  const ewLabel = `Compute fabric (east-west, ${FABRIC_TRANSPORTS[fb.ewTech].label})`;
  const nsLabel = `Storage fabric (north-south, ${FABRIC_TRANSPORTS[fb.nsTech].label})`;

  // Per link: half a twin-port transceiver on the leaf, one fibre; the
  // leaf-spine tier repeats that at both ends of every uplink.
  const nodeOptic = node.ewPortGb >= 800 ? P.ewNode800 : P.ewNode400;
  const ewLeafSpines = fb.ewSpines ? ewLinks : 0;
  const nsSwitchLabel = fb.consolidated ? 'converged leaf side, DPU-facing' : 'leaf side, DPU-facing';
  // The management stack's own north-south ports. On an NVIDIA profile that is
  // the RA's control-plane DPU pair; on an InferX tier it is the BlueField-3
  // the RA BOM puts in every platform server, router and CPU node, plus the
  // single-port B3140H in each Tier 2 chassis.
  const cpGb = fac.mgmt && fac.mgmt.nsGb ? fac.mgmt.nsGb : 400;
  const cpPorts = fac.mgmt && fac.mgmt.nsPorts != null
    ? fac.mgmt.nsPorts : mgmtDevices * 2;
  const cpPerCage = Math.max(1, 800 / cpGb);
  // Named from the profile, not fixed: the three NVIDIA stacks put different
  // adapters in their control-plane nodes, and the InferX rack has platform
  // servers and CPU nodes rather than control-plane nodes at all.
  const cpAdapter = (fac.mgmt && fac.mgmt.cpAdapter) || INFRA['cp-node'].dpu;
  const cpLabel = nvidia
    ? `control-plane nodes (${cpAdapter}), ${cpGb}G per link`
    : `platform servers, routers and CPU nodes (${INFRA['platform-server'].dpu}), ${cpGb}G per link`;

  const tier2Ports = nvidia ? 0 : (fac.tier2Count || 0) * (INFRA.tier2.nsPorts || 0);
  const rows = [
    { group: ewLabel, optic: nodeOptic, qty: ewPorts * r.nodeTransceiverPerPort, note: linksPerPort > 1 ? `node side, ${linksPerPort} × 400G links per port` : 'node side' },
    { group: ewLabel, optic: ewTwin, qty: Math.ceil(ewLinks / 2), note: 'leaf side, node-facing' },
    { group: ewLabel, optic: P.nodeFibre, qty: ewLinks, note: 'node to leaf' },
    ewLeafSpines ? { group: ewLabel, optic: ewTwin, qty: ewLeafSpines, note: 'leaf to spine' } : null,
    ewLeafSpines ? { group: ewLabel, optic: P.spineFibre, qty: ewLeafSpines, note: 'leaf to spine' } : null,

    { group: nsLabel, optic: nsQsfp, qty: nsPorts, note: 'BlueField-3, node side' },
    { group: nsLabel, optic: nsTwin, qty: Math.ceil(nsPorts / nsPerCage), note: nsSwitchLabel },
    { group: nsLabel, optic: P.nodeFibre, qty: nsPorts, note: 'node to leaf' },
    // Storage and the control plane land on the same fabric and need their own
    // switch-side cages; the RA lists both as separate lines ("switch to
    // Storage", "switch to control-plane B3220 DPUs") rather than folding them
    // into the node figure. A cage carries 800G, so it takes two 400G WEKApod
    // ports or four 200G control-plane ports.
    stPorts ? { group: nsLabel, optic: nsQsfp, qty: stPorts, note: 'WEKApod side' } : null,
    stPorts ? { group: nsLabel, optic: nsTwin, qty: Math.ceil(stPorts / 2), note: 'leaf side, storage-facing' } : null,
    stPorts ? { group: nsLabel, optic: P.mgmtFibre, qty: stPorts, note: 'WEKApod to leaf' } : null,

    ibPorts ? { group: 'In-band management', optic: P.nsNode, qty: ibPorts, note: 'bonded pair per node' } : null,
    ibPorts ? { group: 'In-band management', optic: P.mgmtFibre, qty: ibPorts, note: 'node to leaf' } : null,
    { group: 'In-band management', optic: P.cpNode, qty: cpPorts, note: cpLabel },
    { group: 'In-band management', optic: nsTwin, qty: Math.ceil(cpPorts / cpPerCage), note: `leaf side, control-plane facing (${cpPerCage} × ${cpGb}G per 800G cage)` },
    { group: 'In-band management', optic: P.mgmtFibre, qty: cpPorts, note: nvidia ? 'control plane to leaf' : 'management stack to leaf' },
    tier2Ports ? { group: nsLabel, optic: nsQsfp, qty: tier2Ports, note: 'Tier 2 block storage, BlueField-3 B3140H' } : null,
    tier2Ports ? { group: nsLabel, optic: nsTwin, qty: Math.ceil(tier2Ports / 2), note: 'leaf side, Tier 2 facing' } : null,
    tier2Ports ? { group: nsLabel, optic: P.mgmtFibre, qty: tier2Ports, note: 'Tier 2 to leaf' } : null,
    nvidia ? null : { group: 'In-band management', optic: 'osfp-800-uplink', qty: Math.max(4, fb.oobLeaves), note: 'inband spine to OOB leaf, NFS and uplink' },
    nvidia ? null : { group: 'In-band management', optic: 'splitter-dr4', qty: Math.max(2, Math.ceil(fb.oobLeaves / 2)), note: 'DR4 breakout to NFS, SN2201 and uplink' },
    // The Enterprise RAs provision two 100G customer-network connections per
    // node (at least 25 Gb/s per GPU); InferX carries a redundant edge pair.
    nvidia
      ? { group: 'In-band management', optic: 'dr1-100', qty: gpuNodes * 2, note: 'customer network, 2 × 100GbE per node (RA endpoint table)' }
      : { group: 'In-band management', optic: P.edge, qty: 6, note: 'OOB firewall HA pair, firewall uplink and transit router uplink' },

    { group: 'Out-of-band management', optic: P.copper, qty: oobLinks, note: node.rackScale ? 'tray and DPU BMCs, switch trays, power shelves, switches' : nvidia ? `${node.oobLinksPerNode} per node per the RA, plus switches, control plane and storage` : 'BMC, host management, switches, PDUs' },
    { group: 'Out-of-band management', optic: P.oobUplink, qty: (fb.oobLeaves + (fb.oobRackLeaves || 0)) * 2, note: (fb.oobRackLeaves ? 'SN2201 uplinks, fabric rack and in-rack pairs' : 'SN2201 uplinks') },
  ].filter(Boolean);

  // Collapse duplicate part numbers within a group for a clean order list.
  const totals = {};
  rows.forEach((x) => {
    const key = x.optic;
    totals[key] = (totals[key] || 0) + x.qty;
  });

  return {
    rows: rows.map((x) => ({ ...x, spec: OPTICS[x.optic] })),
    totals: Object.entries(totals).map(([k, qty]) => ({ optic: k, spec: OPTICS[k], qty }))
      .sort((a, b) => b.qty - a.qty),
    ports: { ewPorts, ewLinks, nsPorts, ibPorts, stPorts, cpPorts, tier2Ports, oobLinks },
  };
}

/* ---------- rack layout ----------
   Device placement mirrors the reference architecture elevations: the fixed
   management rack, GPU racks with their storage and CDU, a switch-fabric rack
   ordered OOB / north-south / east-west from the top down, and WEKApod chassis
   stacked in the storage rack. */
function buildRALayout(f, opts) {
  let fabricRacksDrawn = 0;
  const node = f.node;
  const liquid = f.cooling.cdu;
  const nodeRu = liquid && node.ruLiquid ? node.ruLiquid : node.ru;
  const gpu = GPUS[node.gpuKey];
  const totalU = RACK.totalU;
  const racks = [];
  // A link runs at the slower end: a ConnectX-8 on a Quantum-2 NDR fabric is a
  // 400G link, whatever the NIC could do on Spectrum-4.
  const ewGb = Math.min(node.ewPortGb, f.fabric.ewSwitch.portGb || node.ewPortGb);
  const nsGb = Math.min(f.fabric.nsPortGb || 400, f.fabric.nsSwitch.portGb || 400);

  const dev = (uTop, ru, type, name, detail, extra) =>
    Object.assign({ uTop, ru, type, name, detail }, extra || {});

  const m = [];
  // Each device carries what its real front and rear show, so the elevations
  // draw the actual bay, port and PSU layout rather than a generic box.
  // AS-1125HS-TNR: a 12-bay 1U Hyper, populated with eight drives.
  const hyper = { drives: 8, bays: 12 };
  // Every management-stack box draws the north-south ports its record gives
  // it, so the rear face and the cable plan agree with the BOM.
  const infraNs = (key) => {
    const r = INFRA[key] || {};
    return r.nsPorts ? { nsPorts: r.nsPorts, nsGb: r.nsPortGb || 400, dpu: r.dpu } : {};
  };
  if (f.nvidia) {
    // --- control-plane rack of the NVIDIA reference architectures ---
    // The RA's management nodes at the same 2U pitch the InferX rack uses,
    // under a patch panel; the OOB pair sits in the fabric rack with the
    // rest of the switches, as the RAs' end-of-row network puts it.
    const cp = f.mgmt;
    m.push(dev(48, 1, 'panel', 'Patch panel', 'Fibre + copper', { face: 'patch' }));
    let u = 46;
    for (let i = 0; i < cp.cpCount; i++, u -= cp.cpRu + 1) {
      m.push(dev(u, cp.cpRu, 'infra', `Control-plane node ${i + 1}`, cp.cpModel, { ...hyper, nsPorts: cp.cpNsPorts, nsGb: cp.cpNsGb, dpu: cp.cpAdapter }));
    }
    racks.push({ name: 'Control-plane rack', kind: 'mgmt', devices: m });
  }
  // --- management rack, fixed across all three InferX reference designs ---
  if (!f.nvidia) {
  m.push(dev(48, 1, 'panel', 'Patch panel', 'Fibre + copper', { face: 'patch' }));
  m.push(dev(47, 1, 'panel', 'Converter', 'Media converter', { face: 'converter' }));
  m.push(dev(46, 3, 'infra', 'OOB break-glass', 'RevPi + SITOP', { face: 'shelf' }));
  m.push(dev(42, 1, 'infra', 'Serial switch', INFRA.serial.model, { face: 'ports', rj45: 48, sfp: 2 }));
  m.push(dev(40, 1, 'infra', 'OOB firewall A', INFRA['oob-fw'].model, { face: 'ports', rj45: 12, sfp: 8 }));
  m.push(dev(38, 1, 'infra', 'OOB firewall B', INFRA['oob-fw'].model, { face: 'ports', rj45: 12, sfp: 8 }));
  const routerFace = { ...hyper, ...infraNs('platform-router') };
  const serverFace = { ...hyper, ...infraNs('platform-server') };
  m.push(dev(36, 1, 'infra', 'Platform router A', INFRA['platform-router'].model, routerFace));
  m.push(dev(34, 1, 'infra', 'Platform router B', INFRA['platform-router'].model, routerFace));
  m.push(dev(32, 1, 'infra', 'Platform server 1', INFRA['platform-server'].model, serverFace));
  m.push(dev(30, 1, 'infra', 'Platform server 2', INFRA['platform-server'].model, serverFace));
  m.push(dev(28, 1, 'infra', 'Platform server 3', INFRA['platform-server'].model, serverFace));
  m.push(dev(26, 2, 'infra', 'Tier 3 storage', INFRA.tier3.model, { face: 'nas', drives: 4 }));
  // The RA elevation puts an out-of-band leaf pair here. These are part of the
  // fabric's own leaf count, not additional to it: drawing them unconditionally
  // while the fabric rack also drew every leaf the fabric budgeted put two
  // switches in the elevation that nothing had bought.
  const mgmtOob = Math.min(RACK.mgmtOobLeaves, f.fabric.oobLeaves);
  for (let i = 0; i < mgmtOob; i++) {
    m.push(dev(24 - i, 1, 'switch', `OOB leaf ${'AB'[i] || i + 1}`, FABRIC.sn2201.label, { ports: 48, portGb: 1, uplinks: 4, role: 'oob', tier: 'leaf' }));
  }
  // The CPU compute nodes fill upward from the bottom of the rack, however
  // many the design runs, and everything that shares that space stacks above
  // whatever they occupy.
  const cpuFace = { ...hyper, ...infraNs('cpu-node') };
  const cpuNodes = f.mgmt.cpuNodes != null ? f.mgmt.cpuNodes : RACK.mgmtRack.cpuNodes;
  for (let i = 0; i < cpuNodes; i++) {
    m.push(dev(cpuNodes - i, 1, 'infra', `CPU compute node ${i + 1}`, INFRA['cpu-node'].model, cpuFace));
  }
  // An NVL72 rack has no spare units for Tier 2, so on the rack-scale track
  // the three fixed units stack in the management rack's free space above the
  // CPU nodes, and any edge-site leaves pack above them without the service
  // gap so that the 48U still closes.
  const tier2Here = !f.tier2InCompute;
  let stackTop = cpuNodes;
  if (tier2Here) {
    for (let i = 0; i < f.tier2Count; i++) {
      m.push(dev(stackTop + INFRA.tier2.ru * (i + 1), INFRA.tier2.ru, 'infra', `Tier 2 block storage ${i + 1}`, INFRA.tier2.model, { face: 'lff', drives: 36, frontBays: 24, rearBays: 12, ...infraNs('tier2') }));
    }
    stackTop += INFRA.tier2.ru * f.tier2Count;
  }
  // With no dedicated fabric rack the data-plane leaves sit in the management
  // rack, exactly as the edge reference design draws them.
  if (f.fabricRacks === 0) {
    const ewSw = f.fabric.ewSwitch, nsSw = f.fabric.nsSwitch;
    const gap = tier2Here ? 0 : 1;
    // Down from just under the out-of-band pair, never into what is already
    // stacked at the bottom.
    let u = Math.min(RACK.mgmtRack.cpuNodeCeilingU, RACK.mgmtRack.cpuNodeCeilingU - (gap ? 2 : 0));
    for (let i = 0; i < f.fabric.nsLeaves; i++, u -= nsSw.ru + gap) {
      m.push(dev(u, nsSw.ru, 'switch', `North-south leaf ${i + 1}`, nsSw.label, { ports: nsSw.ports, portGb: nsSw.portGb, role: 'ns', tier: 'leaf' }));
    }
    for (let i = 0; i < f.fabric.ewLeaves; i++, u -= ewSw.ru + gap) {
      m.push(dev(u, ewSw.ru, 'switch', `East-west leaf ${i + 1}`, ewSw.label, { ports: ewSw.ports, portGb: ewSw.portGb, role: 'ew', tier: 'leaf' }));
    }
  }
  racks.push({ name: 'Management rack', kind: 'mgmt', devices: m });
  }

  // --- GPU compute racks ---
  const perRack = f.cooling.gpuNodesPerRack;
  let placed = 0;
  if (f.rackScale) {
    // GB300 NVL72, as NVIDIA and Supermicro draw it: the OOB pair and half the
    // power shelves at the top, ten compute trays, the nine NVLink switch
    // trays in the middle, eight more compute trays, the other four shelves,
    // and — only for the in-rack option — the 4U CDU in the spare units below.
    // All I/O is on the front of an NVL72 tray; the rear is busbar, manifold
    // and the NVLink cable cartridge, so cabling is drawn on the front.
    const rk = node.rack;
    const shelfDetail = `${rk.shelfKw} kW · ${rk.psusPerShelf} × ${rk.psuKw} kW PSU`;
    const trayExtra = {
      gpuCount: rk.gpusPerTray, gpuShort: gpu.short, cpus: rk.cpusPerTray,
      ewPorts: rk.gpusPerTray, ewGb, nsPorts: (node.nsPortsPerNode || 36) / rk.computeTrays, nsGb,
      drives: rk.trayDrives, bays: 8,
    };
    for (let r = 0; r < f.computeRacks; r++) {
      const d = [];
      let u = totalU, tray = 0;
      for (let i = 0; i < (rk.oobSwitches || 0); i++, u -= FABRIC.sn2201.ru) {
        d.push(dev(u, FABRIC.sn2201.ru, 'switch', `OOB leaf ${'AB'[i] || i + 1}`, FABRIC.sn2201.label, { ports: 48, portGb: 1, uplinks: 4, role: 'oob', tier: 'leaf' }));
      }
      const shelvesAbove = Math.ceil(rk.powerShelves / 2);
      for (let i = 0; i < shelvesAbove; i++, u -= rk.shelfRu) {
        d.push(dev(u, rk.shelfRu, 'powershelf', `Power shelf ${i + 1}`, shelfDetail, { psuCount: rk.psusPerShelf }));
      }
      for (let i = 0; i < rk.traysAbove; i++, u -= rk.trayRu) {
        tray++;
        d.push(dev(u, rk.trayRu, 'tray', `Compute tray ${tray}`, `${rk.gpusPerTray}× ${gpu.short} · ${rk.cpusPerTray}× Grace`, trayExtra));
      }
      for (let i = 0; i < rk.switchTrays; i++, u -= rk.switchTrayRu) {
        d.push(dev(u, rk.switchTrayRu, 'nvswitch', `NVLink switch ${i + 1}`, `${rk.nvswitchPerTray}× NVSwitch 5 · 144 ports`, { nvswitch: rk.nvswitchPerTray }));
      }
      for (let i = rk.traysAbove; i < rk.computeTrays; i++, u -= rk.trayRu) {
        tray++;
        d.push(dev(u, rk.trayRu, 'tray', `Compute tray ${tray}`, `${rk.gpusPerTray}× ${gpu.short} · ${rk.cpusPerTray}× Grace`, trayExtra));
      }
      for (let i = shelvesAbove; i < rk.powerShelves; i++, u -= rk.shelfRu) {
        d.push(dev(u, rk.shelfRu, 'powershelf', `Power shelf ${i + 1}`, shelfDetail, { psuCount: rk.psusPerShelf }));
      }
      if (f.cdu && f.cdu.inRack) {
        d.push(dev(u, INFRA.cdu.ru, 'infra', 'CDU 250 kW', INFRA.cdu.label, { face: 'cdu' }));
      }
      placed++;
      racks.push({ name: `GB300 NVL72 rack ${r + 1}`, kind: 'gpu', ioSide: 'front', devices: d });
    }
  }
  // The DGX SuperPOD RA puts one SN2201 in every DGX rack; the Enterprise
  // RAs keep theirs end-of-row with the other switches.
  const oobInRack = f.nvidia && !f.rackScale ? (f.profile.fabric.oobInRack || 0) : 0;
  for (let r = 0; !f.rackScale && r < f.computeRacks; r++) {
    const d = [];
    const here = Math.min(perRack, opts.gpuNodes - placed);
    // Reserve the bottom of the rack for storage and, on DLC, the CDU.
    let bottom = 1;
    if (liquid) { d.push(dev(4, INFRA.cdu.ru, 'infra', 'CDU 250 kW', INFRA.cdu.label, { face: 'cdu' })); bottom = 5; }
    // Only the first few InferX compute racks carry Tier 2 block storage.
    if (r < f.tier2Count) {
      // SSG-641E-E1CR36L: 36 LFF bays, 24 on the front and 12 on the rear.
      d.push(dev(bottom + INFRA.tier2.ru - 1, INFRA.tier2.ru, 'infra', 'Tier 2 block storage', INFRA.tier2.model, { face: 'lff', drives: 36, frontBays: 24, rearBays: 12, ...infraNs('tier2') }));
      bottom += INFRA.tier2.ru;
    }
    // Stack GPU nodes downward from the top of the rack, under the in-rack
    // OOB leaf where the design has one.
    let u = totalU;
    for (let i = 0; i < oobInRack; i++, u -= FABRIC.sn2201.ru) {
      d.push(dev(u, FABRIC.sn2201.ru, 'switch', oobInRack > 1 ? `OOB leaf ${'AB'[i] || i + 1}` : 'OOB leaf', FABRIC.sn2201.label, { ports: 48, portGb: 1, uplinks: 4, role: 'oob', tier: 'leaf' }));
    }
    for (let n = 0; n < here; n++) {
      placed++;
      d.push(dev(u, nodeRu, node.label.startsWith('NVIDIA DGX') ? 'dgx' : 'gpu',
        `GPU node ${placed}`, `${node.gpuCount}x ${gpu.short}${liquid ? ' DLC' : ''}`,
        { gpuCount: node.gpuCount, gpuShort: gpu.short, ewPorts: node.ewPortsPerNode,
          ewGb, nsPorts: node.nsPortsPerNode || 2, nsGb, psuCount: node.psuCount || 4 }));
      u -= nodeRu;
    }
    racks.push({ name: `GPU compute rack ${r + 1}`, kind: 'gpu', devices: d });
  }

  // --- switch fabric rack(s) ---
  if (f.fabricRacks > 0) {
    const all = [];
    for (let i = 0; i < f.fabric.oobSpines; i++) all.push({ ru: 2, label: `OOB spine ${i + 1}`, m: FABRIC.sn4600c, role: 'oob', tier: 'spine' });
    // On the InferX tiers the management rack has already taken the first pair.
    const oobTaken = f.nvidia ? 0 : Math.min(RACK.mgmtOobLeaves, f.fabric.oobLeaves);
    for (let i = oobTaken; i < f.fabric.oobLeaves; i++) all.push({ ru: 1, label: `OOB leaf ${i + 1}`, m: FABRIC.sn2201, role: 'oob', tier: 'leaf' });
    for (let i = 0; i < f.fabric.nsSpines; i++) all.push({ ru: f.fabric.nsSwitch.ru, label: `North-south spine ${i + 1}`, m: f.fabric.nsSwitch, role: 'ns', tier: 'spine' });
    for (let i = 0; i < f.fabric.nsLeaves; i++) all.push({ ru: f.fabric.nsSwitch.ru, label: `North-south leaf ${i + 1}`, m: f.fabric.nsSwitch, role: 'ns', tier: 'leaf' });
    // A consolidated NVIDIA design has one set of leaves carrying compute and
    // the converged network alike; they keep the east-west role so the link
    // plan lands both on them.
    const ewName = f.fabric.consolidated ? 'Converged' : 'East-west';
    for (let i = 0; i < f.fabric.ewSpines; i++) all.push({ ru: f.fabric.ewSwitch.ru, label: `${ewName} spine ${i + 1}`, m: f.fabric.ewSwitch, role: 'ew', tier: 'spine' });
    for (let i = 0; i < f.fabric.ewLeaves; i++) all.push({ ru: f.fabric.ewSwitch.ru, label: `${ewName} leaf ${i + 1}`, m: f.fabric.ewSwitch, role: 'ew', tier: 'leaf' });

    // Keep opening racks until every switch is placed. Sizing and drawing must
    // agree, so the loop is driven by the switch list rather than a rack count.
    let idx = 0, r = 0;
    while (idx < all.length) {
      // Start below the units reserved for patch panels and cable management,
      // which is the same allowance the facility roll-up buys racks for.
      const d = []; let u = totalU - RACK.fabricReserveU;
      while (idx < all.length) {
        const sw = all[idx];
        if (u - sw.ru + 1 < 1) break;
        d.push(dev(u, sw.ru, 'switch', sw.label, sw.m.label, { ports: sw.m.ports, portGb: sw.m.portGb, uplinks: sw.m.portGb === 1 ? 4 : 0, role: sw.role, tier: sw.tier }));
        u -= sw.ru;
        idx++;
      }
      r++;
      racks.push({ name: `Switch fabric rack ${r}`, kind: 'fabric', devices: d });
    }
    fabricRacksDrawn = r;
  }

  // --- storage rack(s) ---
  if (f.storageRacks > 0 && f.storage.nodes > 0) {
    const pod = WEKAPODS[f.storage.podKey] || null;
    const podRu = f.storage.podRu || 1;
    const podName = pod ? pod.model : 'WEKApod';
    const podDetail = pod ? `${pod.drives} × ${pod.driveTB} TB` : 'WEKApod node';
    let placed = 0;
    for (let r = 0; r < f.storageRacks && placed < f.storage.nodes; r++) {
      // Below the units reserved for patch panels and cable management, which
      // is the same allowance the roll-up buys racks for.
      const d = []; let u = totalU - RACK.storageReserveU;
      while (placed < f.storage.nodes && u - podRu + 1 >= 1) {
        placed++;
        d.push(dev(u, podRu, 'wekapod', `${podName} ${placed}`, podDetail,
          { drives: pod ? pod.drives : 14, driveType: pod ? pod.driveType : 'E3.S',
            ports: pod ? pod.ports : 4, portGb: pod ? pod.portGb : 400,
            nics: 2, mgmtPorts: pod && pod.mgmtPorts ? pod.mgmtPorts : 2 }));
        u -= podRu;
      }
      racks.push({ name: f.storageRacks > 1 ? `Storage rack ${r + 1}` : 'POSIX/S3/AI storage rack', kind: 'storage', devices: d });
    }
  }

  // --- coolant distribution cabinets ---
  // In-row and sidecar CDUs are floor-standing cabinets the height of a rack,
  // so they take a position in the row; drawn as one full-height unit each so
  // the overview and the elevations account for the floor space.
  if (f.cdu && f.cdu.racks > 0) {
    const spec = f.cdu.spec;
    for (let i = 0; i < f.cdu.racks; i++) {
      const perUnit = spec.racksPerUnit || 1;
      const serves = perUnit > 1 ? `racks ${i * perUnit + 1}–${Math.min(f.computeRacks, (i + 1) * perUnit)}` : `rack ${i + 1}`;
      racks.push({
        name: `${perUnit > 1 ? 'In-row CDU' : 'Sidecar CDU'} ${i + 1}`, kind: 'cooling',
        devices: [dev(totalU, totalU, 'infra', spec.label.replace(/^Supermicro (.)/, (m, c) => c.toUpperCase()), `${spec.model} · ${spec.capacityKw >= 1000 ? `${spec.capacityKw / 1000} MW` : `${spec.capacityKw} kW`} · serves ${serves}`,
          { face: 'cabinet', capacityKw: spec.capacityKw, watts: spec.watts, floorMM: spec.floorMM, l2a: perUnit === 1 })],
      });
    }
  }

  return { racks, nodeRu, fabricRacksDrawn };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sizeInference, sizeFacility, mgmtRackSpec, nvidiaFabric, hardwareBOM, gpuSpecSheet, buildRALayout, sizeWekapod, wekapodNodesFor, cablingBOM, kvBytesPerToken, weightBytes, replicaThroughput, minTensorParallel };
}
