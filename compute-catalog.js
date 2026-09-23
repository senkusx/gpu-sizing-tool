/* InferX / Radian Arc reference architecture — compute catalog.

   Node power, weight and rack composition are taken from the "Three Reference
   Architectures — Regional, Core, Edge" and "Rack Design Template 2MW" sheets.
   Every figure below reconciles exactly with the per-rack totals in those
   elevations (verified: air B300 rack 2x13899+1188 = 28986 W; liquid rack
   8x13899+3000+1188 = 115380 W; 128 B300 nodes = 1,779,072 W).

   Alongside the InferX designs the catalog carries NVIDIA's published
   reference architectures — the Enterprise RA "AI Factory" documents, the
   NVL72 AI Factory RA and the DGX SuperPOD RA — as their own deployment
   profiles (RA_PROFILES) and node records (the `nv-` nodes). Those follow the
   RA documents, with physical figures from named NVIDIA-Certified systems,
   and .github/scripts/verify-nvidia-ra.js checks the engine against the
   switch and cabling counts the documents publish.

   GPU die specs are cross-checked against open-gpu-db (Apache-2.0). Its TDP
   figures independently agree with the BOM — B300 1400 W, RTX PRO 6000 600 W —
   which is a useful confirmation that the sheets' power model is sound. That
   database carries no memory-bandwidth values, so bandwidth and dense low-
   precision compute are filled in from NVIDIA's published specifications and
   flagged per record. */

/* ---------- accelerators ----------

   Two conventions hold across every part below and are relied on rather than
   duplicated as separate fields:

   - FP16 and BF16 run at the same tensor-core rate on Hopper, Ada and
     Blackwell, so the BF16 figure is the FP16 figure.
   - INT8 runs at the FP8 tensor-core rate. NVIDIA's own datasheets list them
     as the same number (H100: 1,979 TFLOPS FP8 and 1,979 TOPS INT8). A record
     that carries `int8TOPS` overrides this — Blackwell Ultra publishes a far
     lower INT8 figure than its FP8 rate.

   Every `denseTFLOPS` value is the DENSE rate. NVIDIA's headline marketing
   numbers are usually the 2:1 structured-sparsity rate, i.e. double these;
   sparsity needs a pruned model, so dense is the honest planning figure.

   `fp32TFLOPS` is vector FP32 on the CUDA cores, not a tensor-core rate — it
   is what non-tensor kernels get, and it is a different order of magnitude
   from the tensor columns beside it.

   Die-level counts (SMs, CUDA cores, tensor cores) and vector FP32 are
   published for the Hopper, Ada and RTX Blackwell parts. NVIDIA does not
   publish them for the HGX Blackwell parts, so those carry null and render as
   "not published" rather than an invented number. */
const GPUS = {
  'b300': {
    label: 'NVIDIA HGX B300 (Blackwell Ultra)', short: 'B300', arch: 'Blackwell Ultra',
    memGB: 288, memType: 'HBM3e', bwGBs: 8000, tdpW: 1400,
    // NVIDIA's HGX B300 column, per 8-GPU baseboard, halved to dense where the
    // page marks a figure sparse: FP4 144 | 108 PFLOPS (sparse | dense) -> 13.5
    // dense per GPU; FP8/FP6 72 PFLOPS sparse -> 4.5; FP16/BF16 36 PFLOPS
    // sparse -> 2.25. Blackwell Ultra trades INT8 for NVFP4, so INT8 is the
    // published 3 POPS sparse -> 187.5 TOPS dense per GPU rather than the FP8
    // rate the other parts follow.
    denseTFLOPS: { fp4: 13500, fp8: 4500, bf16: 2250 },
    int8TOPS: 187.5,
    // Vector FP32 is published for the baseboard (600 TFLOPS / 8); the SM,
    // CUDA-core and tensor-core counts still are not.
    fp32TFLOPS: 75, smCount: null, cudaCores: null, tensorCores: null,
    nvlink: true, nvlinkGBs: 1800, interconnect: 'NVLink 5',
    src: 'NVIDIA HGX platform specification, HGX B300 column (8-GPU baseboard): FP4 144 | 108 PFLOPS sparse | dense, FP8/FP6 72 PFLOPS sparse, INT8 3 POPS sparse, FP16/BF16 36 PFLOPS sparse, FP32 600 TFLOPS, NVLink 1.8 TB/s per GPU — divided by 8 and halved to dense here. TDP confirmed by open-gpu-db and the RA BOM. NVIDIA quotes 288 GB per GPU in the HGX AI Factory RA (2,304 GB per node) while the HGX and DGX B300 product pages quote 2.1 TB per 8-GPU system; the per-GPU RA figure is used',
  },
  // The Blackwell Ultra GPU as it ships inside the GB300 NVL72, which is not
  // the HGX B300 SXM: NVIDIA's own datasheets give the rack-scale part a higher
  // envelope. GB300 NVL72 lists 1,440 | 1,080 PFLOPS FP4 (sparse | dense),
  // 720 PFLOPS FP8, 360 PFLOPS FP16/BF16, 24 POPS INT8, 6 PFLOPS FP32 and
  // 576 TB/s across 72 GPUs; HGX B300 lists 144 | 108 PFLOPS FP4, 72 PFLOPS
  // FP8 and 3 POPS INT8 across 8. Per GPU that is 15 vs 13.5 PFLOPS dense FP4,
  // so the two are kept as separate records rather than one B300 figure.
  // Blackwell Ultra trades INT8 and FP64 for NVFP4 throughput, so INT8 is a
  // published figure here rather than the FP8 rate the other parts follow.
  'gb300': {
    label: 'NVIDIA GB300 (Blackwell Ultra, NVL72)', short: 'B300', arch: 'Blackwell Ultra',
    memGB: 288, memType: 'HBM3e', bwGBs: 8000, tdpW: 1400,
    denseTFLOPS: { fp4: 15000, fp8: 5000, bf16: 2500 },
    int8TOPS: 167, fp32TFLOPS: 83,
    smCount: null, cudaCores: null, tensorCores: null,
    nvlink: true, nvlinkGBs: 1800, interconnect: 'NVLink 5 — 72-GPU domain',
    nvlinkDomain: 72, nvlinkDomainTBs: 130,
    src: 'NVIDIA GB300 NVL72 datasheet (1,440 | 1,080 PFLOPS FP4, 720 PFLOPS FP8, 360 PFLOPS BF16, 24 POPS INT8, 6 PFLOPS FP32, 576 TB/s, 130 TB/s NVLink across 72 GPUs — sparse unless noted, so dense tensor rates are half). Per-GPU TDP is not published for the NVL72; 1,400 W is the widely reported Blackwell Ultra board budget',
  },
  'b200': {
    label: 'NVIDIA HGX B200 (Blackwell)', short: 'B200', arch: 'Blackwell',
    memGB: 180, memType: 'HBM3e', bwGBs: 8000, tdpW: 1000,
    // HGX B200 column, same treatment: FP4 144 | 72 PFLOPS (sparse | dense)
    // -> 9 dense per GPU; FP8 72 and FP16/BF16 36 PFLOPS sparse -> 4.5 and
    // 2.25. INT8 (72 POPS sparse -> 4.5 POPS dense per GPU) lands on the FP8
    // rate, so it needs no separate figure.
    denseTFLOPS: { fp4: 9000, fp8: 4500, bf16: 2250 },
    fp32TFLOPS: 75, smCount: null, cudaCores: null, tensorCores: null,
    nvlink: true, nvlinkGBs: 1800, interconnect: 'NVLink 5',
    src: 'NVIDIA HGX platform specification, HGX B200 column (8-GPU baseboard): FP4 144 | 72 PFLOPS sparse | dense, FP8/FP6 72 PFLOPS sparse, INT8 72 POPS sparse, FP16/BF16 36 PFLOPS sparse, FP32 600 TFLOPS, total memory 1.4 TB — divided by 8 and halved to dense here. TDP per open-gpu-db',
  },
  'h200': {
    label: 'NVIDIA HGX H200 SXM', short: 'H200', arch: 'Hopper',
    memGB: 141, memType: 'HBM3e', bwGBs: 4800, tdpW: 700,
    denseTFLOPS: { fp8: 1979, bf16: 989 },
    fp32TFLOPS: 67, smCount: 132, cudaCores: 16896, tensorCores: 528,
    nvlink: true, nvlinkGBs: 900, interconnect: 'NVLink 4',
    src: 'NVIDIA H200 spec; TDP per open-gpu-db. Same GH100 die as the H100, hence identical core counts and compute rates',
  },
  'h100': {
    label: 'NVIDIA HGX H100 SXM', short: 'H100', arch: 'Hopper',
    memGB: 80, memType: 'HBM3', bwGBs: 3350, tdpW: 700,
    denseTFLOPS: { fp8: 1979, bf16: 989 },
    fp32TFLOPS: 67, smCount: 132, cudaCores: 16896, tensorCores: 528,
    nvlink: true, nvlinkGBs: 900, interconnect: 'NVLink 4',
    src: 'NVIDIA H100 spec',
  },
  'rtx6000b': {
    label: 'NVIDIA RTX PRO 6000 Blackwell Server', short: 'RTX PRO 6000', arch: 'Blackwell',
    // Server Edition, not Workstation Edition: 1,597 GB/s and 120 TFLOPS FP32
    // against the workstation card's 1,792 GB/s and 126 TFLOPS. NVIDIA's
    // headline tensor figures for this part (4 PFLOPS FP4, 2 PFLOPS FP8,
    // 1 PFLOP FP16/BF16) are the sparsity rates — the datasheet footnote reads
    // "Effective FP4 TOPS with sparsity" — so dense is half each. That also
    // agrees with the hardware: 188 SMs x 1,024 dense BF16 FLOP/clock at the
    // Server Edition's ~2.5 GHz is ~480 TFLOPS, not ~1 PFLOPS.
    memGB: 96, memType: 'GDDR7', bwGBs: 1597, tdpW: 600,
    denseTFLOPS: { fp4: 2000, fp8: 1000, bf16: 500 },
    fp32TFLOPS: 120, smCount: 188, cudaCores: 24064, tensorCores: 752,
    nvlink: false, nvlinkGBs: 0, interconnect: 'PCIe Gen5 x16',
    src: 'NVIDIA RTX PRO 6000 Blackwell Server Edition specification: 96 GB GDDR7, 512-bit, 1,597 GB/s, 24,064 CUDA cores, 188 fourth-generation RT cores (one per SM, hence 752 tensor cores), FP4 4 PFLOPS / FP8 2 PFLOPS / FP16-BF16 1 PFLOPS with sparsity (halved to dense here), FP32 120 TFLOPS, up to 600 W. TDP confirmed by open-gpu-db and the RA BOM',
  },
  'l40s': {
    label: 'NVIDIA L40S', short: 'L40S', arch: 'Ada Lovelace',
    memGB: 48, memType: 'GDDR6', bwGBs: 864, tdpW: 350,
    denseTFLOPS: { fp8: 733, bf16: 362 },
    fp32TFLOPS: 91.6, smCount: 142, cudaCores: 18176, tensorCores: 568,
    nvlink: false, nvlinkGBs: 0, interconnect: 'PCIe Gen4 x16',
    src: 'NVIDIA L40S specification: 48 GB GDDR6, 864 GB/s, 350 W, 18,176 CUDA cores, 142 SMs, 568 tensor cores; FP8 1,466 and BF16 733 TFLOPS with sparsity, halved to dense here. RA BOM budgets 350 W per card',
  },
};

