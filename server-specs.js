/* ---------- configurable server specifications ----------

   Every server in the solution — GPU node, platform server, platform router,
   CPU compute node, control-plane node and Tier 2 storage — is configurable on
   CPU, memory and disk. This file holds three things: the component catalogue
   the options come from, a per-role chassis definition that says what each
   chassis will physically take, and the guideline NVIDIA publishes for that
   role so a build can be checked against it.

   WHERE THE GUIDELINES COME FROM. NVIDIA's own NCP material — the NCP Software
   Reference Guide and "NVIDIA Requirements for AI Clouds" — is deliberately
   outcome-based: it states that "compliance is determined by whether the
   provider's implementation satisfies the meaning and required outcome stated
   in this guide" and redirects hardware detail to an access-controlled
   reference. It publishes no CPU, memory or disk figures to check against. The
   prescriptive numbers NVIDIA does publish are in the Enterprise Reference
   Architectures and the NVL72 AI Factory RA, and those are what this file uses
   as the guideline. Every NVIDIA-Certified / NCP-eligible system that carries
   these roles is built to them, so aligning to them is what aligning to an NCP
   system means in practice.

   HOW POWER MOVES. A record's published wattage (the InferX RA BOM's elevation
   figures, a Supermicro node power figure, an NVIDIA system specification) is
   the base. Changing a component moves the draw by the difference between the
   chosen part and the default part, so a default configuration reproduces the
   published elevation exactly and a changed one moves by a defensible amount.
   Component wattages are the part vendors' own where they publish them —
   Micron's 7450 PRO PS0 figures, Western Digital's Ultrastar operating
   figure — and the RA BOM's where the BOM is the only source, as with 6.6 W
   per 32 GB DDR5 RDIMM. One source is used consistently within a family, since
   it is the difference between two builds that is read, not the absolute
   figure: mixing a vendor number for one capacity with an estimate for the
   next invents a difference that is not there. Where the BOM allowed more per
   drive than the vendor publishes, that allowance stays inside the base
   elevation, which is not recomputed. Adapters are not differenced at all:
   they are fixed by the reference architecture and already inside the
   published figure.

   Appliances are not configurable. A DGX B300, a GB300 NVL72 rack and a
   Synology RS822RP+ are bought as built; they carry `fixed: true` and are
   shown read-only. */

/* ---------- component catalogue ---------- */

/* CPUs, grouped by socket so a chassis only ever offers parts it can take.
   `w` is the part's TDP. Supermicro part numbers are given only for the two
   the InferX RA BOM names; the rest are identified by their processor model,
   which is what a configurator matches on. */