/* ---------- GPU compute nodes (Supermicro, per RA BOM) ---------- */
const GPU_NODES = {
  'smc-b300': {
    label: 'Supermicro AS-8126GS-NB3RT', sublabel: 'NVIDIA HGX B300 8-GPU',
    ru: 8, gpuKey: 'b300', gpuCount: 8, watts: 13899, weightKg: 121,
    cpu: '2x AMD EPYC 9555 64C/128T', cpuCores: 128, ramGB: 6144,
    bootGB: 960, localTB: 61.44,
    eastWest: '8x ConnectX-8 SuperNIC OSFP 800GbE',
    northSouth: 'BlueField-3 2-port 400GbE DPU',
    ewPortsPerNode: 8, ewPortGb: 800, liquidCapable: true,
    // The DLC variant is a 4U chassis, which is how the liquid elevation fits
    // eight nodes plus a CDU into 48U where eight 8U air chassis never would.
    ruLiquid: 4, psuCount: 6,
    src: 'RA BOM + rack elevation (13899 W, 121 kg); 4U DLC chassis per the liquid elevation. SKU confirmed against the Supermicro datasheet: AS-8126GS-NB3RT is an 8U dual-EPYC 9005/9004 HGX B300 8-GPU system with 8 x 800G Ethernet and 6 x 6600 W (3+3) Titanium PSUs',
  },
  'dgx-b300': {
    label: 'NVIDIA DGX B300', sublabel: 'NVIDIA Blackwell Ultra 8-GPU (DGX)',
    ru: 10, gpuKey: 'b300', gpuCount: 8, watts: 14000, weightKg: 168,
    cpu: '2x Intel Xeon 6776P', cpuCores: 128, ramGB: 4096,
    bootGB: 1920, localTB: 61.44,
    eastWest: '8x 800G OSFP (ConnectX-8)',
    northSouth: '4x 400G OSFP (BlueField-3)',
    ewPortsPerNode: 8, ewPortGb: 800, liquidCapable: false, psuCount: 12,
    // RA-11337-001 Figure 4.9: three out-of-band links per DGX — one BMC plus
    // two BlueField-3. Two of the four BlueField-3 ports carry storage, two
    // in-band; the DGX SuperPOD profile sizes those fabrics from that split.
    oobLinksPerNode: 3, nsPortGb: 400,
    src: 'NVIDIA DGX B300 specification: 10U, ~14 kW maximum, 8 x Blackwell Ultra SXM, 2 x Intel Xeon 6776P, 8 x single-port ConnectX-8 (800 Gb/s) plus 2 x dual-port BlueField-3, 2 x 1.9 TB NVMe M.2 and 8 x 3.84 TB NVMe E1.S. 168 kg and the 12 x 3.3 kW PSU count are datasheet figures. NVIDIA quotes 2.1 TB of GPU memory per system where 8 x 288 GB would be 2.3 TB; the per-GPU 288 GB figure is used. System RAM is the published maximum',
  },
  'smc-rtx6000': {
    label: 'Supermicro AS-5126GS-TNRT2', sublabel: 'NVIDIA RTX PRO 6000 Blackwell 8-GPU',
    ru: 5, gpuKey: 'rtx6000b', gpuCount: 8, watts: 6529, weightKg: 45.3,
    cpu: '2x AMD EPYC 9555 64C/128T', cpuCores: 128, ramGB: 1536,
    bootGB: 480, localTB: 15.36,
    eastWest: 'BlueField-3 2-port 400GbE DPU',
    northSouth: 'BlueField-3 2-port 400GbE DPU',
    ewPortsPerNode: 2, ewPortGb: 400, liquidCapable: false, psuCount: 6,
    src: 'RA BOM + rack elevation (6529 W, 45.3 kg). Chassis confirmed against the Supermicro datasheet: AS-5126GS-TNRT2 is a 5U dual-EPYC system taking up to 10 double-width PCIe GPUs including the RTX PRO 6000 Blackwell Server Edition, with 6 x 2700 W Titanium PSUs. The 45.3 kg is the datasheet gross (shipping) weight, used as a populated-system proxy; the bare chassis is 29.7 kg net',
  },
  'smc-h200': {
    label: 'Supermicro AS-8125GS-TNHR', sublabel: 'NVIDIA HGX H200 8-GPU',
    ru: 8, gpuKey: 'h200', gpuCount: 8, watts: 10040, weightKg: 110,
    cpu: '2x AMD EPYC 9554 64C/128T', cpuCores: 128, ramGB: 1536,
    bootGB: 480, localTB: 15.36,
    eastWest: 'BlueField-3 B3140H 400GbE / NDR',
    northSouth: 'BlueField-3 2-port 400GbE DPU',
    ewPortsPerNode: 8, ewPortGb: 400, liquidCapable: false, psuCount: 6,
    src: 'RA BOM component roll-up (901+720+158+7+44+6860+150+1200 W); weight estimated. Chassis confirmed against the Supermicro datasheet: AS-8125GS-TNHR is an 8U dual-EPYC HGX H100/H200 8-GPU system with 6 x 3000 W Titanium PSUs, 75.3 kg net bare',
  },
  'smc-l40s': {
    label: 'Supermicro AS-4125GS-TNRT2', sublabel: 'NVIDIA L40S 2-GPU',
    ru: 4, gpuKey: 'l40s', gpuCount: 2, watts: 2186, weightKg: 38,
    cpu: '2x AMD EPYC 9554 64C/128T', cpuCores: 128, ramGB: 768,
    bootGB: 480, localTB: 15.36,
    eastWest: 'BlueField-3 2-port 400GbE DPU',
    northSouth: 'BlueField-3 2-port 400GbE DPU',
    ewPortsPerNode: 2, ewPortGb: 400, liquidCapable: false, psuCount: 4,
    src: 'RA BOM component roll-up (407+720+158+7+44+700+150 W); weight estimated. Chassis confirmed against the Supermicro datasheet: AS-4125GS-TNRT2 is a 4U dual-EPYC system taking up to 10 double-width PCIe GPUs including the L40S, with 4 x 2000 W Titanium PSUs, 29.7 kg net bare. The RA populates only 2 of the 10 slots',
  },
  /* ---------- NVIDIA reference-architecture nodes ----------
     InferX publishes no design of its own for the parts below, so they are
     reachable only through the NVIDIA reference-architecture profiles. NVIDIA's
     Enterprise RAs describe a node as a pattern (C-G-N-B: CPU sockets, GPUs,
     network adapters, average east-west GbE per GPU) plus a minimum
     specification, not as a part number, and publish no node power or weight.
     Each record therefore carries the RA's own node definition — GPUs,
     adapters, port counts, minimum CPU, memory and NVMe — and takes its
     physical figures from a named NVIDIA-Certified system that implements the
     pattern (`system`), preferring Supermicro's NVIDIA-endorsed "AI Factory"
     builds of the same RA wherever Supermicro publishes a node power figure.

     `ewLinksPerPort` is how many fabric links one node port presents: a
     ConnectX-8 800G port is split 2 × 400G across NVIDIA's dual-plane compute
     fabric, a BlueField-3 B3140H 400G port is one link. `nsPortGb` is the
     BlueField-3 DPU port speed (B3240 400G, B3220 200G). `oobLinksPerNode` is
     the RA's own 1 GbE count — six per HGX and RTX PRO node, three per NVL72
     tray — as its CAT6 tables count them. */

  /* GB300 NVL72 is bought as a rack, not a chassis: 18 one-U compute trays
     (2 GB300 superchips each — 2 Grace, 4 Blackwell Ultra) and 9 NVLink switch
     trays form one 72-GPU NVLink domain, fed by 8 power shelves on a 48 V
     busbar and cooled by direct liquid only. `rackScale` routes it through a
     separate track in the facility model: one system per rack, no Tier 2, a
     CDU in the rack only when the in-rack option is chosen, and its own OOB
     switch pair. It is the 2-4-5-800 tray of NVIDIA's NVL72 AI Factory RA and
     is offered under that profile alone.

     Every figure below reconciles with the Supermicro SRS-GB300-NVL72 datasheet
     (18 × ARS-121GL-NB3-LC, 9 NVLink switch trays, 8 × 33 kW shelves 4+4 for
     132 kW usable, 132–140 kW operating, 2236 × 600 × 1068 mm), the NVIDIA
     NVL72 AI Factory reference architecture (up to 142 kW; 4 × ConnectX-8 and
     one dual-port BlueField-3 B3240 per tray; 2 × SN2201 per rack; three 1 GbE
     links per tray) and the Lenovo LP2357 product guide (48U MGX rack, 29 kg
     per compute tray, 17 kg per switch tray, 185 kg empty rack, 960 GB LPDDR5X
     per tray). Populated rack weight is not published by any of them;
     ~1,360 kg (3,000 lb) is the figure used in NVIDIA's site-preparation
     guidance and agrees with the Lenovo component weights plus busbar,
     manifold and cable cartridges. */
  'nv-gb300-nvl72': {
    label: 'NVIDIA GB300 NVL72', sublabel: 'NVIDIA GB300 NVL72 rack-scale (72 GPUs) — 2-4-5-800 tray',
    pattern: '2-4-5-800', ra: 'nv-nvl72', system: 'Supermicro SRS-GB300-NVL72',
    rackScale: true, unit: 'NVL72 rack', unitPlural: 'NVL72 racks',
    ru: 48, gpuKey: 'gb300', gpuCount: 72, watts: 140000, weightKg: 1360,
    cpu: '36x NVIDIA Grace 72C Arm Neoverse V2 (2,592 cores)', cpuCores: 2592, ramGB: 17280,
    bootGB: 18 * 1920, localTB: 18 * 4 * 3.84,
    eastWest: '72x ConnectX-8 SuperNIC OSFP 800GbE (4 per compute tray), each split 2 × 400G across the dual-plane fabric',
    northSouth: '18x BlueField-3 B3240 2-port 400GbE DPU (1 per compute tray) — converged storage and in-band',
    ewPortsPerNode: 72, ewPortGb: 800, ewLinksPerPort: 2,
    // The B3240 pair of ports carries storage and in-band management together
    // (the RA's "converged" fabric), so there is no separate in-band pair.
    nsPortsPerNode: 36, nsPortGb: 400, ibPortsPerNode: 0,
    // Three 1 GbE links per compute tray (tray BMC, DPU BMC and the third the
    // RA counts — 54 per rack), one per switch tray and one per power shelf:
    // 71 per rack, exactly the RA's CAT6 count for one SU.
    oobLinksPerNode: 18 * 3 + 9 + 8,
    liquidCapable: true, liquidOnly: true, defaultCooling: 'inrow',
    psuCount: 48,
    feed: '8 × 415 V/60 A 3Ph (4+4 shelves)',
    dims: '2236 × 600 × 1068 mm',
    rack: {
      computeTrays: 18, traysAbove: 10, trayRu: 1, gpusPerTray: 4, cpusPerTray: 2, trayKg: 29,
      trayModel: 'ARS-121GL-NB3-LC', trayHbmGB: 1152, trayLpddrGB: 960, trayDrives: 4, trayDriveTB: 3.84,
      switchTrays: 9, switchTrayRu: 1, switchTrayKg: 17, nvswitchPerTray: 2,
      powerShelves: 8, shelfRu: 1, shelfKw: 33, psusPerShelf: 6, psuKw: 5.5, usableKw: 132,
      oobSwitches: 2, emptyKg: 185,
    },
    src: 'NVIDIA NVL72 AI Factory RA (2-4-5-800 tray: 4 × CX-8 800G dual-plane + 1 × B3240 per tray, 2 × SN2201 per rack, 71 × 1 GbE per rack, up to 142 kW); Supermicro SRS-GB300-NVL72 datasheet as the representative NVIDIA-Certified build (132–140 kW operating, 8 × 33 kW shelves 4+4, 2236 × 600 × 1068 mm); Lenovo LP2357 (48U, tray weights, 960 GB LPDDR5X per tray). Weight ~1,360 kg from NVIDIA site-prep guidance; local NVMe is 4 × 3.84 TB E1.S per tray per the DGX GB300 configuration',
  },
  /* HGX AI Factory, 2-8-9-800: eight ConnectX-8 800G SuperNICs on the HGX B300
     baseboard, each split 2 × 400G across the dual-plane compute fabric, and one
     BlueField-3 B3240 for the converged north-south fabric. The RA's node
     minimum is 48 cores per socket (56 recommended), 2 TB of system memory,
     1 TB of NVMe per socket plus a 1 TB boot drive. Physical figures are
     Supermicro's NVIDIA-endorsed AI Factory build of this RA (SYS-822GS-NB3RT:
     8U, 15 kW node maximum, four nodes per rack at 60 kW). Its DLC sibling is
     the 4U SYS-422GS-NB3RT-LCC (84.6 kg). */
  'nv-hgx-b300': {
    label: 'NVIDIA-Certified HGX B300 system', sublabel: 'NVIDIA HGX B300 8-GPU — 2-8-9-800 (HGX AI Factory)',
    pattern: '2-8-9-800', ra: 'nv-hgx-b300', system: 'Supermicro SYS-822GS-NB3RT (NVIDIA AI Factory build)',
    ru: 8, gpuKey: 'b300', gpuCount: 8, watts: 15000, weightKg: 119,
    cpu: '2x Intel Xeon 6767P 64C (RA minimum 48 cores/socket, 56 recommended)', cpuCores: 128, ramGB: 2048,
    bootGB: 1000, localTB: 2,
    eastWest: '8x ConnectX-8 SuperNIC 800G OSFP on the baseboard, each split 2 × 400G (dual-plane)',
    northSouth: 'BlueField-3 B3240 2-port 400GbE DPU — converged storage, in-band and customer',
    ewPortsPerNode: 8, ewPortGb: 800, ewLinksPerPort: 2,
    nsPortsPerNode: 2, nsPortGb: 400, ibPortsPerNode: 0, oobLinksPerNode: 6,
    liquidCapable: true, ruLiquid: 4, psuCount: 6,
    src: 'NVIDIA HGX AI Factory RA (2-8-9-800; Tables 2, 8): 8 × CX-8 800G + 1 × B3240, ≥48 cores/socket, ≥2 TB, six 1 GbE links per node. Power and weight: Supermicro AI Factory HGX B300 datasheet — SYS-822GS-NB3RT node max 15 kW, 4 nodes per rack at 60 kW; 119 kg net per the product page. RA system memory minimum (2 TB) is used; Supermicro ships the build with 24 × 64 GB',
  },
  /* HGX AI Factory (H100/H200/B200), 2-8-9-400: eight BlueField-3 B3140H
     single-port 400G SuperNICs and one BlueField-3 B3220 2 × 200G DPU. RA node
     minimum: 48 cores per socket (56 recommended), 1.5 TB of system memory,
     1 TB NVMe per socket plus a 1 TB boot drive. Physical figures for the B200
     are Supermicro's NVIDIA-endorsed AI Factory build of this RA
     (SYS-A22GA-NBRT-G1: 10U, 13.4 kW node maximum, four per rack at 53.6 kW);
     the H200 and H100 share the AS-8125GS-TNHR chassis and its BOM roll-up
     from the InferX catalog, both GPUs being 700 W parts on the same baseboard
     (NVIDIA's own DGX H200 datasheet gives 10.2 kW for the same 8+2 adapter
     count, within 2%). */
  'nv-hgx-b200': {
    label: 'NVIDIA-Certified HGX B200 system', sublabel: 'NVIDIA HGX B200 8-GPU — 2-8-9-400 (HGX AI Factory)',
    pattern: '2-8-9-400', ra: 'nv-hgx-b200', system: 'Supermicro SYS-A22GA-NBRT-G1 (NVIDIA AI Factory build)',
    ru: 10, gpuKey: 'b200', gpuCount: 8, watts: 13400, weightKg: 133,
    cpu: '2x Intel Xeon 6960P 72C (RA minimum 48 cores/socket, 56 recommended)', cpuCores: 144, ramGB: 2304,
    bootGB: 1000, localTB: 2,
    eastWest: '8x BlueField-3 B3140H single-port 400GbE SuperNIC',
    northSouth: 'BlueField-3 B3220 2-port 200GbE DPU — converged storage, in-band and customer',
    ewPortsPerNode: 8, ewPortGb: 400, ewLinksPerPort: 1,
    nsPortsPerNode: 2, nsPortGb: 200, ibPortsPerNode: 0, oobLinksPerNode: 6,
    liquidCapable: false, psuCount: 6,
    src: 'NVIDIA HGX AI Factory RA for H100/H200/B200 (2-8-9-400; Tables 2, 9): 8 × B3140H + 1 × B3220, ≥48 cores/socket, ≥1.5 TB, six 1 GbE links per node. Power and weight: Supermicro AI Factory HGX B200 datasheet — SYS-A22GA-NBRT-G1 node max 13.4 kW (47,390 BTU/h), 4 nodes per rack at 53.6 kW, 24 × 96 GB; 133 kg net per the product page',
  },
  'nv-hgx-h200': {
    label: 'NVIDIA-Certified HGX H200 system', sublabel: 'NVIDIA HGX H200 8-GPU — 2-8-9-400 (HGX AI Factory)',
    pattern: '2-8-9-400', ra: 'nv-hgx-h200', system: 'Supermicro AS-8125GS-TNHR',
    ru: 8, gpuKey: 'h200', gpuCount: 8, watts: 10040, weightKg: 110,
    cpu: '2x AMD EPYC 9554 64C (RA minimum 48 cores/socket, 56 recommended)', cpuCores: 128, ramGB: 1536,
    bootGB: 1000, localTB: 2,
    eastWest: '8x BlueField-3 B3140H single-port 400GbE SuperNIC',
    northSouth: 'BlueField-3 B3220 2-port 200GbE DPU — converged storage, in-band and customer',
    ewPortsPerNode: 8, ewPortGb: 400, ewLinksPerPort: 1,
    nsPortsPerNode: 2, nsPortGb: 200, ibPortsPerNode: 0, oobLinksPerNode: 6,
    liquidCapable: false, psuCount: 6,
    src: 'NVIDIA HGX AI Factory RA for H100/H200/B200 (2-8-9-400): 8 × B3140H + 1 × B3220, ≥1.5 TB. Power: AS-8125GS-TNHR BOM roll-up from the InferX catalog (901+720+158+7+44+6860+150+1200 W) for the same 8+1 adapter count; NVIDIA DGX H200 lists 10.2 kW. Weight 110 kg populated estimate (75.3 kg bare chassis per Supermicro)',
  },
  'nv-hgx-h100': {
    label: 'NVIDIA-Certified HGX H100 system', sublabel: 'NVIDIA HGX H100 8-GPU — 2-8-9-400 (HGX AI Factory)',
    pattern: '2-8-9-400', ra: 'nv-hgx-h100', system: 'Supermicro AS-8125GS-TNHR',
    ru: 8, gpuKey: 'h100', gpuCount: 8, watts: 10040, weightKg: 110,
    cpu: '2x AMD EPYC 9554 64C (RA minimum 48 cores/socket, 56 recommended)', cpuCores: 128, ramGB: 1536,
    bootGB: 1000, localTB: 2,
    eastWest: '8x BlueField-3 B3140H single-port 400GbE SuperNIC',
    northSouth: 'BlueField-3 B3220 2-port 200GbE DPU — converged storage, in-band and customer',
    ewPortsPerNode: 8, ewPortGb: 400, ewLinksPerPort: 1,
    nsPortsPerNode: 2, nsPortGb: 200, ibPortsPerNode: 0, oobLinksPerNode: 6,
    liquidCapable: false, psuCount: 6,
    src: 'NVIDIA HGX AI Factory RA for H100/H200/B200 (2-8-9-400): 8 × B3140H + 1 × B3220, ≥1.5 TB. Same AS-8125GS-TNHR chassis and 700 W SXM part as the H200, so the same BOM roll-up (10,040 W); NVIDIA DGX H100 lists 10.2 kW. Weight 110 kg populated estimate',
  },
  /* RTX PRO AI Factory, 2-8-5-200: eight RTX PRO 6000 Blackwell Server Edition
     GPUs, four BlueField-3 B3140H 400G SuperNICs (one per GPU pair, 200 GbE
     per GPU) and one BlueField-3 B3220 2 × 200G DPU. RA node minimum: 7 cores
     per GPU (48 per socket recommended), 128 GB per GPU (1 TB recommended),
     1 TB NVMe per socket plus boot. Physical figures are the InferX catalog's
     Supermicro AS-5126GS-TNRT2 (5U, 6,529 W with two BlueField-3 at 158 and
     150 W nameplate in that BOM); the RA's five adapters add three more at
     the BOM's 150 W, giving 6,979 W. */
  'nv-rtxpro': {
    label: 'NVIDIA-Certified RTX PRO Server', sublabel: 'NVIDIA RTX PRO 6000 Blackwell 8-GPU — 2-8-5-200 (RTX PRO AI Factory)',
    pattern: '2-8-5-200', ra: 'nv-rtxpro', system: 'Supermicro AS-5126GS-TNRT2',
    ru: 5, gpuKey: 'rtx6000b', gpuCount: 8, watts: 6979, weightKg: 45.3,
    cpu: '2x AMD EPYC 9555 64C (RA minimum 7 cores per GPU, 48/socket recommended)', cpuCores: 128, ramGB: 1024,
    bootGB: 1000, localTB: 2,
    eastWest: '4x BlueField-3 B3140H single-port 400GbE SuperNIC (200 GbE per GPU)',
    northSouth: 'BlueField-3 B3220 2-port 200GbE DPU — converged storage, in-band and customer',
    ewPortsPerNode: 4, ewPortGb: 400, ewLinksPerPort: 1,
    nsPortsPerNode: 2, nsPortGb: 200, ibPortsPerNode: 0, oobLinksPerNode: 6,
    liquidCapable: false, psuCount: 6,
    src: 'NVIDIA RTX PRO AI Factory RA (2-8-5-200; Tables 1, 8): 4 × B3140H + 1 × B3220, ≥7 cores/GPU, ≥128 GB/GPU, six 1 GbE links per node. Power: AS-5126GS-TNRT2 from the InferX BOM (6,529 W with two BlueField-3) plus three further adapters at the BOM\'s 150 W nameplate = 6,979 W; weight 45.3 kg from the same BOM (the AS-5126GS-TNRT2 datasheet gross figure, 29.7 kg net bare). Six 2700 W Titanium PSUs per that datasheet',
  },
  /* The NVIDIA L40S Enterprise RA (OVX L40S systems, four-node SU, up to 32
     nodes) has been withdrawn from NVIDIA's RA index and is superseded by the
     RTX PRO AI Factory; its baseline pattern was 2-4-3-200 with the 8-GPU
     2-8-5-200 pattern as an option. The 8-GPU pattern is used here because a
     NVIDIA-Certified OVX 3.0 build of it is published with a power figure:
     Supermicro SYS-421GE-TNRT (4U, 8 × L40S, 2 × Xeon 8480+, 1 TB, 4 × BF-3
     400G SuperNIC + 1 × BF-3 2 × 200G DPU, 3,850 W estimated peak). */
  'nv-ovx-l40s': {
    label: 'NVIDIA-Certified OVX L40S system', sublabel: 'NVIDIA L40S 8-GPU — 2-8-5-200 (L40S Enterprise RA, superseded)',
    pattern: '2-8-5-200', ra: 'nv-l40s', system: 'Supermicro SYS-421GE-TNRT (OVX 3.0)',
    ru: 4, gpuKey: 'l40s', gpuCount: 8, watts: 3850, weightKg: 45.3,
    cpu: '2x Intel Xeon Platinum 8480+ 56C', cpuCores: 112, ramGB: 1024,
    bootGB: 1920, localTB: 7.6,
    eastWest: '4x BlueField-3 B3140H single-port 400GbE SuperNIC (200 GbE per GPU)',
    northSouth: 'BlueField-3 B3220 2-port 200GbE DPU — converged storage, in-band and customer',
    ewPortsPerNode: 4, ewPortGb: 400, ewLinksPerPort: 1,
    nsPortsPerNode: 2, nsPortGb: 200, ibPortsPerNode: 0, oobLinksPerNode: 6,
    liquidCapable: false, psuCount: 4,
    src: 'NVIDIA L40S Enterprise RA (OVX L40S, 4-node SU, up to 32 nodes; 2-4-3-200 baseline, 2-8-5-200 optional). Supermicro OVX 3.0 solution brief: SYS-421GE-TNRT 4U, 8 × L40S, 2 × Xeon 8480+, 1 TB, 4 × BF-3 400G + 1 × BF-3 2 × 200G, 7.6 TB NVMe + 1.92 TB boot, 3,850 W estimated peak; 45.3 kg gross per the product page (29.7 kg net bare), 4 x 2700 W Titanium PSUs',
  },
};