const SERVER_PARTS = {
  cpu: {
    /* AMD EPYC 9004 "Genoa" (Zen 4) and 9004X "Genoa-X", Socket SP5,
       12 channels of DDR5-4800. Cores, threads, base clock and default TDP are
       AMD's own, from the EPYC 9004 Series Processors data sheet; the 9005
       figures below are from the EPYC 9005 data sheet. Only two-socket-capable
       parts are listed: the P suffixes (9354P, 9454P, 9554P, 9654P, 9355P,
       9455P, 9555P, 9655P) are single-socket-only and every role here is
       two-socket, so offering them would build a machine that cannot be
       ordered. `ghz` is the base clock, not a boost figure. */
    'epyc-9124': { label: 'AMD EPYC 9124', cores: 16, threads: 32, ghz: 3.0, w: 200, socket: 'sp5', gen: 'Genoa' },
    'epyc-9174f': { label: 'AMD EPYC 9174F', cores: 16, threads: 32, ghz: 4.1, w: 320, socket: 'sp5', gen: 'Genoa' },
    'epyc-9184x': { label: 'AMD EPYC 9184X', cores: 16, threads: 32, ghz: 3.55, w: 320, socket: 'sp5', gen: 'Genoa-X' },
    'epyc-9224': { label: 'AMD EPYC 9224', cores: 24, threads: 48, ghz: 2.5, w: 200, socket: 'sp5', gen: 'Genoa' },
    'epyc-9254': { label: 'AMD EPYC 9254', cores: 24, threads: 48, ghz: 2.9, w: 200, socket: 'sp5', gen: 'Genoa', pn: 'PSE-GEN9254-0480' },
    'epyc-9274f': { label: 'AMD EPYC 9274F', cores: 24, threads: 48, ghz: 4.05, w: 320, socket: 'sp5', gen: 'Genoa' },
    'epyc-9334': { label: 'AMD EPYC 9334', cores: 32, threads: 64, ghz: 2.7, w: 210, socket: 'sp5', gen: 'Genoa' },
    'epyc-9354': { label: 'AMD EPYC 9354', cores: 32, threads: 64, ghz: 3.25, w: 280, socket: 'sp5', gen: 'Genoa', nvRec: true },
    'epyc-9374f': { label: 'AMD EPYC 9374F', cores: 32, threads: 64, ghz: 3.85, w: 320, socket: 'sp5', gen: 'Genoa' },
    'epyc-9384x': { label: 'AMD EPYC 9384X', cores: 32, threads: 64, ghz: 3.1, w: 320, socket: 'sp5', gen: 'Genoa-X' },
    'epyc-9454': { label: 'AMD EPYC 9454', cores: 48, threads: 96, ghz: 2.75, w: 290, socket: 'sp5', gen: 'Genoa' },
    'epyc-9474f': { label: 'AMD EPYC 9474F', cores: 48, threads: 96, ghz: 3.6, w: 360, socket: 'sp5', gen: 'Genoa' },
    'epyc-9534': { label: 'AMD EPYC 9534', cores: 64, threads: 128, ghz: 2.45, w: 280, socket: 'sp5', gen: 'Genoa' },
    'epyc-9554': { label: 'AMD EPYC 9554', cores: 64, threads: 128, ghz: 3.1, w: 360, socket: 'sp5', gen: 'Genoa', pn: 'PSE-GEN9554-0790' },
    'epyc-9634': { label: 'AMD EPYC 9634', cores: 84, threads: 168, ghz: 2.25, w: 290, socket: 'sp5', gen: 'Genoa' },
    'epyc-9654': { label: 'AMD EPYC 9654', cores: 96, threads: 192, ghz: 2.4, w: 360, socket: 'sp5', gen: 'Genoa' },
    'epyc-9684x': { label: 'AMD EPYC 9684X', cores: 96, threads: 192, ghz: 2.55, w: 400, socket: 'sp5', gen: 'Genoa-X' },
    // AMD EPYC 97x4 "Bergamo" (Zen 4c), Socket SP5
    'epyc-9734': { label: 'AMD EPYC 9734', cores: 112, threads: 224, ghz: 2.2, w: 340, socket: 'sp5', gen: 'Bergamo' },
    'epyc-9754': { label: 'AMD EPYC 9754', cores: 128, threads: 256, ghz: 2.25, w: 360, socket: 'sp5', gen: 'Bergamo' },
    'epyc-9754s': { label: 'AMD EPYC 9754S', cores: 128, threads: 128, ghz: 2.25, w: 360, socket: 'sp5', gen: 'Bergamo' },
    // AMD EPYC 9005 "Turin" (Zen 5), Socket SP5, 12 channels of DDR5-6000
    'epyc-9015': { label: 'AMD EPYC 9015', cores: 8, threads: 16, ghz: 3.6, w: 125, socket: 'sp5', gen: 'Turin' },
    'epyc-9115': { label: 'AMD EPYC 9115', cores: 16, threads: 32, ghz: 2.6, w: 125, socket: 'sp5', gen: 'Turin' },
    'epyc-9135': { label: 'AMD EPYC 9135', cores: 16, threads: 32, ghz: 3.65, w: 200, socket: 'sp5', gen: 'Turin' },
    'epyc-9175f': { label: 'AMD EPYC 9175F', cores: 16, threads: 32, ghz: 4.2, w: 320, socket: 'sp5', gen: 'Turin' },
    'epyc-9255': { label: 'AMD EPYC 9255', cores: 24, threads: 48, ghz: 3.2, w: 200, socket: 'sp5', gen: 'Turin' },
    'epyc-9275f': { label: 'AMD EPYC 9275F', cores: 24, threads: 48, ghz: 4.1, w: 320, socket: 'sp5', gen: 'Turin' },
    'epyc-9335': { label: 'AMD EPYC 9335', cores: 32, threads: 64, ghz: 3.0, w: 210, socket: 'sp5', gen: 'Turin' },
    'epyc-9355': { label: 'AMD EPYC 9355', cores: 32, threads: 64, ghz: 3.55, w: 280, socket: 'sp5', gen: 'Turin' },
    'epyc-9375f': { label: 'AMD EPYC 9375F', cores: 32, threads: 64, ghz: 3.8, w: 320, socket: 'sp5', gen: 'Turin' },
    'epyc-9365': { label: 'AMD EPYC 9365', cores: 36, threads: 72, ghz: 3.4, w: 300, socket: 'sp5', gen: 'Turin' },
    'epyc-9455': { label: 'AMD EPYC 9455', cores: 48, threads: 96, ghz: 3.15, w: 300, socket: 'sp5', gen: 'Turin' },
    'epyc-9475f': { label: 'AMD EPYC 9475F', cores: 48, threads: 96, ghz: 3.65, w: 400, socket: 'sp5', gen: 'Turin' },
    'epyc-9535': { label: 'AMD EPYC 9535', cores: 64, threads: 128, ghz: 2.4, w: 300, socket: 'sp5', gen: 'Turin' },
    'epyc-9555': { label: 'AMD EPYC 9555', cores: 64, threads: 128, ghz: 3.2, w: 360, socket: 'sp5', gen: 'Turin' },
    'epyc-9575f': { label: 'AMD EPYC 9575F', cores: 64, threads: 128, ghz: 3.3, w: 400, socket: 'sp5', gen: 'Turin' },
    'epyc-9565': { label: 'AMD EPYC 9565', cores: 72, threads: 144, ghz: 3.15, w: 400, socket: 'sp5', gen: 'Turin' },
    'epyc-9655': { label: 'AMD EPYC 9655', cores: 96, threads: 192, ghz: 2.6, w: 400, socket: 'sp5', gen: 'Turin' },
    'epyc-9755': { label: 'AMD EPYC 9755', cores: 128, threads: 256, ghz: 2.7, w: 500, socket: 'sp5', gen: 'Turin' },
    // AMD EPYC 9005 "Turin Dense" (Zen 5c), Socket SP5
    'epyc-9645': { label: 'AMD EPYC 9645', cores: 96, threads: 192, ghz: 2.3, w: 320, socket: 'sp5', gen: 'Turin Dense' },
    'epyc-9745': { label: 'AMD EPYC 9745', cores: 128, threads: 256, ghz: 2.4, w: 400, socket: 'sp5', gen: 'Turin Dense' },
    'epyc-9825': { label: 'AMD EPYC 9825', cores: 144, threads: 288, ghz: 2.2, w: 390, socket: 'sp5', gen: 'Turin Dense' },
    'epyc-9845': { label: 'AMD EPYC 9845', cores: 160, threads: 320, ghz: 2.1, w: 390, socket: 'sp5', gen: 'Turin Dense' },
    'epyc-9965': { label: 'AMD EPYC 9965', cores: 192, threads: 384, ghz: 2.25, w: 500, socket: 'sp5', gen: 'Turin Dense' },
    /* Intel Xeon 4th/5th generation, Socket E (FCLGA4677), 8 memory channels.
       Cores, threads, base frequency and processor base power are Intel ARK's. */
    'xeon-4510': { label: 'Intel Xeon Silver 4510', cores: 12, threads: 24, ghz: 2.4, w: 150, socket: 'lga4677', gen: 'Emerald Rapids', pn: 'P4X-EMR4510-SRN60-LCC' },
    'xeon-4516y': { label: 'Intel Xeon Silver 4516Y+', cores: 24, threads: 48, ghz: 2.2, w: 185, socket: 'lga4677', gen: 'Emerald Rapids' },
    'xeon-5416s': { label: 'Intel Xeon Gold 5416S', cores: 16, threads: 32, ghz: 2.0, w: 150, socket: 'lga4677', gen: 'Sapphire Rapids' },
    'xeon-6430': { label: 'Intel Xeon Gold 6430', cores: 32, threads: 64, ghz: 2.1, w: 270, socket: 'lga4677', gen: 'Sapphire Rapids' },
    'xeon-6448y': { label: 'Intel Xeon Gold 6448Y', cores: 32, threads: 64, ghz: 2.1, w: 225, socket: 'lga4677', gen: 'Sapphire Rapids', nvRec: true },
    'xeon-6530': { label: 'Intel Xeon Gold 6530', cores: 32, threads: 64, ghz: 2.1, w: 270, socket: 'lga4677', gen: 'Emerald Rapids' },
    'xeon-6542y': { label: 'Intel Xeon Gold 6542Y', cores: 24, threads: 48, ghz: 2.9, w: 250, socket: 'lga4677', gen: 'Emerald Rapids' },
    'xeon-8480': { label: 'Intel Xeon Platinum 8480+', cores: 56, threads: 112, ghz: 2.0, w: 350, socket: 'lga4677', gen: 'Sapphire Rapids' },
    'xeon-8592': { label: 'Intel Xeon Platinum 8592+', cores: 64, threads: 128, ghz: 1.9, w: 350, socket: 'lga4677', gen: 'Emerald Rapids' },
    // Intel Xeon 6 P-core 6700P, Socket E (FCLGA4710), 8 memory channels
    'xeon-6767p': { label: 'Intel Xeon 6767P', cores: 64, threads: 128, ghz: 2.4, w: 350, socket: 'lga4710', gen: 'Granite Rapids' },
    'xeon-6776p': { label: 'Intel Xeon 6776P', cores: 64, threads: 128, ghz: 2.3, w: 350, socket: 'lga4710', gen: 'Granite Rapids' },
    'xeon-6787p': { label: 'Intel Xeon 6787P', cores: 86, threads: 172, ghz: 2.0, w: 350, socket: 'lga4710', gen: 'Granite Rapids' },
    // Intel Xeon 6 P-core 6900P, Socket F (FCLGA7529), 12 memory channels
    'xeon-6960p': { label: 'Intel Xeon 6960P', cores: 72, threads: 144, ghz: 2.7, w: 500, socket: 'lga7529', gen: 'Granite Rapids' },
    'xeon-6980p': { label: 'Intel Xeon 6980P', cores: 128, threads: 256, ghz: 2.0, w: 500, socket: 'lga7529', gen: 'Granite Rapids' },
  },

  /* DDR5 registered DIMMs. 6.6 W for the 32 GB module is the RA BOM's own
     figure (158 W across 24 modules). The rest are scaled from it by rank and
     die count rather than taken from a vendor table: DDR5 RDIMM power is
     workload-dependent and the module vendors publish it as a range, not a
     number. Only the difference between two builds is used, and it is small
     against a node's published draw. */
  dimm: {
    'ddr5-16': { label: '16 GB DDR5-4800 RDIMM', gb: 16, rank: '1Rx8', w: 4.8, kg: 0.04, pn: 'MEM-DR516L-CL01-ER48' },
    'ddr5-32': { label: '32 GB DDR5-4800 RDIMM', gb: 32, rank: '2Rx8', w: 6.6, kg: 0.05, pn: 'MEM-DR532L-CL01-ER48' },
    'ddr5-64': { label: '64 GB DDR5-4800 RDIMM', gb: 64, rank: '2Rx4', w: 10.2, kg: 0.06 },
    'ddr5-96': { label: '96 GB DDR5-5600 RDIMM', gb: 96, rank: '2Rx4', w: 12.5, kg: 0.06 },
    'ddr5-128': { label: '128 GB DDR5-5600 RDIMM (3DS)', gb: 128, rank: '2Rx4', w: 15.8, kg: 0.07 },
    'ddr5-256': { label: '256 GB DDR5-5600 RDIMM (3DS)', gb: 256, rank: '2S2Rx4', w: 22, kg: 0.09 },
  },

  /* Boot media: M.2, which is what every role here boots from — the reference
     architectures all specify a mirrored M.2 pair. Power is Micron's published
     PS0 figure for the 7450 PRO, taking the higher of active read and active
     write. Note that these barely move with capacity (480 GB and 960 GB are
     both 7 W), which is the point of using one source consistently: scaling a
     guess by capacity would have invented a difference that is not there. */
  boot: {
    'none': { label: 'Not populated', gb: 0, w: 0, kg: 0, form: 'any' },
    'm2-480': { label: '480 GB M.2 NVMe (Micron 7450 PRO)', gb: 480, w: 7, kg: 0.01, form: 'm2', pn: 'HDS-MMN-MTFDKBA480TFR1BC' },
    'm2-960': { label: '960 GB M.2 NVMe (Micron 7450 PRO)', gb: 960, w: 7, kg: 0.01, form: 'm2' },
    'm2-1920': { label: '1.92 TB M.2 NVMe (Micron 7450 PRO)', gb: 1920, w: 7.5, kg: 0.02, form: 'm2' },
  },

  /* Data media. `form` gates which bays a part will go in: U.3 for the 1U
     Hyper chassis, E1.S for the HGX B300 front bays, 3.5" SAS for the Tier 2
     storage chassis.

     NVMe power is Micron's published 7450 PRO figures where Micron publishes
     them — E1.S 3.84 TB and 7.68 TB, U.3 15.36 TB — and interpolated within
     that same family where it does not. SAS power and weight are Western
     Digital's Ultrastar DC HC550 data sheet: 8.8 W operating and 690 g for the
     SAS models. The 22 TB is an HC570 rather than an HC550 and Western Digital
     publishes no operating figure for it in the same table, so it is carried at
     the HC550's. */
  data: {
    'none': { label: 'Not populated', gb: 0, w: 0, kg: 0, form: 'any' },
    'u3-1920': { label: '1.92 TB U.3 NVMe (Micron 7450 PRO)', gb: 1920, w: 11.5, kg: 0.15, form: 'u3' },
    'u3-3840': { label: '3.84 TB U.3 NVMe (Micron 7450 PRO)', gb: 3840, w: 13, kg: 0.15, form: 'u3' },
    'u3-7680': { label: '7.68 TB U.3 NVMe (Micron 7450 PRO)', gb: 7680, w: 15, kg: 0.16, form: 'u3', pn: 'MTFDKCC7T6TFR-1BC15ABYY' },
    'u3-15360': { label: '15.36 TB U.3 NVMe (Micron 7450 PRO)', gb: 15360, w: 16.6, kg: 0.17, form: 'u3' },
    'e1s-3840': { label: '3.84 TB E1.S NVMe (Micron 7450 PRO)', gb: 3840, w: 12, kg: 0.08, form: 'e1s' },
    'e1s-7680': { label: '7.68 TB E1.S NVMe (Micron 7450 PRO)', gb: 7680, w: 13.5, kg: 0.09, form: 'e1s' },
    'e1s-15360': { label: '15.36 TB E1.S NVMe', gb: 15360, w: 15, kg: 0.1, form: 'e1s' },
    'sas-14t': { label: '14 TB 7.2k SAS (WD Ultrastar DC HC550)', gb: 14000, w: 8.8, kg: 0.69, form: 'lff', pn: 'HDD-A14T-WUH721814AL5201' },
    'sas-18t': { label: '18 TB 7.2k SAS (WD Ultrastar DC HC550)', gb: 18000, w: 8.8, kg: 0.69, form: 'lff' },
    'sas-22t': { label: '22 TB 7.2k SAS (WD Ultrastar DC HC570)', gb: 22000, w: 8.8, kg: 0.7, form: 'lff' },
  },
};