/* ---------- platform, storage and fabric infrastructure ---------- */
/* AS-1125HS-TNR confirmed against its datasheet: 1U Hyper, dual AMD EPYC
   9004/9005, 8 hot-swap 2.5" NVMe bays as standard and 12 as an option (the
   12-bay face with 8 populated is what the elevation draws), 2 x 1200 W
   Titanium PSUs, 14.5 kg net bare. The per-role watts and the 23.1 kg are the
   RA BOM's populated figures. */
/* `nsPorts` is the device's north-south fabric ports. The management stack is
   not a set of management-only boxes: the RA BOM puts an NVIDIA BlueField-3
   B3240 dual-port 400GbE DPU (900-9D3B6-00CN-AB0) in every platform server,
   platform router and CPU compute node, and a single-port B3140H
   (900-9D3D4-00EN-HA0) in the Tier 2 storage chassis. Those land on the
   north-south fabric alongside the GPU nodes and the WEKApods, and are counted
   in the leaf budget and the cable schedule. The Tier 3 NAS, the firewalls and
   the serial switch carry no DPU — their uplinks are the out-of-band fabric
   and the 10GbE firewall pair, which the RA cables separately. */
const INFRA = {
  'platform-server': { label: 'Platform Server', model: 'AS-1125HS-TNR', ru: 1, watts: 1070, weightKg: 23.1, c13: 2, nsPorts: 2, nsPortGb: 400, dpu: 'BlueField-3 B3240 2-port 400GbE' },
  'platform-router': { label: 'Platform Router', model: 'AS-1125HS-TNR', ru: 1, watts: 1013, weightKg: 23.1, c13: 2, nsPorts: 2, nsPortGb: 400, dpu: 'BlueField-3 B3240 2-port 400GbE' },
  'cpu-node': { label: 'CPU Compute Node', model: 'AS-1125HS-TNR', ru: 1, watts: 1070, weightKg: 23.1, c13: 2, nsPorts: 2, nsPortGb: 400, dpu: 'BlueField-3 B3240 2-port 400GbE' },
  // SSG-641E-E1CR36L confirmed against its datasheet: 4U front/rear-loading
  // storage server, 24 front plus 12 rear 3.5" hot-swap bays (the 36 the
  // elevation draws), dual Xeon, 2 x 1600 W PSUs, 29.7 kg net bare. The
  // 1,188 W and 98 kg are the RA BOM's populated figures.
  'tier2': { label: 'Tier 2 Block Storage', model: 'SSG-641E-E1CR36L', ru: 4, watts: 1188, weightKg: 98, c19: 2, nsPorts: 1, nsPortGb: 400, dpu: 'BlueField-3 B3140H 1-port 400GbE' },
  // The RA BOM's Tier 3 NAS: a Synology RS822RP+ with 4 x 6 TB WD Red Pro. Its
  // Ryzen is soldered and its memory and bays are the appliance's own, so the
  // platform step shows it read-only.
  'tier3': { label: 'Tier 3 Storage', model: 'Synology RS822RP+', ru: 2, watts: 150, weightKg: 10.88, c13: 2,
    cpu: 'AMD Ryzen V1500B 4C/8T', cpuCores: 4, ramGB: 2, localTB: 24 },
  // Placeholder kept so existing power roll-ups resolve; the real catalogue is
  // WEKAPODS below, which carries per-model capacity and performance.
  'wekapod': {
    label: 'WEKApod node', model: 'WEKApod', ru: 1, watts: 800, weightKg: 9.25, c13: 2,
    nodesPerChassis: 1, chassisRu: 1, readGBs: 70, writeGBs: 40, perApplianceNodes: 8,
    src: 'WEKA WPS155-SAE: 8 nodes in 8RU, ~6.4 kW, ~74 kg',
  },
  'oob-fw': { label: 'OOB Firewall', model: 'Juniper SRX1500', ru: 1, watts: 150, weightKg: 7.3, c13: 2 },
  // Control-plane node of the NVIDIA reference architectures. The Enterprise
  // RAs specify it (Table 3: 2 × 32C Xeon Gold 6448Y or EPYC 9354, 256 GB,
  // 1 TB boot, 4 TB NVMe, one BlueField-3 B3220) but publish no power or
  // weight, so the InferX BOM's 1U two-socket Hyper stands in for those.
  'cp-node': {
    label: 'Control-plane node', model: '2S x86 1U (RA Table 3)', ru: 1, watts: 1070, weightKg: 23.1, c13: 2,
    nsPorts: 2, nsPortGb: 200, dpu: 'BlueField-3 B3220 2-port 200GbE',
    src: 'NVIDIA Enterprise RA control-plane node: 2 × 32C, 256 GB, 1 TB boot + 4 TB NVMe, B3220 2 × 200G; power and weight from the InferX BOM\'s AS-1125HS-TNR as a representative 1U two-socket server',
  },
  'serial': { label: 'Serial Switch', model: 'Perle IOLAN SCS48C', ru: 1, watts: 23, weightKg: 3.6, c13: 1 },
  'cdu': { label: 'Supermicro CDU 250 kW', model: 'CDU-250', ru: 4, watts: 3000, weightKg: 114, c19: 2 },
  // Coolant distribution for the GB300 NVL72 track, from the Supermicro DCBBS
  // datasheets. The in-rack unit is the same 4U LCS-SCDU-250LP4002 as above
  // (OCP/MGX rack variant: 3 kW, 114 kg). The in-row and sidecar units are
  // floor-standing cabinets, so they take a rack position rather than rack
  // units; `floorMM` is their footprint.
  'cdu-inrow': {
    label: 'Supermicro in-row CDU 1.8 MW', model: 'LCS-SCDU-1K3LR001', ru: 0, watts: 20000, weightKg: 1560,
    capacityKw: 1800, racksPerUnit: 8, floorMM: '1000 × 1300 × 2000 mm',
    src: 'Supermicro In-Row CDU datasheet: up to 1.8 MW, N+1 pumps, 20 kW, 1,000 × 1,300 × 2,000 mm, 1,560 kg dry; GB300 NVL72 datasheet: supports up to 8 racks',
  },
  'cdu-sidecar': {
    label: 'Supermicro L2A sidecar CDU 200 kW', model: 'LCS-SCDU-200AR001', ru: 0, watts: 19000, weightKg: 1145,
    capacityKw: 200, racksPerUnit: 1, floorMM: '1100 × 1415 × 2000 mm',
    src: 'Supermicro L2A Sidecar CDU datasheet: 200 kW liquid-to-air, N+1 pumps, 19 kW, 1,100 × 1,415 × 2,000 mm, 1,145 kg dry; no facility water',
  },
  'patch': { label: 'Patch Panel', ru: 1, watts: 0, weightKg: 5, oobPorts: 0 },
  // Drawn in the RA elevation beside the patch panel. Like the patch panel it
  // carries no separate figure: whatever it draws is inside the rack's
  // published 7,826 W and 187.18 kg, which are elevation totals rather than a
  // sum of these records.
  'converter': { label: 'Media Converter', ru: 1, watts: 0, weightKg: 3, oobPorts: 0 },
  'breakglass': { label: 'OOB Break-Glass', model: 'RevPi Connect 5 + SITOP', ru: 3, watts: 30, weightKg: 6 },
};

/* Fabric switches. Oversubscription follows the RA: north-south 4:1,
   east-west 1:1 non-blocking.

   Power is the figure that matches how this tool cables the fabric. NVIDIA
   publishes switch power two ways — "typical with passive cables (ATIS)" and,
   where it gives one, a populated-with-optics figure — and the difference is
   large because an 800G transceiver burns ~18 W. Every data-plane cage in
   these designs carries a transceiver (the optics BOM orders them), so the
   data-plane switches take the populated figure and the passive one is kept
   in `wattsPassive` for reference. The out-of-band SN2201 is RJ45 copper, so
   its passive figure is the real one. Transceiver power is therefore counted
   once, inside the switch, and never added again from the optics BOM. */
const FABRIC = {
  'sn5610': {
    label: 'NVIDIA SN5610', desc: 'Spectrum-4 800GbE, 64x OSFP', ru: 2, ports: 64, portGb: 800,
    watts: 2080, wattsPassive: 900, weightKg: 26.9, c13: 2,
    src: 'NVIDIA SN5000 hardware manual, SN5610: 2U, 64 x OSFP 800G plus 2 x SFP28, typical 900 W with passive cables and 2.08 kW with 64 optical modules, 26.9 kg. (The SN5600 in the same manual is 940 W and 23.5 kg; the RAs treat the two as interchangeable.)',
  },
  'sn4700': {
    label: 'NVIDIA SN4700', desc: 'Spectrum-3 400GbE, 32x QSFP-DD', ru: 1, ports: 32, portGb: 400,
    watts: 630, wattsPassive: 630, weightKg: 11.6, c13: 2,
    src: 'NVIDIA SN4000 hardware manual, SN4700: 1U, 32 x QSFP-DD 400GbE, typical 630 W with passive cables, 11.6 kg. No optically populated figure is published. Carried for reference; no profile selects it',
  },
  'sn4600c': {
    label: 'NVIDIA SN4600C', desc: 'Spectrum-3 100GbE, 64x QSFP28', ru: 2, ports: 64, portGb: 100,
    watts: 466, wattsPassive: 466, weightKg: 14.64, c13: 2,
    src: 'NVIDIA SN4000 hardware manual, SN4600C: 2U, 64 x QSFP28 100GbE, typical 466 W with passive cables, 14.64 kg. No optically populated figure is published, so the out-of-band spine is costed at the passive typical',
  },
  'sn2201': {
    label: 'NVIDIA SN2201', desc: '1GbE 48x RJ45 + 4x QSFP28', ru: 1, ports: 48, portGb: 1,
    watts: 98, wattsPassive: 98, weightKg: 7.41, c13: 2,
    src: 'NVIDIA SN2201 specification: 1U, 48 x 1GbE RJ45 plus 4 x QSFP28 100GbE, 98 W, 7.4 kg. Copper ports, so the published figure is the populated one',
  },

  // InfiniBand alternatives for the data-plane fabrics. Quantum-2 carries 32
  // OSFP cages against the SN5610's 64, and each cage splits the same 2x400G
  // way, so an InfiniBand fabric needs roughly twice the switches for the same
  // node count. That is a real difference in radix, not a modelling artefact.
  'qm9700': {
    label: 'NVIDIA QM9700', desc: 'Quantum-2 NDR 400G InfiniBand, 32x OSFP (64 x 400G)', ru: 1, ports: 32, portGb: 400,
    watts: 1720, wattsPassive: 747, weightKg: 14.8, c13: 2,
    src: 'NVIDIA QM97x0 hardware manual, QM9700: 1U, 32 OSFP cages carrying 64 x NDR 400G, typical 747 W with passive cables and 1,720 W maximum with active cables, 14.8 kg with two PSUs. The active-cable maximum is the populated figure used here; NVIDIA publishes no optical typical for this part',
  },
};

/* Which switch each transport puts on the data plane. Out-of-band is 1GbE
   copper in every reference design, so it has no InfiniBand variant. */
const FABRIC_TRANSPORTS = {
  ethernet: { label: 'Ethernet', short: 'ETH', switchKey: 'sn5610' },
  infiniband: { label: 'InfiniBand', short: 'IB', switchKey: 'qm9700' },
};

const FABRIC_RULES = {
  // Both planes default to non-blocking. The reference architecture runs
  // north-south at 4:1; 1:1 is the safer starting point and the option below
  // marks which is which.
  northSouthOversub: 1,
  eastWestOversub: 1,
  eastWestTech: 'ethernet',
  northSouthTech: 'ethernet',
  oobLeafPorts: 48,
  // The RA specifies MMS4X00-NS twin-port transceivers: one 800G OSFP cage
  // carries 2x400G links, so a 64-cage SN5610 presents 128 logical 400G ports.
  breakout: 2,
};

/* ---------- WEKApod appliance catalogue ----------
   From WEKA's own NeuralMesh / WEKApod material. The Nitro is a 1U server, so
   eight of them occupy 8 rack units — the deck states "Total Nodes 8 / Rack
   Units 8" outright. Per-node power (800 W) agrees with the InferX sheet; the
   weight does not, and WEKA's ~74 kg for eight nodes is used instead of the
   sheet's 31.2 kg each.

   Networking is two dual-port ConnectX-7 cards per node, not one: a single
   card is a single point of failure for a storage node that every GPU in the
   fleet reads from, so the pair gives card-level redundancy and four 400G
   links into the north-south fabric. Note that the two ports on one card
   share a PCIe Gen5 x16 uplink, so the fourth link buys resilience and path
   diversity rather than four times the throughput — the per-node figures
   below are WEKA's own and are unchanged by it. Each node also lands two
   1GbE management ports on the out-of-band fabric (`mgmtPorts`).

   Prime models carry two capacity tiers: a small TLC write/metadata tier plus a
   large eTLC or QLC capacity tier. Usable capacity is sized on the capacity
   tier, which is what the family table quotes. */