/* ---------- network adapters ----------
   Kept apart from the CPU/memory/disk options because connectivity is not a
   free choice: the fabric the engine sizes and the cable schedule it prints
   are counted from these, so a role's adapters are what its reference
   architecture specifies. They are listed per role so the configuration page
   can show what each server presents to each network, and so a build can be
   checked for having a path onto every network it needs. */
/* BlueField-3 OPNs are the crypto-enabled ones from NVIDIA's BlueField-3
   Networking Platform User Guide, "Supported Models"; each also ships in a
   crypto-disabled variant under a different OPN. No wattage is carried here:
   the adapters are not separately configurable, so a device's draw comes from
   its own published elevation or system rating, which already includes them —
   a figure here would be unused and would imply a precision nothing relies
   on. */
const NET_ADAPTERS = {
  'b3240': { label: 'NVIDIA BlueField-3 B3240 DPU', ports: 2, gb: 400, pn: '900-9D3B6-00CN-AB0' },
  'b3220': { label: 'NVIDIA BlueField-3 B3220 DPU', ports: 2, gb: 200, pn: '900-9D3B6-00CV-AA0' },
  'b3140h': { label: 'NVIDIA BlueField-3 B3140H SuperNIC', ports: 1, gb: 400, pn: '900-9D3D4-00EN-HA0' },
  'cx8-800': { label: 'NVIDIA ConnectX-8 SuperNIC 800G OSFP', ports: 1, gb: 800 },
  'cx7-200': { label: 'NVIDIA ConnectX-7 200G single-port', ports: 1, gb: 200 },
  'ns-400': { label: '400GbE in-band adapter (RA-11337-001)', ports: 2, gb: 400 },
  'aiom-1g': { label: 'AIOM 2-port 1GbE (Intel i350-AM2)', ports: 2, gb: 1, pn: 'AOC-AG-I2M-O' },
  'aoc-1g': { label: 'AOC 2-port 1GbE (Intel i350)', ports: 2, gb: 1, pn: 'AOC-SGP-I2' },
  'aiom-10g': { label: 'AIOM 2-port 10GbE SFP+', ports: 2, gb: 10, pn: 'AOC-ATG-i2SM-O' },
  'lom-10g': { label: 'On-board 2-port 10GbE', ports: 2, gb: 10 },
  'bmc': { label: 'ASPEED AST2600 BMC (IPMI/Redfish)', ports: 1, gb: 1 },
};

/* The five networks a server can land on. `ns` (north-south) is the in-band
   converged fabric the engine sizes; `ew` is the compute fabric; `oob` is the
   1 GbE out-of-band management network; `bmc` is the platform controller on
   that same network; `edge` is the routed external link the platform routers
   carry. */
const NET_FABRICS = {
  ew: { label: 'East-west compute fabric' },
  ns: { label: 'North-south in-band fabric' },
  edge: { label: 'External / edge uplink' },
  oob: { label: 'Out-of-band management' },
  bmc: { label: 'BMC / platform controller' },
};

/* ---------- NVIDIA guideline specifications ----------
   The published minimums a role is checked against. Each is quoted from the
   document named in `src`, and `url` is where that document states it. */
const SPEC_GUIDES = {
  /* NVIDIA states these in round marketing capacities — "1 TB NVMe boot",
     "4 TB NVMe" — while the parts its own builds use are the 960 GB and
     3.84 TB devices those numbers name. The NVL72 RA makes that explicit by
     specifying 2 x 960 GB M.2 for the boot of a node whose family spec says
     1 TB. The thresholds here are therefore the shipping capacities, so that
     NVIDIA's own reference build is not reported as failing NVIDIA's own
     guideline. */
  'ra-control-plane': {
    name: 'NVIDIA Enterprise RA — control-plane node',
    cores: 64, ramGB: 256, bootGB: 960, dataGB: 3840,
    nets: { ns: { gb: 200, ports: 1 }, oob: { gb: 1, ports: 1 } },
    src: 'NVIDIA Enterprise Reference Architecture, Table 3: two 32-core processors (Intel Xeon Gold 6448Y or AMD EPYC 9354), 256 GB DDR5, 1 TB NVMe boot, 4 TB NVMe data, one BlueField-3 B3220, 1 Gb RJ45 BMC',
    url: 'https://docs.nvidia.com/enterprise-reference-architecture/latest/index.html',
  },
  'nvl72-mgmt': {
    name: 'NVIDIA NVL72 AI Factory RA — management node',
    cores: 64, ramGB: 512, bootGB: 960, dataGB: 15360,
    nets: { ns: { gb: 200, ports: 4 }, oob: { gb: 1, ports: 2 } },
    src: 'NVIDIA GB200/GB300 NVL72 AI Factory RA, Table 2 (x86 management node): two 32-core sockets, 512 GB (8 × 64 GB DDR5), 2 × 960 GB M.2/SATA software RAID1 boot, 2 × 7.68 TB NVMe data cache, 4 × ConnectX-7 200G single-port, TPM 2.0, BMC with Redfish 1.4+',
    url: 'https://docs.nvidia.com/ai-factory/reference-architectures/nvl72/latest/index.html',
  },
  'hgx-b300-node': {
    name: 'NVIDIA HGX B300 AI Factory RA — node minimum',
    cores: 96, ramGB: 2048, bootGB: 960, dataGB: 1920,
    src: 'NVIDIA HGX B300 Enterprise RA (2-8-9-800): at least 48 cores per socket (56 recommended), at least 2 TB of system memory, at least 1 TB of NVMe per socket for the data cache plus 1 TB for boot',
    url: 'https://docs.nvidia.com/enterprise-reference-architecture/latest/index.html',
  },
  'hgx-node': {
    name: 'NVIDIA HGX H100/H200/B200 AI Factory RA — node minimum',
    cores: 96, ramGB: 1536, bootGB: 960, dataGB: 1920,
    src: 'NVIDIA HGX H100/H200/B200 Enterprise RA (2-8-9-400): at least 48 cores per socket (56 recommended), at least 1.5 TB of system memory, at least 1 TB of NVMe per socket for the data cache plus 1 TB for boot',
    url: 'https://docs.nvidia.com/enterprise-reference-architecture/latest/index.html',
  },
  'rtxpro-node': {
    name: 'NVIDIA RTX PRO AI Factory RA — node minimum',
    cores: 56, ramGB: 1024, bootGB: 960, dataGB: 1920,
    src: 'NVIDIA RTX PRO Enterprise RA (2-8-5-200): at least 7 cores per GPU (48 per socket recommended), at least 128 GB of system memory per GPU (1 TB recommended for an 8-GPU node), 1 TB of NVMe per socket plus boot',
    url: 'https://docs.nvidia.com/enterprise-reference-architecture/latest/index.html',
  },
  'l40s-node': {
    name: 'NVIDIA L40S Enterprise RA — node minimum',
    cores: 56, ramGB: 512, bootGB: 960, dataGB: 1920,
    src: 'NVIDIA L40S Enterprise RA (withdrawn): two high-core-count sockets, at least 512 GB of system memory, NVMe boot and a local data cache',
    url: 'https://docs.nvidia.com/enterprise-reference-architecture/latest/index.html',
  },
  'ncp-storage': {
    name: 'No published NVIDIA guideline',
    src: 'NVIDIA\'s NCP material is outcome-based on storage: the NCP Software Reference Guide and "NVIDIA Requirements for AI Clouds" set performance and availability outcomes rather than a node specification, and the Enterprise RAs specify no block-storage node. The build below is the InferX RA BOM\'s own.',
    url: 'https://docs.nvidia.com/dsx/ncp/nvidia-requirements-for-ai-clouds/introduction',
  },
};