const WEKAPODS = {
  'nitro-155': {
    family: 'Nitro', model: 'WPS155-SAE', label: 'WEKApod Nitro — 14 × 7.68 TB TLC',
    ru: 1, drives: 14, driveTB: 7.68, driveType: 'E3.S TLC Gen5', driveGBs: 14, cores: 64,
    cpu: 'AMD EPYC 9534 64C/128T', ramGB: 768, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 dual-port 400Gb OSFP', ports: 4, portGb: 400, mgmt: '2 × 1GbE', mgmtPorts: 2,
    readGBs: 71, writeGBs: 32, readIops: 2.25e6, writeIops: 0.5875e6,
    watts: 800, weightKg: 9.25, minNodes: 8,
    ref: { nodes: 8, netTB: 484, readGBs: 568, writeGBs: 256, readIops: 18e6, writeIops: 4.7e6, ru: 8, kw: 6.4, kg: 74 },
    src: 'WEKA WPS155-SAE: 8 nodes = 484 TB usable at 5D+2P+1VHS, 568/256 GB/s, 18M/4.7M IOPS, 8RU, ~74 kg, ~6.4 kW',
  },
  'nitro-175': {
    family: 'Nitro', model: 'WPS175-SAE', label: 'WEKApod Nitro — 14 × 15.36 TB TLC',
    ru: 1, drives: 14, driveTB: 15.36, driveType: 'E3.S TLC Gen5', driveGBs: 14, cores: 64,
    cpu: 'AMD EPYC 9534 64C/128T', ramGB: 768, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 dual-port 400Gb OSFP', ports: 4, portGb: 400, mgmt: '2 × 1GbE', mgmtPorts: 2,
    readGBs: 71, writeGBs: 32, readIops: 2.25e6, writeIops: 0.5875e6,
    watts: 800, weightKg: 9.25, minNodes: 8,
    ref: { nodes: 8, netTB: 968, readGBs: 568, writeGBs: 256, readIops: 18e6, writeIops: 4.7e6, ru: 8, kw: 6.4, kg: 74 },
    src: 'WEKA WPS175-SAE: 8 nodes = 968 TB usable at 5D+2P+1VHS',
  },
  'nitro-30': {
    family: 'Nitro', model: 'WEKApod Nitro 30TB', label: 'WEKApod Nitro — 14 × 30 TB TLC',
    ru: 1, drives: 14, driveTB: 30, driveType: 'E3.S TLC Gen5', driveGBs: 14, cores: 64,
    cpu: 'AMD EPYC 9534 64C/128T', ramGB: 768, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 dual-port 400Gb OSFP', ports: 4, portGb: 400, mgmt: '2 × 1GbE', mgmtPorts: 2,
    readGBs: 71, writeGBs: 32, readIops: 2.25e6, writeIops: 0.5875e6,
    watts: 850, weightKg: 9.25, minNodes: 8,
    src: 'WEKA Nitro family table: 14 × 7.68 TB–30 TB E3.S TLC. The per-node throughput is the WPS155/WPS175 appliance result (568/256 GB/s across 8 nodes) rather than the family table\'s rounded 70/40, so that all three Nitro capacities are read off one source — the node hardware is the same and only the drive capacity differs',
  },
  'prime-2118-30': {
    family: 'Prime', model: 'Prime 2118', label: 'WEKApod Prime 2118 — 18 × 30 TB eTLC',
    ru: 1, drives: 18, driveTB: 30, driveType: 'E3.S eTLC', driveGBs: 12, cores: 128, writeTier: '2 × 6.4 TB E3.S TLC',
    cpu: '2 × Intel Sierra Forest 64C', ramGB: 1024, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 dual-port 400Gb OSFP', ports: 4, portGb: 400, mgmt: '2 × 1GbE', mgmtPorts: 2,
    readGBs: 40, writeGBs: 20, readIops: 1.3e6, writeIops: 0.35e6,
    watts: 900, weightKg: 12, minNodes: 8,
    src: 'WEKA Prime 2118 family table; performance includes data reduction',
  },
  'prime-2118-60': {
    family: 'Prime', model: 'Prime 2118', label: 'WEKApod Prime 2118 — 18 × 60 TB eTLC',
    ru: 1, drives: 18, driveTB: 60, driveType: 'E3.S eTLC', driveGBs: 12, cores: 128, writeTier: '2 × 6.4 TB E3.S TLC',
    cpu: '2 × Intel Sierra Forest 64C', ramGB: 1024, bootDesc: '2 × 960 GB BOSS',
    net: '2 × NVIDIA CX-7 dual-port 400Gb OSFP', ports: 4, portGb: 400, mgmt: '2 × 1GbE', mgmtPorts: 2,
    readGBs: 40, writeGBs: 20, readIops: 1.3e6, writeIops: 0.35e6,
    watts: 950, weightKg: 12, minNodes: 8,
    src: 'WEKA Prime 2118 family table',
  },
  'prime-2218-60': {
    family: 'Prime', model: 'Prime 2218', label: 'WEKApod Prime 2218 — 18 × 60 TB QLC',
    ru: 2, drives: 18, driveTB: 60, driveType: 'U.2 QLC', driveGBs: 7, cores: 128, writeTier: '2 × 6.4 TB U.2 TLC',
    cpu: '2 × Intel Sierra Forest 64C', ramGB: 1024, bootDesc: '2 × 1.92 TB M.2',
    net: '2 × NVIDIA CX-7 dual-port 400Gb OSFP', ports: 4, portGb: 400, mgmt: '2 × 1GbE', mgmtPorts: 2,
    readGBs: 40, writeGBs: 20, readIops: 1.3e6, writeIops: 0.35e6,
    watts: 950, weightKg: 20, minNodes: 8,
    src: 'WEKA Prime 2218/2222 family table; 2U chassis with U.2 QLC capacity tier',
  },
  'prime-2218-120': {
    family: 'Prime', model: 'Prime 2218', label: 'WEKApod Prime 2218 — 18 × 120 TB QLC',
    ru: 2, drives: 18, driveTB: 120, driveType: 'U.2 QLC', driveGBs: 7, cores: 128, writeTier: '2 × 6.4 TB U.2 TLC',
    cpu: '2 × Intel Sierra Forest 64C', ramGB: 1024, bootDesc: '2 × 1.92 TB M.2',
    net: '2 × NVIDIA CX-7 dual-port 400Gb OSFP', ports: 4, portGb: 400, mgmt: '2 × 1GbE', mgmtPorts: 2,
    readGBs: 40, writeGBs: 20, readIops: 1.3e6, writeIops: 0.35e6,
    watts: 1000, weightKg: 20, minNodes: 8,
    src: 'WEKA Prime 2218/2222 family table — 55 PB in a 42U rack at this density',
  },
};

/* WEKA sizes the WEKApod at 5D+2P with one virtual hot spare, and both published
   worked examples (484 TB and 968 TB) fall straight out of the tool's existing
   net-capacity formula at that setting. */
const WEKAPOD_DEFAULTS = { schemeId: '5+2', hotSpares: 1, minNodes: 8 };

/* ---------- optics and cabling ----------
   Part numbers and per-link ratios from NVIDIA RA-11337-001 Table 9.1. That
   table sizes a 4 SU / 256-node SuperPOD with 2,048 compute ports, and the
   quantities imply these ratios per node port:

     1 x node-side transceiver, 1 x switch-side twin-port transceiver,
     2 x node-leaf fibre, 2 x leaf-spine twin-port, 2 x leaf-spine fibre

   The doubling on cables is because a twin-port OSFP cage carries two links.
   Ethernet (F4) variants are used throughout since this tool builds a
   Spectrum fabric; the InfiniBand equivalents are noted per record. */
const OPTICS = {
  'osfp-800-node': { label: 'OSFP single-port flat-top transceiver, 800G', pn: '980-9I51A-00NS00', role: 'Node side, compute fabric' },
  // The switch-side twin-port OSFP is an 800G part, not 1.6T: NVIDIA's
  // MMS4X00-NS / MMA4Z00-NS-T family carries 2 x 400G over two MPO-12/APC
  // connectors in one cage, which is exactly the 2 x 400G breakout the fabric
  // rules assume. 1.6T optics are not shipping, so nothing here quotes one.
  'osfp-twin-800': { label: 'OSFP twin-port finned transceiver, 800G (2 × 400G)', pn: '980-9I510-F4NS00', role: 'Switch side, Ethernet' },
  'qsfp-400': { label: 'QSFP single-port flat-top transceiver, 400G', pn: '980-9I693-F4NS00', role: 'BlueField-3 and storage, Ethernet' },
  // The RA lists the same optics in InfiniBand trim under a different suffix,
  // so the transport choice changes the part number, not the quantity.
  'osfp-twin-800-ib': { label: 'OSFP twin-port finned transceiver, 800G (2 × 400G, InfiniBand)', pn: '980-9I510-00NS00', role: 'Switch side, InfiniBand' },
  'qsfp-400-ib': { label: 'QSFP single-port flat-top transceiver, 400G (InfiniBand)', pn: '980-9I693-00NS00', role: 'BlueField-3 and storage, InfiniBand' },
  'qsfp-400-cp': { label: 'QSFP transceiver 400G, control plane', pn: '980-9I51S-F4NS00', role: 'Management and control-plane nodes' },
  'osfp-800-uplink': { label: 'OSFP transceiver, 800G', pn: '980-9I30H-F4NM00', role: 'Inband spine to OOB leaf, NFS and uplink' },
  'dr1-100': { label: '100G DR1 transceiver', pn: '980-9I042-00C000', role: 'OOB uplink and user storage' },
  'splitter-dr4': { label: 'DR4 to 4x DR1 fabric splitter', pn: 'NV08M31P2X1BHM020', role: 'Leaf to NFS, SN2201 and uplink' },
  'fibre-mmf': { label: 'MMF passive fibre cable', pn: '980-9I570-00N030', role: 'Node-leaf and leaf-spine' },
  'fibre-mgmt': { label: 'MMF passive fibre cable, management', pn: '980-9I557-00N030', role: 'Storage and management to leaf' },
  'cat6': { label: 'Cat6 copper patch lead', pn: 'Cat6', role: 'Out-of-band 1GbE' },

  /* ---------- InferX reference-architecture optics ----------
     The InferX BOM specifies its own parts, which are not the ones NVIDIA's
     DGX SuperPOD RA lists, so the two stacks order different line items for
     the same job. These are the InferX sheet's own numbers. Note the server
     side differs by fabric and by node: a B300's east-west port takes the
     OSFP MMS4X00-NS400, an H200's the QSFP112 MMS1X00-NS400, and every
     switch-side cage in every fabric takes the twin-port MMS4X00-NS. */
  'mms4x00-ns400': { label: 'MMS4X00-NS400 single-port transceiver, 400G OSFP', pn: 'MMS4X00-NS400', role: 'Server side, OSFP 400G', src: 'NVIDIA single port transceiver, 400Gbps, OSFP, MPO12 APC, 1310nm SMF, up to 100m, flat top' },
  'mms1x00-ns400': { label: 'MMS1X00-NS400 single-port transceiver, 400G NDR QSFP112', pn: '980-9I068-00NM00', role: 'Server side, QSFP112 400G', src: 'NVIDIA single port transceiver, 400Gbps, NDR, QSFP112, MPO, 1310nm SMF, up to 100m, flat top' },
  'mms4x00-ns': { label: 'MMS4X00-NS twin-port transceiver, 800G (2 × 400G) OSFP finned', pn: '980-9I30H-00NM00', role: 'Switch side, every fabric', src: 'NVIDIA twin port transceiver, 800Gbps, 2x400G, OSFP, 2xMPO/APC, 1310nm SMF, up to 100m, finned top' },
  'mfa1a00-c005': { label: 'MFA1A00-C005 active fibre cable, 100GbE QSFP, 5 m', pn: '980-9I13X-00C005', role: 'Out-of-band leaf to spine', src: 'NVIDIA active fiber cable, ETH 100GbE, 100Gb/s, QSFP, LSZH, 5m' },
  'mfp7e30-n015': { label: 'MFP7E30-N015 passive fibre, MPO12 APC, 15 m', pn: '980-9I57Y-000015', role: 'Server to leaf', src: 'NVIDIA passive fiber cable, SMF, MPO12 APC to MPO12 APC, 15m' },
  'mfp7e30-n003': { label: 'MFP7E30-N003 passive fibre, MPO12 APC, 3 m', pn: '980-9I73U-000003', role: 'Leaf to spine and leaf MLAG', src: 'NVIDIA passive fiber cable, SMF, MPO12 APC to MPO12 APC, 3m' },
  'sfp-10glr': { label: 'SFP+ 10GBASE-LR transceiver, 1310 nm 10 km', pn: 'SFP-10GLR-31 / EX-SFP-10GE-LR', role: 'OOB firewall HA and uplink, transit router', src: 'Juniper EX-SFP-10GE-LR compatible SFP+ 10GBASE-LR, duplex LC/UPC SMF' },
  'cat6a': { label: 'Cat6A SFTP patch lead, snagless', pn: 'Cat6A', role: 'Out-of-band 1GbE', src: 'Colour-coded SFTP CAT6A patch cables, 0.5–15 m, per the RA cable schedule' },
};

/* Which transceiver and cable part each stack orders for a given job. The
   InferX designs quote the InferX BOM; the NVIDIA profiles quote the part
   numbers in NVIDIA's own reference-architecture tables. */
const OPTIC_SETS = {
  inferx: {
    ewNode800: 'mms4x00-ns400', ewNode400: 'mms1x00-ns400',
    nsNode: 'mms1x00-ns400', cpNode: 'mms1x00-ns400', twin: 'mms4x00-ns',
    nodeFibre: 'mfp7e30-n015', spineFibre: 'mfp7e30-n003', mgmtFibre: 'mfp7e30-n015',
    oobUplink: 'mfa1a00-c005', edge: 'sfp-10glr', copper: 'cat6a',
  },
  nvidia: {
    ewNode800: 'osfp-800-node', ewNode400: 'qsfp-400',
    nsNode: 'qsfp-400', cpNode: 'qsfp-400-cp', twin: 'osfp-twin-800',
    nodeFibre: 'fibre-mmf', spineFibre: 'fibre-mmf', mgmtFibre: 'fibre-mgmt',
    oobUplink: 'dr1-100', edge: 'dr1-100', copper: 'cat6',
  },
};

/* Links per node port, per Table 9.1. */
const CABLE_RATIOS = {
  nodeTransceiverPerPort: 1,
  leafTransceiverPerPort: 1,
  nodeLeafCablePerPort: 2,
  spineTransceiverPerPort: 2,
  spineCablePerPort: 2,
  // Figure 4.9: three OOB links per DGX — one BMC plus two BlueField-3.
  oobLinksPerNode: 3,
};

/* ---------- rack and facility rules ---------- */
/* The elevations put exactly 2 GPU nodes in every air-cooled compute rack
   regardless of node size (16 GPUs per rack), and 8 in a liquid-cooled rack
   alongside a 250 kW CDU. Those are the design's own numbers, not a derived
   power fit — an air-cooled B300 rack lands at 29 kW against a 415 V/60 A 3-phase
   feed that could carry more, so the limit is fabric and thermal design rather
   than the PDU. */
const RACK = {
  totalU: 48,
  // Tier 2 block storage is a fixed three units across the whole design, sitting
  // at the base of the first three compute racks. Both the edge and the 2 MW
  // reference designs list exactly three regardless of rack count, which is why
  // their MEP sheet quotes two compute-rack totals: 28,986 W for the racks that
  // carry one and 27,798 W for the rest.
  tier2Units: 3,
  widthMM: 800,
  depthMM: 1470,
  feed: '415V/60A 3Ph',
  // `sets` names the profiles each option belongs to: the InferX designs
  // ('inferx'), the NVIDIA chassis-based RAs ('nvidia') and the rack-scale
  // NVL72 ('rackscale'). A cooling select only offers its profile's set.
  cooling: {
    air: { label: 'Air cooled', gpuNodesPerRack: 2, cdu: false, sets: ['inferx'] },
    // NVIDIA's Enterprise RAs leave nodes per rack to the available rack
    // power. Supermicro's NVIDIA-endorsed AI Factory builds of those RAs put
    // one four-node scalable unit in each rack (HGX B300 at 60 kW, HGX B200
    // at 53.6 kW), and the DGX SuperPOD RA racks four DGX B300 the same way,
    // so that is the air-cooled rule on every NVIDIA profile.
    air4: { label: 'Air cooled — 4 nodes per rack (one scalable unit)', short: 'Air, 4 per rack', gpuNodesPerRack: 4, cdu: false, sets: ['nvidia'] },
    liquid: { label: 'Direct liquid cooled (DLC)', gpuNodesPerRack: 8, cdu: true, sets: ['inferx', 'nvidia'] },
    // GB300 NVL72 is liquid-cooled only; what varies is where the heat goes.
    // These entries apply to rack-scale systems alone (`rackScale`), one
    // system per rack, and name the CDU record that serves it. In-rack puts a
    // 4U CDU in the rack's spare units; in-row and sidecar are cabinets on the
    // floor — one in-row unit per eight racks, one sidecar beside every rack.
    inrow: { label: 'DLC — in-row CDU (1.8 MW, up to 8 racks)', short: 'DLC, in-row CDU', gpuNodesPerRack: 1, cdu: true, rackScale: true, cduKey: 'cdu-inrow', inRack: false, sets: ['rackscale'] },
    inrack: { label: 'DLC — in-rack CDU (250 kW)', short: 'DLC, in-rack CDU', gpuNodesPerRack: 1, cdu: true, rackScale: true, cduKey: 'cdu', inRack: true, sets: ['rackscale'] },
    sidecar: { label: 'DLC — liquid-to-air sidecar (200 kW, no facility water)', short: 'DLC, L2A sidecar', gpuNodesPerRack: 1, cdu: true, rackScale: true, cduKey: 'cdu-sidecar', inRack: false, sets: ['rackscale'] },
  },
  // Management rack composition is fixed across all three reference designs.
  /* Units kept clear at the top of every fabric rack for patch panels and
     cable management. Named here because the facility roll-up and the rack
     drawing both have to honour it: the roll-up reserved it and the drawing
     did not, so a design with 415U of switches was costed at ten fabric racks
     and drawn in nine. */
  fabricReserveU: 2,

  /* The InferX management rack's own share of the fabric. Its elevation shows
     an out-of-band leaf pair at U23–U24, and the edge design — which has no
     fabric rack — stacks its data-plane leaves in the units between the OOB
     pair and the CPU nodes. Both are named here because the facility roll-up
     and the drawing both have to honour them: the roll-up counted the OOB pair
     again in the fabric rack, so a core design was costed for two switches it
     already had, and the edge design drew leaves past the bottom of the rack
     rather than opening a rack for them. */
  mgmtOobLeaves: 2,

  /* Units kept clear at the top of a storage rack, for the same reason as
     `fabricReserveU`: patch panels and cable management for a rack of
     400G-attached nodes. The roll-up reserved it and the drawing did not, so a
     41-node cluster was costed at two racks and drawn in one. */
  storageReserveU: 8,

  mgmtRack: {
    label: 'Management Rack', watts: 7826, weightKg: 187.18, c13: 23,
    // Every device the elevation draws, in rack order. The media converter and
    // the serial switch used to be missing, so the bill of materials reported
    // a twelve-device rack against a drawing that showed fourteen. Neither
    // carries a role, so completing the list moves no figure.
    contents: ['patch', 'converter', 'breakglass', 'serial', 'oob-fw', 'oob-fw',
      'platform-router', 'platform-router', 'platform-server', 'platform-server', 'platform-server',
      'tier3', 'cpu-node', 'cpu-node'],
    /* The CPU compute nodes are the InferX designs' own control plane, and
       how many a site runs is a sizing decision rather than a fixture. The RA
       elevation's two are the starting point and the figure its published
       7,826 W stands for; anything above that adds its own configured draw.
       `cpuNodeCeilingU` is the highest unit they may grow into — the
       out-of-band leaf pair sits at U23–U24 — and Tier 2 and any in-rack
       leaves stack above whatever the nodes occupy. */
    cpuNodes: 2, cpuNodeCeilingU: 22,
  },
};

/* ---------- deployment profiles ----------
   Two stacks share the "federation tier" select. The InferX tiers are Radian
   Arc's own reference designs — Supermicro chassis, the fixed management
   rack, three Tier 2 block-storage units, two nodes per air-cooled rack. The
   NVIDIA profiles follow NVIDIA's published reference architectures instead:
   the Enterprise RA "AI Factory" documents for HGX B300, HGX H100/H200/B200
   and RTX PRO, the withdrawn L40S Enterprise RA, the NVL72 AI Factory RA and
   the DGX SuperPOD RA. Each carries the RA's node pattern, scalable unit,
   tested range, fabric rules, converged-fabric port allocations and control
   plane, and `nodes` lists what the node select offers under it. The GB300
   NVL72 is reachable only through NVIDIA's NVL72 AI Factory RA, since InferX
   publishes no design of its own for it.

   Fabric rules (`fabric.rule`), all on Spectrum-X Ethernet, non-blocking:

   - 'enterprise' — the HGX, RTX PRO and L40S Enterprise RAs. East-west is a
     rail-optimised leaf–spine with 64-port switches treated as 128 × 400G;
     a ConnectX-8 800G port contributes two links (dual plane), a B3140H one.
     The converged north-south fabric carries the nodes' BlueField-3 pair
     plus the RA's own allocations for storage, customer uplinks, support
     servers and the SN2201 uplinks (Table 7/8 of each RA, in 800G cages),
     collapses to a two-leaf pair with an inter-switch link when those fit,
     and at 16 nodes or fewer is folded into the compute leaves altogether.
     SN2201 uplinks land on the converged fabric, so there is no OOB spine.
   - 'nvl72' — the NVL72 AI Factory RA: four leaves per plane per pair of
     racks, each leaf wired to one GPU position in every tray and deliberately
     underpopulated (36 downlinks of 128), spines per plane rounded up to an
     even count; the SN2201 pair lives in the rack.
   - 'superpod' — the DGX SuperPOD RA: dual-plane compute fabric sized for
     the whole 64-node scalable unit, a storage fabric with DGX-side leaves at
     roughly 4:3 and storage-side leaves at 1:1, and an in-band fabric of its
     own, reported together on the north-south plane.

   `converged(nodes, racks)` returns the RA's port allocations in 800G cages.
   `verified` holds the switch counts the RA publishes at its design points;
   the engine reproduces every one of them (.github/scripts/verify-nvidia-ra.js). */