/* ---------- role definitions ----------
   `cpu`/`mem`/`boot`/`data` each carry what the chassis will take, the option
   keys it will take them from, and the default build. The default is always
   the reference architecture's own build, so an untouched configuration
   reproduces the published elevation exactly.

   `nets` is the role's connectivity, which is not user-configurable: the
   fabric sizing and the cable schedule are counted from it. */

/* Every two-socket-capable AMD EPYC part in the catalogue, in core order, and
   the Intel ranges beside it. A role offers the whole list for each socket its
   chassis family has: NVIDIA's reference architectures specify a minimum — so
   many cores per socket, so much memory — not a processor vendor, and the
   NVIDIA-Certified systems that implement each RA ship in both AMD and Intel
   builds. The platform step marks which parts clear the RA rather than hiding
   the ones that do not, so a build below the guideline is a visible choice. */
const SP5_ALL = Object.keys(SERVER_PARTS.cpu)
  .filter((k) => SERVER_PARTS.cpu[k].socket === 'sp5')
  .sort((a, b) => SERVER_PARTS.cpu[a].cores - SERVER_PARTS.cpu[b].cores || SERVER_PARTS.cpu[a].w - SERVER_PARTS.cpu[b].w);
const LGA4677_ALL = ['xeon-4510', 'xeon-5416s', 'xeon-4516y', 'xeon-6542y', 'xeon-6448y', 'xeon-6430', 'xeon-6530', 'xeon-8480', 'xeon-8592'];
const LGA4710_ALL = ['xeon-6767p', 'xeon-6776p', 'xeon-6787p'];
const LGA7529_ALL = ['xeon-6960p', 'xeon-6980p'];
const DIMM_ALL = ['ddr5-16', 'ddr5-32', 'ddr5-64', 'ddr5-96', 'ddr5-128', 'ddr5-256'];
const M2_ALL = ['none', 'm2-480', 'm2-960', 'm2-1920'];
const U3_ALL = ['none', 'u3-1920', 'u3-3840', 'u3-7680', 'u3-15360'];
const E1S_ALL = ['none', 'e1s-3840', 'e1s-7680', 'e1s-15360'];
const LFF_ALL = ['none', 'sas-14t', 'sas-18t', 'sas-22t'];