const RA_PROFILES = {
  edge: {
    group: 'inferx', stack: 'inferx', label: 'Edge — local inference POP',
    desc: 'InferX reference design. One or more GPU nodes with local platform services. No dedicated switch-fabric rack; leaves live in the management rack.',
    minGpuNodes: 1, dedicatedFabricRack: false, storage: 'tier2', coolingSet: 'inferx',
    nodes: ['smc-rtx6000', 'smc-b300', 'dgx-b300', 'smc-h200', 'smc-l40s'], defaultNode: 'smc-rtx6000',
  },
  regional: {
    group: 'inferx', stack: 'inferx', label: 'Regional — GPUaaS POP',
    desc: 'InferX reference design. Eight or more GPU nodes with a dedicated switch-fabric rack and a WEKApod POSIX/S3 storage rack.',
    minGpuNodes: 8, dedicatedFabricRack: true, storage: 'wekapod', coolingSet: 'inferx',
    nodes: ['smc-b300', 'dgx-b300', 'smc-rtx6000', 'smc-h200', 'smc-l40s'], defaultNode: 'smc-b300',
  },
  core: {
    group: 'inferx', stack: 'inferx', label: 'Core — AI factory',
    desc: 'InferX reference design. 256 to 2048+ GPUs. Multiple switch-fabric racks, WEKApod storage, and DLC where rack density demands it.',
    minGpuNodes: 32, dedicatedFabricRack: true, storage: 'wekapod', coolingSet: 'inferx',
    nodes: ['smc-b300', 'dgx-b300', 'smc-rtx6000', 'smc-h200', 'smc-l40s'], defaultNode: 'smc-b300',
  },

  'nv-nvl72': {
    group: 'nvidia', stack: 'nvidia', label: 'NVIDIA NVL72 AI Factory — GB300 NVL72 (2-4-5-800)',
    desc: 'NVIDIA Enterprise RA for the GB300 NVL72: one liquid-cooled rack of 18 compute trays (72 Blackwell Ultra GPUs, 36 Grace) is the scalable unit, tested from 1 to 8 racks. Dual-plane Spectrum-X compute fabric with four leaves per plane per pair of racks, converged north-south on the trays\' BlueField-3 B3240, two SN2201 in every rack, twelve management nodes.',
    nodes: ['nv-gb300-nvl72'], defaultNode: 'nv-gb300-nvl72', coolingSet: 'rackscale',
    minGpuNodes: 1, maxGpuNodes: 8, suNodes: 1, unit: 'rack',
    dedicatedFabricRack: true, storage: 'wekapod', tier2: false,
    controlPlane: { count: 12, ru: 1, desc: '12 management nodes (x86 2 × 32C or 2 × Grace, 512 GB, 2 × 7.68 TB NVMe, 4 × ConnectX-7 200G)', nsPorts: 4, nsGb: 200,
      nsAdapter: 'NVIDIA ConnectX-7 200G single-port', nsAdapterQty: 4, model: '2S x86 or 2S Grace 1U (NVL72 RA Table 2/3)',
      guide: 'nvl72-mgmt', build: { dimm: 'ddr5-64', dimmQty: 8, boot: 'm2-960', bootQty: 2, data: 'u3-7680', dataQty: 2 } },
    fabric: {
      rule: 'nvl72', consolidatedUpTo: 0, oobInRack: 2, oobUplinks: 'converged',
      converged: (nodes, racks) => ({ storage: 4 + 2 * racks, customer: 4 + 4 * racks, support: 12 }),
    },
    storageGbPerGpu: 12.5, customerGbPerGpu: 25,
    ra: {
      name: 'NVIDIA NVL72 AI Factory (Enterprise RA)', pattern: '2-4-5-800',
      url: 'https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/index.html',
      cite: 'NVIDIA NVL72 AI Factory RA — Tables 5–7 (fabric), Table 11 (switch counts per SU), Table 12 (endpoint cabling), Components (up to 142 kW, 2 × SN2201 per rack)',
    },
    verified: {
      unit: 'rack',
      ew: { 1: [8, 4], 2: [8, 4], 3: [16, 8], 4: [16, 8], 5: [24, 8], 6: [24, 8], 7: [32, 12], 8: [32, 12] },
      ns: { 2: [2, 0], 4: [4, 2], 8: [7, 4] },
      oobInRack: { 1: 2, 2: 4, 4: 8, 8: 16 },
    },
  },
  'nv-hgx-b300': {
    group: 'nvidia', stack: 'nvidia', label: 'NVIDIA HGX AI Factory — HGX B300 (2-8-9-800)',
    desc: 'NVIDIA Enterprise RA for NVIDIA-Certified HGX B300 systems in the 2-8-9-800 pattern: four-node scalable units from 4 to 128 nodes (32 to 1,024 GPUs), dual-plane rail-optimised Spectrum-X compute fabric on ConnectX-8, converged north-south on BlueField-3 B3240, SN2201 out-of-band, up to eight control-plane nodes, NVIDIA-Certified Storage at 12.5 Gb/s per GPU or more.',
    nodes: ['nv-hgx-b300'], defaultNode: 'nv-hgx-b300', coolingSet: 'nvidia', defaultCooling: 'air4',
    minGpuNodes: 4, maxGpuNodes: 128, suNodes: 4, unit: 'node',
    dedicatedFabricRack: true, storage: 'wekapod', tier2: false,
    controlPlane: { count: 8, ru: 1, desc: 'up to 8 control-plane nodes (2 × 32C, 256 GB, 1 TB boot + 4 TB NVMe, BlueField-3 B3220)', nsPorts: 2, nsGb: 200,
      nsAdapter: 'NVIDIA BlueField-3 B3220 2-port 200GbE DPU', nsAdapterQty: 1, model: '2S x86 1U (Enterprise RA Table 3)' },
    fabric: {
      rule: 'enterprise', consolidatedUpTo: 16, oobInRack: 0, oobUplinks: 'converged',
      converged: (nodes) => ({ storage: nodes / 4, customer: nodes / 2, support: 4 }),
    },
    storageGbPerGpu: 12.5, customerGbPerGpu: 25,
    ra: {
      name: 'NVIDIA HGX AI Factory (Enterprise RA)', pattern: '2-8-9-800',
      url: 'https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory/latest/index.html',
      cite: 'NVIDIA HGX AI Factory RA (HGX B300) — Overview (four-node SU, 32 SUs), Table 2 (node minimums), Tables 5–7 (fabric), Table 9 (switch counts), Table 10 (endpoint cabling)',
    },
    verified: {
      unit: 'node',
      ew: { 32: [8, 4], 64: [16, 8], 128: [32, 16] },
      ns: { 32: [2, 0], 64: [4, 2], 128: [8, 4] },
      oob: { 32: 4, 64: 8, 128: 16 },
    },
  },
  'nv-hgx-b200': {
    group: 'nvidia', stack: 'nvidia', label: 'NVIDIA HGX AI Factory — HGX B200 (2-8-9-400)',
    desc: 'NVIDIA Enterprise RA for NVIDIA-Certified HGX H100, H200 or B200 systems in the 2-8-9-400 pattern: four-node scalable units from 4 to 128 nodes, single-plane rail-optimised Spectrum-X compute fabric on eight BlueField-3 B3140H 400G SuperNICs, converged north-south on a BlueField-3 B3220 2 × 200G, SN2201 out-of-band, up to eight control-plane nodes, NVIDIA-Certified Storage at 12.5 Gb/s per GPU or more.',
    nodes: ['nv-hgx-b200'], defaultNode: 'nv-hgx-b200', coolingSet: 'nvidia', defaultCooling: 'air4',
    minGpuNodes: 4, maxGpuNodes: 128, suNodes: 4, unit: 'node',
    dedicatedFabricRack: true, storage: 'wekapod', tier2: false,
    controlPlane: { count: 8, ru: 1, desc: 'up to 8 control-plane nodes (2 × 32C, 256 GB, 1 TB boot + 4 TB NVMe, BlueField-3 B3220)', nsPorts: 2, nsGb: 200,
      nsAdapter: 'NVIDIA BlueField-3 B3220 2-port 200GbE DPU', nsAdapterQty: 1, model: '2S x86 1U (Enterprise RA Table 3)' },
    fabric: {
      rule: 'enterprise', consolidatedUpTo: 16, oobInRack: 0, oobUplinks: 'converged',
      converged: (nodes) => ({ storage: nodes / 4, customer: nodes / 2, support: 4 }),
    },
    storageGbPerGpu: 12.5, customerGbPerGpu: 25,
    ra: {
      name: 'NVIDIA HGX AI Factory (Enterprise RA) — H100, H200, B200', pattern: '2-8-9-400',
      url: 'https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory-h100-h200-b200/latest/index.html',
      cite: 'NVIDIA HGX AI Factory RA (H100/H200/B200) — Overview (four-node SU), Table 2 (node minimums), Tables 6–8 (fabric), Table 10 (switch counts), Table 11 (endpoint cabling)',
    },
    verified: {
      unit: 'node',
      ew: { 32: [4, 2], 64: [8, 4], 128: [16, 8] },
      ns: { 32: [2, 0], 64: [2, 0], 128: [6, 4] },
      oob: { 32: 4, 64: 8, 128: 16 },
    },
  },
  'nv-hgx-h200': {
    group: 'nvidia', stack: 'nvidia', label: 'NVIDIA HGX AI Factory — HGX H200 (2-8-9-400)',
    desc: 'NVIDIA Enterprise RA for NVIDIA-Certified HGX H100, H200 or B200 systems in the 2-8-9-400 pattern: four-node scalable units from 4 to 128 nodes, single-plane rail-optimised Spectrum-X compute fabric on eight BlueField-3 B3140H 400G SuperNICs, converged north-south on a BlueField-3 B3220 2 × 200G, SN2201 out-of-band, up to eight control-plane nodes, NVIDIA-Certified Storage at 12.5 Gb/s per GPU or more.',
    nodes: ['nv-hgx-h200'], defaultNode: 'nv-hgx-h200', coolingSet: 'nvidia', defaultCooling: 'air4',
    minGpuNodes: 4, maxGpuNodes: 128, suNodes: 4, unit: 'node',
    dedicatedFabricRack: true, storage: 'wekapod', tier2: false,
    controlPlane: { count: 8, ru: 1, desc: 'up to 8 control-plane nodes (2 × 32C, 256 GB, 1 TB boot + 4 TB NVMe, BlueField-3 B3220)', nsPorts: 2, nsGb: 200,
      nsAdapter: 'NVIDIA BlueField-3 B3220 2-port 200GbE DPU', nsAdapterQty: 1, model: '2S x86 1U (Enterprise RA Table 3)' },
    fabric: {
      rule: 'enterprise', consolidatedUpTo: 16, oobInRack: 0, oobUplinks: 'converged',
      converged: (nodes) => ({ storage: nodes / 4, customer: nodes / 2, support: 4 }),
    },
    storageGbPerGpu: 12.5, customerGbPerGpu: 25,
    ra: {
      name: 'NVIDIA HGX AI Factory (Enterprise RA) — H100, H200, B200', pattern: '2-8-9-400',
      url: 'https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory-h100-h200-b200/latest/index.html',
      cite: 'NVIDIA HGX AI Factory RA (H100/H200/B200) — Overview (four-node SU), Table 2 (node minimums), Tables 6–8 (fabric), Table 10 (switch counts), Table 11 (endpoint cabling)',
    },
    verified: {
      unit: 'node',
      ew: { 32: [4, 2], 64: [8, 4], 128: [16, 8] },
      ns: { 32: [2, 0], 64: [2, 0], 128: [6, 4] },
      oob: { 32: 4, 64: 8, 128: 16 },
    },
  },
  'nv-hgx-h100': {
    group: 'nvidia', stack: 'nvidia', label: 'NVIDIA HGX AI Factory — HGX H100 (2-8-9-400)',
    desc: 'NVIDIA Enterprise RA for NVIDIA-Certified HGX H100, H200 or B200 systems in the 2-8-9-400 pattern: four-node scalable units from 4 to 128 nodes, single-plane rail-optimised Spectrum-X compute fabric on eight BlueField-3 B3140H 400G SuperNICs, converged north-south on a BlueField-3 B3220 2 × 200G, SN2201 out-of-band, up to eight control-plane nodes, NVIDIA-Certified Storage at 12.5 Gb/s per GPU or more.',
    nodes: ['nv-hgx-h100'], defaultNode: 'nv-hgx-h100', coolingSet: 'nvidia', defaultCooling: 'air4',
    minGpuNodes: 4, maxGpuNodes: 128, suNodes: 4, unit: 'node',
    dedicatedFabricRack: true, storage: 'wekapod', tier2: false,
    controlPlane: { count: 8, ru: 1, desc: 'up to 8 control-plane nodes (2 × 32C, 256 GB, 1 TB boot + 4 TB NVMe, BlueField-3 B3220)', nsPorts: 2, nsGb: 200,
      nsAdapter: 'NVIDIA BlueField-3 B3220 2-port 200GbE DPU', nsAdapterQty: 1, model: '2S x86 1U (Enterprise RA Table 3)' },
    fabric: {
      rule: 'enterprise', consolidatedUpTo: 16, oobInRack: 0, oobUplinks: 'converged',
      converged: (nodes) => ({ storage: nodes / 4, customer: nodes / 2, support: 4 }),
    },
    storageGbPerGpu: 12.5, customerGbPerGpu: 25,
    ra: {
      name: 'NVIDIA HGX AI Factory (Enterprise RA) — H100, H200, B200', pattern: '2-8-9-400',
      url: 'https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory-h100-h200-b200/latest/index.html',
      cite: 'NVIDIA HGX AI Factory RA (H100/H200/B200) — Overview (four-node SU), Table 2 (node minimums), Tables 6–8 (fabric), Table 10 (switch counts), Table 11 (endpoint cabling)',
    },
    verified: {
      unit: 'node',
      ew: { 32: [4, 2], 64: [8, 4], 128: [16, 8] },
      ns: { 32: [2, 0], 64: [2, 0], 128: [6, 4] },
      oob: { 32: 4, 64: 8, 128: 16 },
    },
  },
  'nv-rtxpro': {
    group: 'nvidia', stack: 'nvidia', label: 'NVIDIA RTX PRO AI Factory — RTX PRO 6000 (2-8-5-200)',
    desc: 'NVIDIA Enterprise RA for NVIDIA-Certified RTX PRO Servers in the 2-8-5-200 pattern: four-node scalable units from 4 to 32 nodes (32 to 256 GPUs), four BlueField-3 B3140H SuperNICs per node (200 GbE per GPU) on a rail-optimised Spectrum-X fabric that is consolidated with the converged north-south network up to 16 nodes, BlueField-3 B3220 north-south, SN2201 out-of-band, up to eight control-plane nodes.',
    nodes: ['nv-rtxpro'], defaultNode: 'nv-rtxpro', coolingSet: 'nvidia', defaultCooling: 'air4',
    minGpuNodes: 4, maxGpuNodes: 32, suNodes: 4, unit: 'node',
    dedicatedFabricRack: true, storage: 'wekapod', tier2: false,
    controlPlane: { count: 8, ru: 1, desc: 'up to 8 control-plane nodes (2 × 32C, 256 GB, 1 TB boot + 4 TB NVMe, BlueField-3 B3220)', nsPorts: 2, nsGb: 200,
      nsAdapter: 'NVIDIA BlueField-3 B3220 2-port 200GbE DPU', nsAdapterQty: 1, model: '2S x86 1U (Enterprise RA Table 3)' },
    fabric: {
      rule: 'enterprise', consolidatedUpTo: 16, oobInRack: 0, oobUplinks: 'converged',
      converged: (nodes) => ({ storage: nodes / 4, customer: nodes / 2, support: 4 }),
    },
    storageGbPerGpu: 12.5, customerGbPerGpu: 25,
    ra: {
      name: 'NVIDIA RTX PRO AI Factory (Enterprise RA)', pattern: '2-8-5-200',
      url: 'https://docs.nvidia.com/enterprise-reference-architectures/rtx-pro-ai-factory/latest/index.html',
      cite: 'NVIDIA RTX PRO AI Factory RA — Overview (four-node SU, 16 and 32 nodes), Table 1 (node minimums), Tables 5–7 (fabric), Table 9 (switch counts), Table 10 (endpoint cabling)',
    },
    verified: {
      unit: 'node',
      ew: { 16: [2, 0], 32: [2, 0] },
      ns: { 16: [0, 0], 32: [2, 0] },
      oob: { 16: 2, 32: 4 },
    },
  },
  'nv-l40s': {
    group: 'nvidia', stack: 'nvidia', label: 'NVIDIA L40S Enterprise RA — L40S (2-8-5-200, superseded)',
    desc: 'NVIDIA\'s L40S Enterprise RA (NVIDIA-Certified OVX L40S systems, four-node scalable units up to 32 nodes) has been withdrawn from NVIDIA\'s RA index in favour of the RTX PRO AI Factory. It is modelled here on the same 2-8-5-200 pattern and fabric rules as that successor — four BlueField-3 B3140H SuperNICs, a BlueField-3 B3220 north-south, consolidated fabric up to 16 nodes — with a Supermicro OVX 3.0 L40S system as the node.',
    nodes: ['nv-ovx-l40s'], defaultNode: 'nv-ovx-l40s', coolingSet: 'nvidia', defaultCooling: 'air4',
    minGpuNodes: 4, maxGpuNodes: 32, suNodes: 4, unit: 'node',
    dedicatedFabricRack: true, storage: 'wekapod', tier2: false,
    controlPlane: { count: 8, ru: 1, desc: 'up to 8 control-plane nodes (2 × 32C, 256 GB, 1 TB boot + 4 TB NVMe, BlueField-3 B3220)', nsPorts: 2, nsGb: 200,
      nsAdapter: 'NVIDIA BlueField-3 B3220 2-port 200GbE DPU', nsAdapterQty: 1, model: '2S x86 1U (Enterprise RA Table 3)' },
    fabric: {
      rule: 'enterprise', consolidatedUpTo: 16, oobInRack: 0, oobUplinks: 'converged',
      converged: (nodes) => ({ storage: nodes / 4, customer: nodes / 2, support: 4 }),
    },
    storageGbPerGpu: 12.5, customerGbPerGpu: 25,
    superseded: true,
    ra: {
      name: 'NVIDIA L40S Enterprise RA (withdrawn; RTX PRO AI Factory rules applied)', pattern: '2-8-5-200',
      url: 'https://docs.nvidia.com/enterprise-reference-architectures/rtx-pro-ai-factory/latest/index.html',
      cite: 'NVIDIA L40S and Spectrum Enterprise RA (OVX L40S, four-node SU, up to 32 nodes; withdrawn) and the NVIDIA RTX PRO AI Factory RA it was superseded by, whose 2-8-5-200 fabric tables are applied; Supermicro OVX 3.0 solution brief for the node',
    },
    verified: {
      unit: 'node',
      ew: { 16: [2, 0], 32: [2, 0] },
      ns: { 16: [0, 0], 32: [2, 0] },
      oob: { 16: 2, 32: 4 },
    },
  },
  'nv-dgx-superpod': {
    group: 'nvidia', stack: 'nvidia', label: 'NVIDIA DGX SuperPOD — DGX B300 (RA-11337-001)',
    desc: 'NVIDIA DGX SuperPOD reference architecture with DGX B300 systems: 64-node scalable units (512 GPUs), four DGX per rack, a dual-plane Spectrum-X compute fabric of 16 leaves and 8 spines per SU, a separate storage fabric and in-band fabric on SN5600, one SN2201 per rack, seven control nodes. The RA is written for the DC-busbar DGX B300 in MGX racks; this tool carries the AC-powered version in EIA racks, which the RA also allows.',
    nodes: ['dgx-b300'], defaultNode: 'dgx-b300', coolingSet: 'nvidia', defaultCooling: 'air4',
    minGpuNodes: 64, maxGpuNodes: 1024, suNodes: 64, unit: 'node',
    dedicatedFabricRack: true, storage: 'wekapod', tier2: false,
    controlPlane: { count: 7, ru: 2, desc: '7 control nodes (2 × Base Command Manager on in-band + OOB, 3 × Kubernetes and 2 × Slurm login on in-band + storage; SYS-221GE-FNB-A-NC24B class)', nsPorts: 2, nsGb: 400,
      nsAdapter: '400GbE in-band adapter', nsAdapterQty: 1, model: 'SYS-221GE-FNB-A-NC24B class (RA-11337-001)',
      nsAdapterSrc: 'RA-11337-001 §6.1 gives the connectivity (BCM HA on in-band and OOB, Kubernetes and Slurm login on in-band and storage, every device on OOB at 1 GbE for IPMI/Redfish) and Table 9.1 quotes a 400G transceiver for the control-plane nodes, 980-9I51S-F4NS00 — a different part from the BlueField-3\'s 980-9I693-F4NS00, so the RA\'s control-plane adapter is not a BlueField-3 and is not described as one here' },
    fabric: {
      rule: 'superpod', consolidatedUpTo: 0, oobInRack: 1, oobUplinks: 'converged',
      converged: () => ({ storage: 0, customer: 0, support: 0 }),
    },
    storageGbPerGpu: 40, customerGbPerGpu: 0,
    ra: {
      name: 'NVIDIA DGX SuperPOD RA with DGX B300 systems', pattern: 'DGX B300 (8 GPU, 8 × CX-8 800G, 2 × B3240)',
      url: 'https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300/latest/index.html',
      cite: 'NVIDIA DGX SuperPOD RA RA-11337-001 — Architecture (64-node SU, four DGX per rack, Table 3 leaf/spine per SU), Network Fabrics (dual-plane compute, storage fabric near 4:3, in-band), Management Servers, Table 7 (components at 4 SU)',
    },
    verified: {
      unit: 'node',
      ew: { 64: [16, 8], 128: [32, 16], 256: [64, 32], 512: [128, 64], 1024: [256, 128] },
    },
  },
};

/* ---------- model catalog ----------
   kvHeads drives KV-cache size under grouped-query attention, which dominates
   memory at long context. activeParams differs from params only for MoE models:
   capacity follows total parameters, but bandwidth and compute per token follow
   the active set. */
const MODELS = {
  'llama31-8b': { label: 'Llama 3.1 8B', params: 8.03e9, activeParams: 8.03e9, layers: 32, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'llama31-70b': { label: 'Llama 3.1 70B', params: 70.6e9, activeParams: 70.6e9, layers: 80, hidden: 8192, heads: 64, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'llama31-405b': { label: 'Llama 3.1 405B', params: 405e9, activeParams: 405e9, layers: 126, hidden: 16384, heads: 128, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'llama32-3b': { label: 'Llama 3.2 3B', params: 3.21e9, activeParams: 3.21e9, layers: 28, hidden: 3072, heads: 24, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'qwen25-72b': { label: 'Qwen2.5 72B', params: 72.7e9, activeParams: 72.7e9, layers: 80, hidden: 8192, heads: 64, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'qwen3-32b': { label: 'Qwen3 32B', params: 32.8e9, activeParams: 32.8e9, layers: 64, hidden: 5120, heads: 64, kvHeads: 8, headDim: 128, ctxMax: 131072 },
  'mistral-7b': { label: 'Mistral 7B', params: 7.24e9, activeParams: 7.24e9, layers: 32, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, ctxMax: 32768 },
  'mixtral-8x7b': { label: 'Mixtral 8x7B (MoE)', params: 46.7e9, activeParams: 12.9e9, layers: 32, hidden: 4096, heads: 32, kvHeads: 8, headDim: 128, ctxMax: 32768, moe: true },
  'gpt-oss-120b': { label: 'gpt-oss-120b (MoE)', params: 116.8e9, activeParams: 5.1e9, layers: 36, hidden: 2880, heads: 64, kvHeads: 8, headDim: 64, ctxMax: 131072, moe: true },
  'gpt-oss-20b': { label: 'gpt-oss-20b (MoE)', params: 20.9e9, activeParams: 3.6e9, layers: 24, hidden: 2880, heads: 64, kvHeads: 8, headDim: 64, ctxMax: 131072, moe: true },
  'deepseek-v3': { label: 'DeepSeek-V3 671B (MoE)', params: 671e9, activeParams: 37e9, layers: 61, hidden: 7168, heads: 128, kvHeads: 128, headDim: 56, ctxMax: 131072, moe: true },
};

/* Bytes per parameter by precision, and the KV-cache precision that normally
   accompanies it. FP8 KV cache is standard practice on Hopper and Blackwell. */
const PRECISIONS = {
  'fp16': { label: 'FP16 / BF16', bytes: 2, kvBytes: 2, flopKey: 'bf16' },
  'fp8': { label: 'FP8', bytes: 1, kvBytes: 1, flopKey: 'fp8' },
  'int8': { label: 'INT8', bytes: 1, kvBytes: 1, flopKey: 'fp8' },
  'fp4': { label: 'FP4 / NVFP4', bytes: 0.5, kvBytes: 1, flopKey: 'fp4' },
  'int4': { label: 'INT4 / AWQ', bytes: 0.5, kvBytes: 1, flopKey: 'fp4' },
};

/* Serving efficiency factors. Decode is memory-bandwidth bound and prefill is
   compute bound; neither reaches the paper peak on a real serving stack, so
   both are derated. These are the least-grounded numbers in the model — they
   come from typical vLLM/TensorRT-LLM behaviour, not from a benchmark in the
   reference architecture. */
const SERVING = {
  bwEfficiency: 0.80,      // achievable fraction of peak HBM bandwidth in decode
  flopEfficiency: 0.55,    // achievable fraction of dense peak in prefill (MFU)
  tpScalingLoss: 0.06,     // per doubling of tensor-parallel width inside an NVLink domain
  tpScalingLossPcie: 0.18, // per doubling inside a chassis without NVLink
  // Per doubling that takes the group past its coherent domain and onto the
  // east-west fabric. A 400G or 800G link carries an order of magnitude less
  // than NVLink, so an all-reduce that crosses it costs far more than one that
  // does not; this is the least-grounded of the three and is a representative
  // figure rather than a measured one.
  tpScalingLossFabric: 0.25,
  workspaceGB: 2.0,        // CUDA context, activations and framework per GPU
  weightOverhead: 1.05,    // packing, embeddings and alignment on top of raw weights
  kvUtilisation: 0.90,     // usable fraction of KV pool after paged-attention fragmentation
};