const SERVER_ROLES = {
  /* ----- InferX management stack, from the RA BOM ----- */
  'platform-server': {
    label: 'Platform server', kind: 'infra', key: 'platform-server', group: 'Management stack',
    chassis: 'Supermicro AS-1125HS-TNR', stack: 'inferx',
    cpu: { sockets: 2, platforms: { sp5: 'Supermicro AS-1125HS-TNR' }, maxW: 400, options: SP5_ALL, def: 'epyc-9254' },
    mem: { slots: 24, options: DIMM_ALL, def: 'ddr5-32', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-480', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-7680', defQty: 4 },
    nets: [['ns', 'b3240', 1], ['oob', 'aiom-1g', 1], ['bmc', 'bmc', 1]],
    guide: 'ra-control-plane',
  },
  'platform-router': {
    label: 'Platform router', kind: 'infra', key: 'platform-router', group: 'Management stack',
    chassis: 'Supermicro AS-1125HS-TNR', stack: 'inferx',
    cpu: { sockets: 2, platforms: { sp5: 'Supermicro AS-1125HS-TNR' }, maxW: 400, options: SP5_ALL, def: 'epyc-9254' },
    mem: { slots: 24, options: DIMM_ALL, def: 'ddr5-16', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-480', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-7680', defQty: 2 },
    nets: [['ns', 'b3240', 1], ['edge', 'aiom-10g', 1], ['oob', 'aoc-1g', 1], ['bmc', 'bmc', 1]],
    guide: 'ra-control-plane',
  },
  'cpu-node': {
    label: 'CPU compute node', kind: 'infra', key: 'cpu-node', group: 'Management stack',
    chassis: 'Supermicro AS-1125HS-TNR', stack: 'inferx',
    cpu: { sockets: 2, platforms: { sp5: 'Supermicro AS-1125HS-TNR' }, maxW: 400, options: SP5_ALL, def: 'epyc-9254' },
    mem: { slots: 24, options: DIMM_ALL, def: 'ddr5-32', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-480', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-7680', defQty: 4 },
    nets: [['ns', 'b3240', 1], ['oob', 'aiom-1g', 1], ['bmc', 'bmc', 1]],
    guide: 'ra-control-plane',
  },
  'tier2': {
    label: 'Tier 2 block storage', kind: 'infra', key: 'tier2', group: 'Storage',
    chassis: 'Supermicro SSG-641E-E1CR36L', stack: 'inferx',
    // Intel only, and deliberately: the SSG-641E-E1CR36L is a Socket E
    // chassis, and Supermicro's AMD storage line has no 4U 36-bay 3.5"
    // equivalent to swap the board for. NVIDIA publishes no block-storage node
    // specification either, so there is no RA pulling it one way or the other.
    cpu: { sockets: 2, platforms: { lga4677: 'Supermicro SSG-641E-E1CR36L' }, maxW: 350, options: LGA4677_ALL, def: 'xeon-4510' },
    mem: { slots: 32, options: DIMM_ALL, def: 'ddr5-32', defQty: 16 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-480', defQty: 2, raid: 'RAID1' },
    data: { bays: 36, form: 'lff', options: LFF_ALL, def: 'sas-14t', defQty: 6 },
    nets: [['ns', 'b3140h', 1], ['oob', 'lom-10g', 1], ['bmc', 'bmc', 1]],
    guide: 'ncp-storage',
  },

  /* ----- NVIDIA reference-architecture control plane ----- */
  'cp-node': {
    label: 'Control-plane node', kind: 'infra', key: 'cp-node', group: 'Management stack',
    chassis: '2-socket x86 1U (RA Table 3)', stack: 'nvidia',
    // Enterprise RA Table 3 names both vendors outright — "Intel Xeon Gold
    // 6448Y or AMD EPYC 9354" — so both ranges are offered.
    cpu: { sockets: 2, platforms: { lga4677: '2-socket Intel x86 1U', sp5: '2-socket AMD EPYC 1U' }, maxW: 400,
      options: [...LGA4677_ALL, ...SP5_ALL], def: 'xeon-6448y' },
    mem: { slots: 32, slotsBySocket: { lga4677: 32, sp5: 24 }, options: DIMM_ALL, def: 'ddr5-32', defQty: 8 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-960', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-1920', defQty: 2 },
    nets: [['ns', 'b3220', 1], ['oob', 'aiom-1g', 1], ['bmc', 'bmc', 1]],
    guide: 'ra-control-plane',
  },

  /* ----- InferX GPU nodes ----- */
  'smc-b300': {
    label: 'HGX B300 node', kind: 'gpu', key: 'smc-b300', group: 'GPU nodes',
    chassis: 'Supermicro AS-8126GS-NB3RT', stack: 'inferx',
    cpu: { sockets: 2, platforms: { sp5: 'Supermicro AS-8126GS-NB3RT' }, maxW: 500, options: SP5_ALL, def: 'epyc-9555' },
    mem: { slots: 24, options: DIMM_ALL, def: 'ddr5-256', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-960', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'e1s', options: E1S_ALL, def: 'e1s-7680', defQty: 8 },
    nets: [['ew', 'cx8-800', 8], ['ns', 'b3240', 1], ['oob', 'aiom-1g', 1], ['bmc', 'bmc', 1]],
    guide: 'hgx-b300-node',
  },
  'smc-rtx6000': {
    label: 'RTX PRO 6000 node', kind: 'gpu', key: 'smc-rtx6000', group: 'GPU nodes',
    chassis: 'Supermicro AS-5126GS-TNRT2', stack: 'inferx',
    cpu: { sockets: 2, platforms: { sp5: 'Supermicro AS-5126GS-TNRT2' }, maxW: 500, options: SP5_ALL, def: 'epyc-9555' },
    mem: { slots: 24, options: DIMM_ALL, def: 'ddr5-64', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-480', defQty: 1 },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-7680', defQty: 2 },
    nets: [['ew', 'b3240', 1], ['ns', 'b3240', 1], ['oob', 'aiom-1g', 1], ['bmc', 'bmc', 1]],
    guide: 'rtxpro-node',
  },
  'smc-h200': {
    label: 'HGX H200 node', kind: 'gpu', key: 'smc-h200', group: 'GPU nodes',
    chassis: 'Supermicro AS-8125GS-TNHR', stack: 'inferx',
    cpu: { sockets: 2, platforms: { sp5: 'Supermicro AS-8125GS-TNHR' }, maxW: 500, options: SP5_ALL, def: 'epyc-9554' },
    mem: { slots: 24, options: DIMM_ALL, def: 'ddr5-64', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-480', defQty: 1 },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-7680', defQty: 2 },
    nets: [['ew', 'b3140h', 8], ['ns', 'b3240', 1], ['oob', 'aiom-1g', 1], ['bmc', 'bmc', 1]],
    guide: 'hgx-node',
  },
  'smc-l40s': {
    label: 'L40S node', kind: 'gpu', key: 'smc-l40s', group: 'GPU nodes',
    chassis: 'Supermicro AS-4125GS-TNRT2', stack: 'inferx',
    cpu: { sockets: 2, platforms: { sp5: 'Supermicro AS-4125GS-TNRT2' }, maxW: 500, options: SP5_ALL, def: 'epyc-9554' },
    mem: { slots: 24, options: DIMM_ALL, def: 'ddr5-32', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-480', defQty: 1 },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-7680', defQty: 2 },
    nets: [['ew', 'b3240', 1], ['ns', 'b3240', 1], ['oob', 'aiom-1g', 1], ['bmc', 'bmc', 1]],
    guide: 'l40s-node',
  },

  /* ----- NVIDIA reference-architecture GPU nodes -----
     The RA describes these as a minimum specification rather than a part
     number, so the default build is a named NVIDIA-Certified system that meets
     it and the option list is the rest of that system's processor range. */
  'nv-hgx-b300': {
    label: 'HGX B300 RA node', kind: 'gpu', key: 'nv-hgx-b300', group: 'GPU nodes',
    chassis: 'NVIDIA-Certified HGX B300 8-GPU (2-8-9-800)', stack: 'nvidia',
    cpu: { sockets: 2, maxW: 500,
      platforms: { lga4710: 'NVIDIA-Certified HGX B300 8-GPU, Intel build', sp5: 'NVIDIA-Certified HGX B300 8-GPU, AMD build (Supermicro AS-8126GS-NB3RT class)' },
      options: [...LGA4710_ALL, ...SP5_ALL], def: 'xeon-6767p' },
    mem: { slots: 32, slotsBySocket: { lga4710: 32, sp5: 24 }, options: DIMM_ALL, def: 'ddr5-64', defQty: 32 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-960', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'e1s', options: E1S_ALL, def: 'e1s-3840', defQty: 2 },
    nets: [['ew', 'cx8-800', 8], ['ns', 'b3240', 1], ['oob', 'aiom-1g', 3], ['bmc', 'bmc', 1]],
    guide: 'hgx-b300-node',
  },
  'nv-hgx-b200': {
    label: 'HGX B200 RA node', kind: 'gpu', key: 'nv-hgx-b200', group: 'GPU nodes',
    chassis: 'NVIDIA-Certified HGX B200 8-GPU (2-8-9-400)', stack: 'nvidia',
    cpu: { sockets: 2, maxW: 500,
      platforms: { lga7529: 'NVIDIA-Certified HGX B200 8-GPU, Intel build', sp5: 'NVIDIA-Certified HGX B200 8-GPU, AMD build' },
      options: [...LGA7529_ALL, ...SP5_ALL], def: 'xeon-6960p' },
    mem: { slots: 24, slotsBySocket: { lga7529: 24, sp5: 24 }, options: DIMM_ALL, def: 'ddr5-96', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-960', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-1920', defQty: 2 },
    nets: [['ew', 'b3140h', 8], ['ns', 'b3220', 1], ['oob', 'aiom-1g', 3], ['bmc', 'bmc', 1]],
    guide: 'hgx-node',
  },
  'nv-hgx-h200': {
    label: 'HGX H200 RA node', kind: 'gpu', key: 'nv-hgx-h200', group: 'GPU nodes',
    chassis: 'NVIDIA-Certified HGX H200 8-GPU (2-8-9-400)', stack: 'nvidia',
    cpu: { sockets: 2, maxW: 500,
      platforms: { sp5: 'NVIDIA-Certified HGX H200 8-GPU, AMD build', lga4677: 'NVIDIA-Certified HGX H200 8-GPU, Intel build' },
      options: [...SP5_ALL, ...LGA4677_ALL], def: 'epyc-9554' },
    mem: { slots: 24, slotsBySocket: { sp5: 24, lga4677: 32 }, options: DIMM_ALL, def: 'ddr5-64', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-960', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-1920', defQty: 2 },
    nets: [['ew', 'b3140h', 8], ['ns', 'b3220', 1], ['oob', 'aiom-1g', 3], ['bmc', 'bmc', 1]],
    guide: 'hgx-node',
  },
  'nv-hgx-h100': {
    label: 'HGX H100 RA node', kind: 'gpu', key: 'nv-hgx-h100', group: 'GPU nodes',
    chassis: 'NVIDIA-Certified HGX H100 8-GPU (2-8-9-400)', stack: 'nvidia',
    cpu: { sockets: 2, maxW: 500,
      platforms: { sp5: 'NVIDIA-Certified HGX H100 8-GPU, AMD build', lga4677: 'NVIDIA-Certified HGX H100 8-GPU, Intel build' },
      options: [...SP5_ALL, ...LGA4677_ALL], def: 'epyc-9554' },
    mem: { slots: 24, slotsBySocket: { sp5: 24, lga4677: 32 }, options: DIMM_ALL, def: 'ddr5-64', defQty: 24 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-960', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-1920', defQty: 2 },
    nets: [['ew', 'b3140h', 8], ['ns', 'b3220', 1], ['oob', 'aiom-1g', 3], ['bmc', 'bmc', 1]],
    guide: 'hgx-node',
  },
  'nv-rtxpro': {
    label: 'RTX PRO RA node', kind: 'gpu', key: 'nv-rtxpro', group: 'GPU nodes',
    chassis: 'NVIDIA-Certified RTX PRO 6000 8-GPU (2-8-5-200)', stack: 'nvidia',
    cpu: { sockets: 2, maxW: 500,
      platforms: { sp5: 'NVIDIA-Certified RTX PRO 6000 8-GPU, AMD build', lga4677: 'NVIDIA-Certified RTX PRO 6000 8-GPU, Intel build' },
      options: [...SP5_ALL, ...LGA4677_ALL], def: 'epyc-9555' },
    mem: { slots: 24, slotsBySocket: { sp5: 24, lga4677: 32 }, options: DIMM_ALL, def: 'ddr5-64', defQty: 16 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-960', defQty: 2, raid: 'RAID1' },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-1920', defQty: 2 },
    nets: [['ew', 'b3140h', 4], ['ns', 'b3220', 1], ['oob', 'aiom-1g', 3], ['bmc', 'bmc', 1]],
    guide: 'rtxpro-node',
  },
  'nv-ovx-l40s': {
    label: 'L40S RA node', kind: 'gpu', key: 'nv-ovx-l40s', group: 'GPU nodes',
    chassis: 'NVIDIA-Certified OVX L40S 8-GPU', stack: 'nvidia',
    cpu: { sockets: 2, maxW: 500,
      platforms: { lga4677: 'NVIDIA-Certified OVX L40S 8-GPU, Intel build', sp5: 'NVIDIA-Certified OVX L40S 8-GPU, AMD build (Supermicro AS-4125GS class)' },
      options: [...LGA4677_ALL, ...SP5_ALL], def: 'xeon-8480' },
    mem: { slots: 32, slotsBySocket: { lga4677: 32, sp5: 24 }, options: DIMM_ALL, def: 'ddr5-32', defQty: 32 },
    boot: { bays: 2, form: 'm2', options: M2_ALL, def: 'm2-1920', defQty: 1 },
    data: { bays: 8, form: 'u3', options: U3_ALL, def: 'u3-3840', defQty: 2 },
    nets: [['ew', 'b3140h', 4], ['ns', 'b3220', 1], ['oob', 'aiom-1g', 3], ['bmc', 'bmc', 1]],
    guide: 'l40s-node',
  },

  /* ----- appliances: bought as built, shown read-only ----- */
  'dgx-b300': {
    label: 'NVIDIA DGX B300', kind: 'gpu', key: 'dgx-b300', group: 'GPU nodes',
    chassis: 'NVIDIA DGX B300', stack: 'nvidia', fixed: true,
    fixedNote: 'A DGX system is a sealed NVIDIA appliance: its processors, memory and storage are part of the product specification and are not separately orderable.',
    nets: [['ew', 'cx8-800', 8], ['ns', 'b3240', 2], ['oob', 'aiom-1g', 1], ['bmc', 'bmc', 1]],
    guide: 'hgx-b300-node',
  },
  'nv-gb300-nvl72': {
    label: 'GB300 NVL72 rack', kind: 'gpu', key: 'nv-gb300-nvl72', group: 'GPU nodes',
    chassis: 'NVIDIA GB300 NVL72', stack: 'nvidia', fixed: true,
    fixedNote: 'An NVL72 is bought as a rack. Its 18 compute trays carry Grace superchips with soldered LPDDR5X, so CPU and memory are fixed by the tray design; storage is the tray\'s own E1.S complement.',
    nets: [['ew', 'cx8-800', 72], ['ns', 'b3240', 18], ['oob', 'aiom-1g', 54], ['bmc', 'bmc', 18]],
    guide: null,
  },
  'tier3': {
    label: 'Tier 3 NAS', kind: 'infra', key: 'tier3', group: 'Storage',
    chassis: 'Synology RS822RP+', stack: 'inferx', fixed: true,
    fixedNote: 'The Tier 3 NAS is an appliance with a soldered Ryzen V1500B and a fixed 4-bay complement; the RA populates it with 4 × 6 TB WD Red Pro.',
    nets: [['oob', 'lom-10g', 1], ['bmc', 'bmc', 1]],
    guide: null,
  },
};

/* The deployment the specs are being read against. The wizard sets it when the
   profile changes; the control-plane node's connectivity is the reference
   architecture's, and the three NVIDIA stacks do not agree on it — the
   Enterprise RAs specify a BlueField-3 B3220, the NVL72 RA four ConnectX-7
   200G, and RA-11337-001 a 400G in-band adapter that is not a BlueField. A
   single hard-coded B3220 was wrong on two of the three. */
const SERVER_CONTEXT = { profileKey: null };
function setServerContext(profileKey) { SERVER_CONTEXT.profileKey = profileKey; }

/* The adapter set a role presents, after the active profile has had its say. */
/* Memory channels per socket, by platform: EPYC SP5 and Xeon 6900P interleave
   12, the Xeon Socket E parts and Xeon 6700P interleave 8. */
const MEM_CHANNELS = { sp5: 12, lga7529: 12, lga4677: 8, lga4710: 8 };
const memChannels = (socket) => MEM_CHANNELS[socket] || 8;

/* DIMM slots a role's board carries, which is the socket's, not the role's: an
   SP5 board fills its 12 channels one deep for 24 slots across two sockets,
   while the 8-channel Xeon boards here run two deep for 32. Where a role has
   only one platform this is just `mem.slots`. */
function memSlots(r, cpuKey) {
  const by = r.mem && r.mem.slotsBySocket;
  const sock = cpuKey && SERVER_PARTS.cpu[cpuKey] ? SERVER_PARTS.cpu[cpuKey].socket : null;
  return (by && sock && by[sock]) || r.mem.slots;
}

/* The per-socket core count the role's reference architecture asks for. The
   guidelines are stated as a whole-node figure, and every role here is
   two-socket, so this is what a single processor has to bring. */
function guideCoresPerSocket(r) {
  const gk = roleGuide(r);
  const g = gk ? SPEC_GUIDES[gk] : null;
  return g && g.cores ? Math.ceil(g.cores / r.cpu.sockets) : 0;
}

/* A role's processor options, as the platform step offers them: everything its
   chassis families take that the chassis can also cool, split into the parts
   that satisfy its reference architecture and the parts that do not. Nothing
   is hidden — the InferX BOM's own 24-core EPYC 9254 is below the Enterprise
   RA and has to stay selectable for the reference build to be reproducible —
   but the split says which side of the line each part falls on. */
/* The vendor a socket belongs to, which is how the options are grouped: a
   reader picking a processor is choosing a platform first and a core count
   second, and on a role with two chassis families the two vendors' parts are
   not interchangeable. */
const SOCKET_VENDOR = { sp5: 'AMD EPYC', lga4677: 'Intel Xeon', lga4710: 'Intel Xeon', lga7529: 'Intel Xeon' };
const cpuVendor = (key) => SOCKET_VENDOR[(SERVER_PARTS.cpu[key] || {}).socket] || 'Other';

function cpuGroups(r) {
  const min = guideCoresPerSocket(r);
  const fits = (r.cpu.options || []).filter((k) => {
    const c = SERVER_PARTS.cpu[k];
    return c && (!r.cpu.maxW || c.w <= r.cpu.maxW || k === r.cpu.def);
  });
  const order = (a, b) => SERVER_PARTS.cpu[a].cores - SERVER_PARTS.cpu[b].cores
    || SERVER_PARTS.cpu[a].w - SERVER_PARTS.cpu[b].w
    || SERVER_PARTS.cpu[a].label.localeCompare(SERVER_PARTS.cpu[b].label);

  // Vendors in the order the role declares its platforms, so the family the
  // reference architecture's own build uses leads the list.
  const vendors = [];
  Object.keys(r.cpu.platforms || {}).forEach((sock) => {
    const v = SOCKET_VENDOR[sock];
    if (v && !vendors.includes(v)) vendors.push(v);
  });
  fits.forEach((k) => { const v = cpuVendor(k); if (!vendors.includes(v)) vendors.push(v); });

  const groups = [];
  const g = min ? SPEC_GUIDES[roleGuide(r)] : null;
  vendors.forEach((v) => {
    const mine = fits.filter((k) => cpuVendor(k) === v).sort(order);
    if (!mine.length) return;
    if (!min) { groups.push({ label: v, vendor: v, keys: mine }); return; }
    const within = mine.filter((k) => SERVER_PARTS.cpu[k].cores >= min);
    const below = mine.filter((k) => SERVER_PARTS.cpu[k].cores < min);
    // Vendor first, then whether the part satisfies the reference architecture,
    // because both matter and an HTML select cannot nest its groups.
    if (within.length) groups.push({ label: `${v} — meets ${g.name} (${min} cores per socket or more)`, vendor: v, within: true, keys: within });
    if (below.length) groups.push({ label: `${v} — below the ${min}-core-per-socket guideline`, vendor: v, within: false, keys: below });
  });
  return groups;
}

function roleChassis(r, cpuKey) {
  // With more than one platform the processor picks the system: an HGX B300 RA
  // node is a different NVIDIA-Certified chassis in its AMD build than in its
  // Intel one, so the chassis line follows the socket of the part chosen.
  const plats = r.cpu && r.cpu.platforms;
  if (plats) {
    const sock = cpuKey && SERVER_PARTS.cpu[cpuKey] ? SERVER_PARTS.cpu[cpuKey].socket : null;
    if (sock && plats[sock]) return plats[sock];
    if (r.key !== 'cp-node') return plats[Object.keys(plats)[0]] || r.chassis;
  }
  if (r.key !== 'cp-node') return r.chassis;
  const cp = SERVER_CONTEXT.profileKey && RA_PROFILES[SERVER_CONTEXT.profileKey]
    ? RA_PROFILES[SERVER_CONTEXT.profileKey].controlPlane : null;
  return (cp && cp.model) || r.chassis;
}

/* The control plane of each NVIDIA stack is written to a different table, so
   the guideline a role is measured against can be the profile's too. */
function roleGuide(r) {
  if (r.key === 'cp-node') {
    const cp = SERVER_CONTEXT.profileKey && RA_PROFILES[SERVER_CONTEXT.profileKey]
      ? RA_PROFILES[SERVER_CONTEXT.profileKey].controlPlane : null;
    if (cp && cp.guide) return cp.guide;
  }
  return r.guide;
}

function roleNets(r) {
  if (r.key !== 'cp-node') return r.nets;
  const cp = SERVER_CONTEXT.profileKey && RA_PROFILES[SERVER_CONTEXT.profileKey]
    ? RA_PROFILES[SERVER_CONTEXT.profileKey].controlPlane : null;
  if (!cp || !cp.nsAdapter) return r.nets;
  const key = /ConnectX-7/i.test(cp.nsAdapter) ? 'cx7-200'
    : /B3220/i.test(cp.nsAdapter) ? 'b3220' : 'ns-400';
  const a = NET_ADAPTERS[key];
  // The profile states the node's port count; the adapter states how many
  // ports one card carries, so the card count follows from the two.
  const qty = cp.nsAdapterQty || Math.max(1, Math.round((cp.nsPorts || 2) / a.ports));
  return [['ns', key, qty], ...r.nets.filter(([f]) => f !== 'ns')];
}

/* ---------- the live configuration ----------
   roleKey -> { cpu, dimm, dimmQty, boot, bootQty, data, dataQty }. Only keys
   the user has changed are held; anything absent falls back to the role's
   default, so the object being empty means "every server as its reference
   architecture builds it". */
const SERVER_CONFIG = {};

/* How many of a role the design runs, where that is a choice rather than a
   fixture: the NVIDIA control-plane node, whose reference architecture states
   a recommended count, and the InferX CPU compute node, which is the same
   thing on that stack. Empty means "as the reference architecture has it".
   roleKey -> count. */
const SERVER_COUNTS = {};

/* The count a role starts at, which for the control-plane node is whichever
   NVIDIA RA is selected. */
function defaultRoleCount(roleKey) {
  if (roleKey === 'cp-node') {
    const prof = SERVER_CONTEXT.profileKey && RA_PROFILES[SERVER_CONTEXT.profileKey];
    return (prof && prof.controlPlane && prof.controlPlane.count) || 8;
  }
  if (roleKey === 'cpu-node') return RACK.mgmtRack.cpuNodes;
  return null;
}

/* Bounds. The floor is a high-availability pair; the ceiling is what the rack
   will physically hold at the pitch the elevation draws them. */
function roleCountBounds(roleKey) {
  if (roleKey === 'cp-node') {
    const prof = SERVER_CONTEXT.profileKey && RA_PROFILES[SERVER_CONTEXT.profileKey];
    const ru = (prof && prof.controlPlane && prof.controlPlane.ru) || INFRA['cp-node'].ru;
    // The elevation starts at U46 under a patch panel and leaves a service
    // unit between nodes, so this is how many fit before the rack runs out.
    const pitch = ru + 1;
    return { min: 2, max: Math.floor((46 - ru) / pitch) + 1, def: defaultRoleCount(roleKey) };
  }
  if (roleKey === 'cpu-node') {
    return { min: 0, max: RACK.mgmtRack.cpuNodeCeilingU - RACK.tier2Units * INFRA.tier2.ru, def: RACK.mgmtRack.cpuNodes };
  }
  return null;
}

/* The configured count, clamped to what the rack will take. */
function roleCountOf(roleKey) {
  const b = roleCountBounds(roleKey);
  if (!b) return null;
  const want = SERVER_COUNTS[roleKey] == null ? b.def : SERVER_COUNTS[roleKey];
  return Math.max(b.min, Math.min(b.max, want));
}
const roleCountIsAdjustable = (roleKey) => !!roleCountBounds(roleKey);

function serverDefaults(roleKey) {
  const r = SERVER_ROLES[roleKey];
  if (!r || r.fixed) return null;
  const base = {
    cpu: r.cpu.def, dimm: r.mem.def, dimmQty: r.mem.defQty,
    boot: r.boot.def, bootQty: r.boot.defQty, data: r.data.def, dataQty: r.data.defQty,
  };
  // A control-plane node's reference build is its own RA's: the NVL72 RA asks
  // for 512 GB and a 2 x 7.68 TB cache where the Enterprise RA asks for 256 GB
  // and 4 TB, so the default follows the profile rather than one of the two.
  if (r.key === 'cp-node') {
    const cp = SERVER_CONTEXT.profileKey && RA_PROFILES[SERVER_CONTEXT.profileKey]
      ? RA_PROFILES[SERVER_CONTEXT.profileKey].controlPlane : null;
    if (cp && cp.build) Object.assign(base, cp.build);
  }
  return base;
}

/* The record a role draws its published power, weight and description from. */
function serverRecord(roleKey) {
  const r = SERVER_ROLES[roleKey];
  if (!r) return null;
  return r.kind === 'gpu' ? GPU_NODES[r.key] : INFRA[r.key];
}

/* Boot capacity as the operating system sees it. Every role here mirrors its
   boot pair, as the reference architectures specify, so two 480 GB devices are
   480 GB of boot and not 960 — summing them overstated the InferX management
   stack's boot by a factor of two against a guideline written in usable terms.
   Shared with `alignToGuide`, which has to raise the part against the same
   figure it is checked on. */
function bootUsable(r, part, qty) {
  if (!qty) return 0;
  return r.boot.raid === 'RAID1' && qty > 1 ? part.gb : part.gb * qty;
}

/* Component power and weight of one build, used both for the chosen parts and
   for the defaults so the two can be differenced. */
function buildParts(roleKey, cfg) {
  const r = SERVER_ROLES[roleKey];
  const P = SERVER_PARTS;
  const cpu = P.cpu[cfg.cpu] || P.cpu[r.cpu.def];
  const dimm = P.dimm[cfg.dimm] || P.dimm[r.mem.def];
  const boot = P.boot[cfg.boot] || P.boot[r.boot.def];
  const data = P.data[cfg.data] || P.data[r.data.def];
  const dimmQty = Math.max(0, Math.min(memSlots(r, cfg.cpu), cfg.dimmQty));
  const bootQty = Math.max(0, Math.min(r.boot.bays, cfg.bootQty));
  const dataQty = Math.max(0, Math.min(r.data.bays, cfg.dataQty));
  const w = cpu.w * r.cpu.sockets + dimm.w * dimmQty + boot.w * bootQty + data.w * dataQty;
  const kg = (dimm.kg || 0) * dimmQty + (boot.kg || 0) * bootQty + (data.kg || 0) * dataQty;
  return { cpu, dimm, dimmQty, boot, bootQty, data, dataQty, w, kg };
}

/* The full specification of one role as currently configured: what it is made
   of, what that totals to, and what it draws and weighs.

   Power and weight are the record's published figure moved by the difference
   between this build and the reference build. The published figure is a
   measured elevation or a vendor system rating and is not a component sum — it
   carries fans, PSU losses, the baseboard and the adapters — so differencing
   keeps that overhead intact instead of discarding it. */
function serverSpec(roleKey) {
  const r = SERVER_ROLES[roleKey];
  if (!r) return null;
  const rec = serverRecord(roleKey) || {};
  const base = { watts: rec.watts || 0, weightKg: rec.weightKg || 0 };
  const nets = (roleNets(r) || []).map(([fabric, adapter, qty]) => {
    const a = NET_ADAPTERS[adapter];
    return { fabric, adapter, qty, ...a, totalPorts: a.ports * qty };
  });

  if (r.fixed) {
    return {
      role: roleKey, def: r, rec, fixed: true, nets,
      cores: rec.cpuCores || null, ramGB: rec.ramGB || null,
      bootGB: rec.bootGB || null, dataGB: rec.localTB ? rec.localTB * 1000 : null,
      cpuLabel: rec.cpu || r.chassis, memLabel: rec.ramGB ? `${rec.ramGB} GB` : '—',
      bootLabel: rec.bootGB ? `${rec.bootGB} GB` : '—',
      dataLabel: rec.localTB ? `${rec.localTB} TB` : '—',
      watts: base.watts, weightKg: base.weightKg, deltaW: 0, deltaKg: 0, changed: false,
      checks: [], meets: true,
    };
  }

  const dflt = serverDefaults(roleKey);
  const cfg = { ...dflt, ...(SERVER_CONFIG[roleKey] || {}) };
  const b = buildParts(roleKey, cfg);
  const d = buildParts(roleKey, dflt);
  const deltaW = b.w - d.w;
  const deltaKg = b.kg - d.kg;

  const cores = b.cpu.cores * r.cpu.sockets;
  const ramGB = b.dimm.gb * b.dimmQty;
  const bootGB = bootUsable(r, b.boot, b.bootQty);
  const dataGB = b.data.gb * b.dataQty;

  const spec = {
    role: roleKey, def: r, rec, fixed: false, cfg, build: b, nets,
    cores, threads: b.cpu.threads * r.cpu.sockets, ramGB, bootGB, dataGB,
    cpuLabel: `${r.cpu.sockets} × ${b.cpu.label} ${b.cpu.cores}C/${b.cpu.threads}T`,
    memLabel: `${b.dimmQty} × ${b.dimm.label}`,
    bootLabel: b.bootQty ? `${b.bootQty} × ${b.boot.label}${r.boot.raid && b.bootQty > 1 ? ` (${r.boot.raid})` : ''}` : 'Not populated',
    dataLabel: b.dataQty ? `${b.dataQty} × ${b.data.label}` : 'Not populated',
    watts: Math.round(base.watts + deltaW),
    weightKg: Math.round((base.weightKg + deltaKg) * 100) / 100,
    baseW: base.watts, deltaW: Math.round(deltaW), deltaKg: Math.round(deltaKg * 100) / 100,
    changed: JSON.stringify(cfg) !== JSON.stringify(dflt),
  };
  spec.checks = serverChecks(spec);
  spec.meets = !spec.checks.some((c) => c.level === 'warning' || c.level === 'critical');
  return spec;
}

/* Capacity reads in the units the vendor quotes it in: memory in binary
   multiples, where 2,048 GB is the 2 TB an RA asks for, and disk in decimal,
   where a 7.68 TB drive is 7,680 GB. Mixing the two turned a 2 TB memory
   guideline into "2.05 TB". */
const fmtMem = (gb) => (gb >= 1024 ? `${(gb / 1024).toFixed(gb % 1024 ? 1 : 0)} TB` : `${gb} GB`);
const fmtDisk = (gb) => (gb >= 1000 ? `${(gb / 1000).toFixed(gb % 1000 ? 2 : 0)} TB` : `${gb} GB`);

/* One build measured against the NVIDIA guideline for its role, plus the
   chassis-level sanity the configurator cannot express through the controls
   (a DIMM population that is not a multiple of the channel count, a boot pair
   that has lost its mirror). */
function serverChecks(spec) {
  const r = spec.def;
  const out = [];
  const gk = roleGuide(r);
  const g = gk ? SPEC_GUIDES[gk] : null;

  if (g && g.cores) {
    const cmp = [
      ['cores', spec.cores, g.cores, (v) => `${v} cores`],
      ['memory', spec.ramGB, g.ramGB, fmtMem],
      ['boot', spec.bootGB, g.bootGB, fmtDisk],
      ['data cache', spec.dataGB, g.dataGB, fmtDisk],
    ];
    cmp.forEach(([what, have, want, fmt]) => {
      if (!want) return;
      if (have < want) {
        out.push({ level: 'warning', what, have, want,
          text: `${fmt(have)} is below the ${g.name} guideline of ${fmt(want)}.` });
      }
    });
  }

  // Memory channel population, from the socket of the part actually fitted:
  // EPYC SP5 and Xeon 6 interleave 12 channels per socket, the Xeon Socket E
  // parts 8. A population that is not one DIMM per channel per socket runs the
  // controller in a degraded interleave.
  const ch = memChannels(spec.build.cpu.socket);
  const perSocket = spec.build.dimmQty / r.cpu.sockets;
  if (spec.build.dimmQty && perSocket !== ch && perSocket !== ch / 2 && perSocket !== ch * 2) {
    out.push({ level: 'info', what: 'memory channels',
      text: `${spec.build.dimmQty} DIMMs across ${r.cpu.sockets} sockets is ${perSocket} per socket; this platform interleaves ${ch} channels per socket, so ${ch / 2 * r.cpu.sockets}, ${ch * r.cpu.sockets} or ${ch * 2 * r.cpu.sockets} DIMMs keeps every channel populated.` });
  }
  if (r.boot.raid && spec.build.bootQty === 1) {
    out.push({ level: 'info', what: 'boot redundancy',
      text: 'One boot device: the reference architecture mirrors the boot pair, so a single device leaves the operating system without redundancy.' });
  }
  if (spec.build.bootQty === 0) {
    out.push({ level: 'critical', what: 'boot', text: 'No boot device is configured.' });
  }
  if (spec.build.dimmQty === 0) {
    out.push({ level: 'critical', what: 'memory', text: 'No memory is configured; the system will not post.' });
  }

  // Connectivity. Every server has to reach the networks its role sits on; the
  // fabric sizing and the cable schedule are counted from these adapters.
  if (g && g.nets) {
    Object.entries(g.nets).forEach(([fabric, need]) => {
      const have = spec.nets.filter((n) => n.fabric === fabric);
      const ports = have.reduce((a, n) => a + n.totalPorts, 0);
      const gb = Math.max(0, ...have.map((n) => n.gb));
      if (ports < need.ports) {
        out.push({ level: 'warning', what: `${NET_FABRICS[fabric].label} ports`,
          text: `${ports} port${ports === 1 ? '' : 's'} on the ${NET_FABRICS[fabric].label.toLowerCase()}; ${g.name} calls for ${need.ports}.` });
      } else if (gb < need.gb) {
        out.push({ level: 'warning', what: `${NET_FABRICS[fabric].label} speed`,
          text: `${gb} Gb on the ${NET_FABRICS[fabric].label.toLowerCase()}; ${g.name} calls for ${need.gb} Gb.` });
      }
    });
  }
  return out;
}

/* The smallest build in a role's own option lists that satisfies every figure
   its guideline publishes, leaving the reference build's choice in place
   wherever that already clears the bar. This is what the "align to NVIDIA
   guideline" action applies. Returns null for a role with no guideline or one
   already meeting it. */
function alignToGuide(roleKey) {
  const r = SERVER_ROLES[roleKey];
  if (!r || r.fixed || !roleGuide(r)) return null;
  const g = SPEC_GUIDES[roleGuide(r)];
  if (!g || !g.cores) return null;
  const dflt = serverDefaults(roleKey);
  const cfg = { ...dflt, ...(SERVER_CONFIG[roleKey] || {}) };
  const P = SERVER_PARTS;

  // CPU: keep the current part if it already clears the core count. Otherwise
  // take the processor the reference architecture names by model where the
  // chassis will accept it — aligning to the guideline means the part NVIDIA
  // specifies, not merely one that reaches its core count — and fall back to
  // the lowest-TDP qualifying option where it will not.
  if (P.cpu[cfg.cpu].cores * r.cpu.sockets < g.cores) {
    // Only parts the chassis can take and cool, and — so that aligning never
    // silently swaps the platform — the socket already fitted where that
    // socket has something that clears the bar.
    const cur = P.cpu[cfg.cpu];
    const pool = cpuGroups(r).flatMap((x) => x.keys);
    const able0 = pool.map((k) => P.cpu[k]).filter((c) => c.cores * r.cpu.sockets >= g.cores);
    const same = able0.filter((c) => c.socket === cur.socket);
    const able = same.length ? same : able0;
    const fit = able.filter((c) => c.nvRec).sort((a, b) => a.w - b.w)[0]
      || able.sort((a, b) => a.w - b.w || a.cores - b.cores)[0];
    if (fit) cfg.cpu = r.cpu.options.find((k) => P.cpu[k] === fit);
  }
  // Memory: keep the module count, raise the module size if it is short.
  if (P.dimm[cfg.dimm].gb * cfg.dimmQty < g.ramGB) {
    const fit = r.mem.options.map((k) => P.dimm[k]).filter((m) => m.gb * cfg.dimmQty >= g.ramGB)
      .sort((a, b) => a.gb - b.gb)[0];
    if (fit) cfg.dimm = r.mem.options.find((k) => P.dimm[k] === fit);
  }
  // Boot and data: keep the device count, raise the capacity.
  // Capacity is measured the way the spec measures it, so a mirrored boot pair
  // is raised against its usable capacity rather than the sum of the pair.
  const have = (kind, part, qty) => (kind === 'boot' ? bootUsable(r, part, qty) : part.gb * qty);
  const raise = (kind, pool, qtyKey, want) => {
    const cur = P[kind][cfg[kind]];
    if (!want || have(kind, cur, cfg[qtyKey]) >= want) return;
    const fit = pool.map((k) => P[kind][k]).filter((x) => have(kind, x, cfg[qtyKey]) >= want).sort((a, b) => a.gb - b.gb)[0];
    if (fit) cfg[kind] = pool.find((k) => P[kind][k] === fit);
  };
  raise('boot', r.boot.options, 'bootQty', g.bootGB);
  raise('data', r.data.options, 'dataQty', g.dataGB);
  return cfg;
}

/* ---------- what the rest of the engine asks for ----------
   The facility roll-up, the layout and the bill of materials call these rather
   than reading `watts`/`weightKg` off the record, so a configuration change
   flows through power, weight, the rack elevations and the BOM at once. A key
   with no role definition (a switch, a CDU, a patch panel) falls through to
   the record's own figure. */
function specWatts(key, fallback) {
  if (!SERVER_ROLES[key]) return fallback;
  const s = serverSpec(key);
  return s ? s.watts : fallback;
}
function specWeight(key, fallback) {
  if (!SERVER_ROLES[key]) return fallback;
  const s = serverSpec(key);
  return s ? s.weightKg : fallback;
}
/* Every role a given deployment actually contains, in display order. */
function rolesFor({ stack, nodeKey }) {
  return Object.keys(SERVER_ROLES).filter((k) => {
    const r = SERVER_ROLES[k];
    if (r.kind === 'gpu') return k === nodeKey;
    return r.stack === stack;
  });
}

if (typeof window !== 'undefined') {
  Object.assign(window, { fmtMem, fmtDisk, SERVER_COUNTS, defaultRoleCount, roleCountBounds, roleCountOf, roleCountIsAdjustable, setServerContext, SERVER_CONTEXT, roleNets, roleChassis, cpuGroups, cpuVendor, guideCoresPerSocket, memSlots, memChannels, roleGuide, bootUsable, SERVER_PARTS, SERVER_ROLES, SERVER_CONFIG, SPEC_GUIDES, NET_ADAPTERS, NET_FABRICS,
    serverSpec, serverDefaults, alignToGuide, specWatts, specWeight, rolesFor });
}
