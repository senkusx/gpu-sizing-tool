# InferX Solution Sizing Tool

A browser-based sizing tool for NCP-aligned AI infrastructure, delivered as a
guided journey:

- **Guided journey** (`index.html`, the default page) — compute → workload →
  networking → storage → results, with the full solution summary, rack
  elevations, inter-rack cabling and a fabric topology on the final page. The
  compute step's federation tier picks the stack: an InferX tier (Edge,
  Regional, Core) sizes on the InferX reference designs, an NVIDIA option
  sizes on one of NVIDIA's published reference architectures (see
  [NVIDIA reference architectures](#nvidia-reference-architectures)). It then
  chooses between a reference workload profile and manual parameters; on the
  reference profile the workload step is skipped and greyed out in the
  stepper. The results export as CSV, as a printable PDF, or as a PowerPoint
  deck.

Two standalone calculators remain in the tree for direct use but are not linked
from the guided journey:

- **Compute** (`compute.html`) — LLM inference sizing against the InferX reference
  architecture: model, precision, concurrency and latency SLOs in; GPUs, nodes,
  racks, power, weight, cooling load and fabric out.
- **Storage** (`storage.html`) — WEKA cluster sizing from a usable-capacity and/or
  throughput target, with the full BOM, memory budget and constraint checks.
- **Rack elevations** (`rack.html`) — to-scale front and rear views with fabric
  cabling.

## Running it

No build step. The only dependency is a vendored copy of PptxGenJS
(`vendor/`, MIT) that the PowerPoint export loads on first use, alongside the
deck's brand artwork (`assets/`); nothing is fetched from the network. Open
`index.html` in a browser.

```
open index.html
```

The guided journey is the default page everywhere — opened from the filesystem,
from any static server, or from the container, `/` lands on it. The storage
calculator has its own filename, so `/storage.html` still goes straight there.

To serve it instead: `python3 -m http.server` and visit `http://localhost:8000`.

## Deploying with Docker

```bash
docker compose up -d          # http://localhost:8080
docker compose down
```

Or without compose:

```bash
docker build -t ghcr.io/senkusx/inferx-sizing-tool:latest .
docker run -d --name inferx-sizing-tool -p 8080:8080 \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /var/cache/nginx:uid=101,gid=101 \
  --tmpfs /var/run:uid=101,gid=101 \
  --tmpfs /tmp:uid=101,gid=101 \
  ghcr.io/senkusx/inferx-sizing-tool:latest
```

The image is nginx-alpine serving the static files — about 76 MB, no build step.
It runs as the unprivileged `nginx` user (uid 101) on port 8080 with a read-only
root filesystem and all capabilities dropped, so the tmpfs mounts above are
required: nginx needs writable scratch for its temp paths and pid file, and they
must be owned by uid 101 or it will fail to start.

`GET /healthz` returns `200 ok` for load balancer and orchestrator probes; the
image also declares a `HEALTHCHECK` against it.

### Published images

Pushes to `main` and `v*` tags build and publish to GitHub Container Registry:

```bash
docker pull ghcr.io/<owner>/weka-sizing-tool:latest
```

CI builds **linux/amd64 and linux/arm64**. This matters: building on an Apple
Silicon workstation produces an arm64-only image that will not run on a typical
x86_64 server, so let CI publish rather than pushing a local build.

Publishing uses the Actions-provided `GITHUB_TOKEN`, so no personal access token
or repository secret is required.

To put it behind TLS, terminate at your reverse proxy or ingress and forward to
port 8080. Nothing in the app calls out to the network and no sizing data ever
leaves the browser, so it is safe to run on an internal network without egress.

## Files

| File | Purpose |
|---|---|
| `index.html` / `wizard.css` / `wizard.js` | Guided journey — the default page; six steps, one of them skippable |
| `storage.html` / `app.js` | Storage sizing page — form wiring, rendering, charts, CSV export |
| `styles.css` | Theme tokens, layout, light/dark, print |
| `catalog.js` | WEKA platform constants + Lenovo/HPE/generic hardware catalog |
| `sizing.js` | Sizing engine — pure functions, no DOM |
| `rack.html` / `rack.css` / `rack.js` | Rack elevation page — front/rear views and fabric cabling |
| `compute.html` / `compute-app.js` | Compute sizing page |
| `ra-rack.js` | Reference-architecture rack elevations, deployment overview, cabling plan and fabric topology |
| `pptx-export.js` / `vendor/pptxgen.bundle.js` / `assets/deck-assets.js` | PowerPoint export of the results page, the PptxGenJS library it uses, and the template artwork |
| `xlsx-export.js` | Bill-of-materials export — a dependency-free .xlsx writer (ZIP + XML by hand) |
| `compute-catalog.js` | GPUs, GPU nodes, fabric, rack rules, InferX and NVIDIA deployment profiles and model catalog |
| `server-specs.js` | Configurable server specifications — component catalogue, per-role chassis limits, NVIDIA guidelines |
| `inference.js` | Inference sizing engine — pure functions, no DOM |
| `Dockerfile` / `nginx.conf` / `security-headers.conf` | Container image and web server config |
| `docker-compose.yml` | One-command deployment |
| `.github/scripts/verify-nvidia-ra.js` | Checks the engine against the NVIDIA RAs' published switch and cabling counts and the InferX elevation totals |

`sizing.js` has no DOM dependency, so it can be required and tested directly in Node.

## Tests

```bash
node .github/scripts/verify-engine.js
node .github/scripts/verify-nvidia-ra.js
```

These check the engine against figures published by third parties rather than
against our own arithmetic: both Lenovo LP1698 worked examples, the four WEKA
benchmark measurements, and the two SPECstorage reference configurations
reproducing their own published results. The second script checks the
facility engine against every switch count NVIDIA publishes in its reference
architectures (the table under [NVIDIA reference
architectures](#nvidia-reference-architectures)), the cabling quantities in
their endpoint tables, and the InferX elevations' own rack totals, and builds
and plans the rack layout of every profile. If one fails, the tool has started
disagreeing with the documentation it claims to implement.

CI additionally builds the image and asserts that every asset is served, that a
missing path returns 404, that security headers survive the per-location cache
block, and that nginx is not running as root.

## Compute sizing

`compute.html` sizes GPU inference for the InferX reference architecture, or
for one of the NVIDIA reference architectures when an NVIDIA tier is chosen.

**Reproduced exactly from the reference architecture** (these are regression-tested):

| Check | Value |
|---|---|
| 128x B300 fleet power | 1,779,072 W |
| Air-cooled compute rack (2 nodes + Tier 2) | 28,986 W |
| Liquid-cooled compute rack (8 nodes + CDU + Tier 2) | 115,380 W |
| Air-cooled RTX PRO 6000 rack (2 nodes + Tier 2) | 14,246 W |
| Air-cooled rack without Tier 2 | 27,798 W |
| Liquid-cooled rack without Tier 2 | 114,192 W |
| Tier 2 block storage units | 3 (3,564 W total) |
| 2 MW design, air-cooled | 64 compute + 2 fabric + 1 storage + 1 mgmt = 68 racks |
| 2 MW design, liquid-cooled | 16 compute racks |

The rack rules come straight from the elevations: two GPU nodes per air-cooled
rack, eight plus a 250 kW CDU per liquid-cooled rack, and **exactly three Tier 2
block storage units** across the whole design — at the base of the first three
compute racks, not one per rack. That last rule is what makes the MEP sheet quote
two different compute-rack totals (28,986 W for the racks that carry one, 27,798 W
for the rest), and getting it wrong overstates the 2 MW design by 72 kW. At 27.8 kW an air-cooled
B300 rack sits well inside a 415 V/60 A 3-phase feed, so the two-node limit is a
thermal and fabric choice rather than a power one.

**Sizing basis.** The tool works in both directions:

- **Workload-driven** — state the concurrency and latency target, get the fleet.
- **Fixed GPU nodes** — state the fleet, get the concurrency and throughput it carries.
- **Fixed compute racks** — same, expressed in racks. Cooling decides the nodes per
  rack (2 air, 8 DLC), so 8 racks is 16 nodes air-cooled and 64 liquid-cooled.

Node count and rack count are two views of one quantity, so only the field matching
the chosen basis is editable. The other stays visible but locked, showing what it
works out to — pick 8 racks and the node field reads 16 air-cooled or 64 on DLC.
Under workload-driven sizing both are locked and show the solved fleet.

Capacity-led sizing flags a shortfall when the fixed fleet cannot carry the stated
load, and errors outright when it is too small to hold even one model replica.

**Inference model.** Memory is exact arithmetic from the model architecture:

```
weights  = params x bytes_per_param x 1.05
KV/token = 2 x layers x kv_heads x head_dim x bytes
```

Throughput is a roofline. Decode streams the active weights once per step plus
the KV of every sequence in the batch, so

```
step_time    = (active_weights + batch x kv_per_seq) / effective_bandwidth
per_user_tps = 1 / step_time
cluster_tps  = batch / step_time
```

Per-user speed therefore falls as batch grows while aggregate throughput rises —
the trade-off the TPOT service level pins down. Prefill is compute bound at
2 FLOPs per active parameter per prompt token. MoE models keep every expert
resident for capacity but only stream the active set, so `activeParams` drives
throughput while `params` drives memory.

**Switch power** is the figure that matches how the design is cabled. NVIDIA
publishes switch power two ways — "typical with passive cables (ATIS)" and,
where it gives one, a populated-with-optics figure — and the gap is large
because an 800G transceiver burns around 18 W: the SN5610 is 900 W on passive
cables and **2.08 kW with 64 optical modules**, the QM9700 747 W passive
against a 1,720 W maximum with active cables. Every data-plane cage in these
designs carries a transceiver, so the data-plane switches are costed at the
populated figure and the passive one is kept alongside it in the catalogue.
Transceiver power is therefore counted once, inside the switch, and never
added again from the optics BOM. The out-of-band SN2201 is RJ45 copper, so its
98 W is already the populated figure.

**What is derived rather than read from the documents:**

- **Fabric switch counts** follow the oversubscription rules with switch cages
  treated as 2x400G because the BOM specifies MMS4X00-NS twin-port transceivers.
  Both planes default to 1:1 non-blocking; at the RA's own settings (east-west
  1:1, north-south 4:1) the 2 MW design derives 29 SN5610 against the 32 in the
  elevation, and 13 SN2201 against 12 — close, but not a substitute for a real
  port map.
- **Transport per plane.** The guided journey's networking step runs each data
  plane on Ethernet (Spectrum-4 SN5610, 64 cages) or InfiniBand (Quantum-2
  QM9700, 32 cages). The choice drives switch counts, fabric power and weight,
  the rack elevations, and the transceiver part numbers in the optics BOM.
  Quantum-2's lower cage count is why an InfiniBand compute fabric lands at
  roughly twice the switches. Out-of-band stays 1GbE copper either way.
- **GPU spec sheet.** The results and compute pages carry a per-GPU
  specification card — memory capacity and bandwidth, FP32 vector, FP16/BF16,
  FP8, INT8 and FP4 tensor rates, tensor and CUDA core counts, interconnect and
  TDP — plus the fleet aggregate of each. FP16 is shown at the BF16 tensor rate,
  and INT8 at the FP8 rate except where a part publishes its own INT8 figure:
  Blackwell Ultra trades INT8 for NVFP4 and runs it far slower than its FP8
  rate (the HGX B300 publishes 3 POPS sparse across 8 GPUs, against 72 POPS for
  the B200).

  Every tensor figure is the **dense** rate, halved from the source wherever
  that source quotes sparsity — which is most of them. NVIDIA's 8-GPU HGX
  columns give the B300 144 | 108 PFLOPS FP4 (sparse | dense) and the B200
  144 | 72, both on 72 PFLOPS FP8 and 36 PFLOPS FP16/BF16 sparse; the RTX PRO
  6000 Blackwell Server Edition's headline 4 PFLOPS FP4 / 2 PFLOPS FP8 /
  1 PFLOPS FP16 are likewise sparsity rates, footnoted "effective FP4 TOPS with
  sparsity" on the datasheet. Note that the ladder is not uniform: FP8 is twice
  BF16 everywhere, but FP4 is twice FP8 on Blackwell and **three times** FP8 on
  Blackwell Ultra, which is the whole point of that part. The verification
  script checks both ratios, since a rate accidentally left at its sparsity
  figure breaks them.

  SM, CUDA-core and tensor-core counts are published for the Hopper, Ada and
  RTX Blackwell parts but not for the HGX Blackwell ones, so those read *not
  published* rather than carrying an invented figure. Vector FP32 is published
  for all of them (600 TFLOPS per 8-GPU Blackwell baseboard).
- **Serving efficiency** — 80% of peak bandwidth in decode, 55% of dense peak in
  prefill. These are the least-grounded numbers in the tool: they reflect typical
  vLLM/TensorRT-LLM behaviour, not a benchmark of this architecture. Validate
  throughput before committing to an SLA.
- **WEKApod networking is two dual-port ConnectX-7 cards**, not one. A single
  card is a single point of failure for a storage node every GPU in the fleet
  reads from, so each node carries a redundant pair: **four 400G links** into
  the north-south fabric, plus **two 1GbE management ports** on the
  out-of-band fabric. The two ports on one card share a PCIe Gen5 x16 uplink,
  so the fourth link buys resilience and path diversity rather than four times
  the throughput — WEKA's own per-node performance figures are unchanged by it,
  and the modelled ceiling stays CPU-bound as before.
- **WEKApod models** come from WEKA's own NeuralMesh material and are sized natively
  rather than approximated. The catalogue covers Nitro (14 × 7.68 / 15.36 / 30 TB E3.S
  TLC, 1U) and Prime 2118 / 2218 (18 × 30–120 TB eTLC or QLC). The engine reproduces
  WEKA's published configurations exactly:

  | 8 × WPS155-SAE | Model | WEKA |
  |---|---|---|
  | Usable capacity | 484 TB | 484 TB |
  | Read / write | 568 / 256 GB/s | 568 / 256 GB/s |
  | Read / write IOPS | 18M / 4.7M | 18M / 4.7M |
  | Rack units | 8U | 8U |
  | Power / weight | 6.4 kW / 74 kg | ~6.4 kW / ~74 kg |

  8 × WPS175-SAE likewise gives 968 TB. All of it falls out of the same published
  net-capacity formula at WEKA's 5D+2P+1VHS setting. Note the RA sheet's 31.2 kg per
  node is roughly 3× WEKA's own figure; the tool uses WEKA's.
- **DGX B300** is 10U, 14.5 kW, 168 kg with 12x 3.3 kW PSUs, per NVIDIA's datasheet.
  Its system memory figure is the published maximum.
- **GB300 NVL72** is a rack-scale option (`nv-gb300-nvl72`, flagged `rackScale`)
  and runs on its own track through the facility model: one system per rack,
  liquid-cooled only, no Tier 2 or chassis-style CDU inside the compute rack.
  InferX publishes no design of its own for it, so it is offered only under
  the NVIDIA NVL72 AI Factory profile and not on the Edge, Regional or Core
  tiers. The record is the RA's 2-4-5-800 tray with Supermicro's
  SRS-GB300-NVL72 as the representative NVIDIA-Certified build, and reconciles
  three vendor documents:

  | Figure | Source | Value |
  | --- | --- | --- |
  | Rack composition | Supermicro SRS-GB300-NVL72 datasheet | 18 × 1U ARS-121GL-NB3-LC compute trays (4× B300 + 2× Grace each), 9 × 1U NVLink switch trays, 8 × 1U 33 kW power shelves (6 × 5.5 kW, 4+4 for 132 kW usable) |
  | Operating power | Supermicro / NVIDIA NVL72 AI Factory RA | 132–140 kW / up to 142 kW — the tool uses 140 kW |
  | Rack | Supermicro / Lenovo LP2357 | 48U MGX, 2236 × 600 × 1068 mm; 29 kg per compute tray, 17 kg per switch tray, 185 kg empty |
  | Populated weight | NVIDIA site-preparation guidance | ~1,360 kg (3,000 lb) — not a datasheet figure; the Lenovo component weights plus busbar, manifold and cable cartridges land in the same place |
  | Networking per tray | NVIDIA NVL72 AI Factory RA | 4 × ConnectX-8 800G OSFP (east-west), one dual-port BlueField-3 B3240 (storage and in-band, converged), tray BMC + DPU BMC on the in-rack OOB pair |
  | Per rack | derived | 72 × 800G east-west, 36 × 400G north-south, 2 × SN2201 in the rack |
  | Memory | NVIDIA / Lenovo | 288 GB HBM3e per GPU (20.7 TB per rack), 960 GB LPDDR5X per tray (17.3 TB per rack) |

  The GPU record (`gb300`) is deliberately separate from the HGX `b300`: NVIDIA's
  GB300 NVL72 datasheet gives 1,440 | 1,080 PFLOPS FP4 (sparse | dense), 720 PFLOPS
  FP8, 360 PFLOPS BF16, 24 POPS INT8, 6 PFLOPS FP32 and 576 TB/s across 72 GPUs,
  i.e. 15 PFLOPS dense FP4 per GPU, where the HGX B300 datasheet gives 144 | 108
  PFLOPS FP4 across 8, i.e. 13.5. INT8 carries its own published figure (167 TOPS
  dense per GPU) rather than the FP8 rate — Blackwell Ultra trades INT8 for NVFP4.
  All 72 GPUs form one NVLink domain (130 TB/s), so the sizing treats tensor
  parallelism up to 64 as in-domain and never charges it the east-west fabric.

  Cooling is where the rack-scale options differ, and each is a Supermicro
  DCBBS datasheet figure:

  | Option | Unit | Capacity | Draw | Weight (dry) | Footprint |
  | --- | --- | --- | --- | --- | --- |
  | In-row CDU (default) | LCS-SCDU-1K3LR001, one per 8 racks | 1.8 MW | 20 kW | 1,560 kg | 1000 × 1300 × 2000 mm floor cabinet |
  | In-rack CDU | LCS-SCDU-250LP4002, 4U in the rack's spare units | 250 kW | 3 kW | 114 kg | — |
  | L2A sidecar | LCS-SCDU-200AR001, one beside every rack | 200 kW | 19 kW | 1,145 kg | 1100 × 1415 × 2000 mm floor cabinet, no facility water |

  Floor cabinets are counted and drawn as rack positions. There is no Tier 2
  on the NVL72 track — the NVIDIA RA has none — and the RA's twelve
  management nodes take a control-plane rack of their own.
- **DLC chassis height** — the liquid-cooled B300 is a 4U chassis, which is the only
  way the liquid elevation fits eight nodes plus a CDU into 48U. Air-cooled is 8U.
- **H200 and L40S node power** is rolled up from BOM components rather than stated
  as a total; their weights are estimates. B300 and RTX PRO 6000 node figures are
  stated directly in the elevations.

## NVIDIA reference architectures

The federation tier select carries a second group of profiles that size on
NVIDIA's own published reference architectures rather than the InferX designs.
Each profile follows its document's node pattern (NVIDIA's C-G-N-B notation:
CPU sockets, GPUs, network adapters, average east-west GbE per GPU), scalable
unit, tested range, fabric rules, converged-fabric port allocations and control
plane, and offers only the node the RA is written for:

| Profile | RA document | Node pattern | Scalable unit / tested range | Node offered (representative NVIDIA-Certified system) |
|---|---|---|---|---|
| NVIDIA NVL72 AI Factory | [NVL72 AI Factory RA](https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/index.html) | 2-4-5-800 tray | 1 rack of 18 trays; 1–8 racks | GB300 NVL72 (Supermicro SRS-GB300-NVL72) |
| NVIDIA HGX AI Factory — HGX B300 | [HGX AI Factory RA](https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory/latest/index.html) | 2-8-9-800 | 4 nodes; 4–128 nodes | 8× B300, 8× ConnectX-8 800G, B3240 (Supermicro SYS-822GS-NB3RT: 15 kW, 119 kg) |
| NVIDIA HGX AI Factory — HGX B200 / H200 / H100 | [HGX AI Factory RA (H100/H200/B200)](https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory-h100-h200-b200/latest/index.html) | 2-8-9-400 | 4 nodes; 4–128 nodes | 8× B3140H 400G, B3220 2×200G (B200: Supermicro SYS-A22GA-NBRT-G1, 13.4 kW, 133 kg; H200/H100: AS-8125GS-TNHR, 10,040 W) |
| NVIDIA RTX PRO AI Factory | [RTX PRO AI Factory RA](https://docs.nvidia.com/enterprise-reference-architectures/rtx-pro-ai-factory/latest/index.html) | 2-8-5-200 | 4 nodes; 4–32 nodes | 8× RTX PRO 6000, 4× B3140H, B3220 (Supermicro AS-5126GS-TNRT2, 6,979 W) |
| NVIDIA L40S Enterprise RA (superseded) | withdrawn; RTX PRO AI Factory rules applied | 2-8-5-200 | 4 nodes; 4–32 nodes | 8× L40S, 4× BF-3 400G, BF-3 2×200G (Supermicro SYS-421GE-TNRT OVX 3.0, 3,850 W) |
| NVIDIA DGX SuperPOD — DGX B300 | [DGX SuperPOD RA, RA-11337-001](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300/latest/index.html) | DGX B300 | 64 nodes; 1–16 SUs | NVIDIA DGX B300 (AC version) |

**Nodes.** The Enterprise RAs define a node as a pattern and a minimum
specification (cores per socket, system memory, NVMe) and publish no node
power or weight, so each record carries the RA's node definition and takes its
physical figures from a named NVIDIA-Certified system that implements the
pattern — preferring Supermicro's NVIDIA-endorsed "AI Factory" builds of the
same RA, which publish a node maximum and a four-node rack figure (HGX B300:
15 kW per node, 60 kW per rack; HGX B200: 13.4 kW, 53.6 kW). Where the InferX
catalog's Supermicro chassis already carries the RA's adapters it is reused;
the RTX PRO node adds the RA's three extra B3140H at the InferX BOM's 150 W
nameplate. Every `src` says which. NVIDIA's L40S Enterprise RA has been
withdrawn from its index in favour of the RTX PRO AI Factory; the profile is
kept, marked superseded, on the successor's 2-8-5-200 rules with an OVX 3.0
L40S system as the node.

**Rack composition.** The Enterprise RAs leave nodes per rack to the available
rack power. Every NVIDIA chassis profile racks one four-node scalable unit per
air-cooled rack, which is how Supermicro's NVIDIA-endorsed builds and the DGX
SuperPOD RA (four DGX per rack, over 50 kW) rack them; DLC stays eight per
rack with a CDU where the node has a liquid-cooled sibling. There is no Tier 2
block storage — that is InferX's — and the management rack becomes a
control-plane rack of the RA's management nodes (eight for the Enterprise
RAs, twelve for the NVL72, seven for the SuperPOD), on a representative 1U
two-socket server since the RAs specify the node but not its power. WEKApod
stays as the storage, as an NVIDIA-Certified Storage partner, and a design
check compares its throughput with the RA's floor of 12.5 Gb/s per GPU.

**Fabric.** The networking step's controls are locked on an NVIDIA profile —
every RA is Spectrum-X Ethernet, non-blocking, twin-port 2×400G — and the
engine sizes the fabric by the RA's own rules instead:

- *Enterprise* (HGX, RTX PRO, L40S): a rail-optimised leaf–spine with 64-cage
  switches treated as 128 × 400G. A ConnectX-8 800G port contributes two links
  (the dual-plane fabric), a B3140H one. The converged north-south fabric
  carries the nodes' BlueField-3 pair plus the RA's own allocations for
  storage, customer uplinks, support servers and SN2201 uplinks (Table 7/8 of
  each RA, in 800G cages), collapses to a leaf pair with an inter-switch link
  when those fit, and at 16 nodes or fewer is folded into the compute leaves
  altogether. SN2201 uplinks land on the converged fabric, so there is no OOB
  spine.
- *NVL72*: four leaves per plane per pair of racks, each wired to one GPU
  position in every tray and deliberately underpopulated (36 downlinks of
  128), spines per plane rounded up to an even count; two SN2201 in every rack.
- *SuperPOD*: a dual-plane compute fabric built for the whole 64-node scalable
  unit even when fewer nodes are installed, as the RA requires; a storage
  fabric with DGX-side leaves at 64 down / 48 up (the RA's "near 4:3") and
  storage-side leaves at 1:1; an in-band fabric of its own; one SN2201 per
  DGX rack. The storage and in-band fabrics are reported together on the
  north-south plane.

The engine reproduces every switch count the RA documents publish
(`node .github/scripts/verify-nvidia-ra.js`):

| RA | Design point | East-west leaf + spine | North-south leaf + spine |
|---|---|---|---|
| HGX B300 | 32 / 64 / 128 nodes | 8+4 / 16+8 / 32+16 | 2+0 / 4+2 / 8+4 |
| HGX H100/H200/B200 | 32 / 64 / 128 nodes | 4+2 / 8+4 / 16+8 | 2+0 / 2+0 / 6+4 |
| RTX PRO | 16 / 32 nodes | 2+0 (consolidated) / 2+0 | — / 2+0 |
| NVL72 | 1 … 8 racks | 12, 12, 24, 24, 32, 32, 44, 44 switches | 2+0 / 4+2 / 7+4 at 2 / 4 / 8 racks |
| DGX SuperPOD | 1 / 2 / 4 / 8 / 16 SUs | 16+8 / 32+16 / 64+32 / 128+64 / 256+128 | — |

Out-of-band is counted the RA's way — six 1 GbE links per HGX or RTX PRO node,
71 per NVL72 rack, single-homed — but for every device. The RAs' CAT6 tables
cover the compute nodes alone, so the switches' management ports, the control
plane and the storage nodes can put the SN2201 count one above the RA's
node-only figure at a fully populated design point (5 against 4 at 32 HGX
nodes); the fabric card says so.

## The management stack

The InferX management rack is not a rack of management-only boxes. The RA BOM
puts an **NVIDIA BlueField-3 B3240 dual-port 400GbE DPU**
(`900-9D3B6-00CN-AB0`) in every platform server, platform router and CPU
compute node, and a single-port **B3140H** (`900-9D3D4-00EN-HA0`) in each Tier 2
storage chassis. Those land on the north-south fabric alongside the GPU nodes
and the WEKApods, so they are counted in the leaf budget, drawn with cables
leaving the rack, and listed in the cable schedule — fourteen north-south ports
from the management rack and one per Tier 2 chassis. The Tier 3 NAS, the OOB
firewalls, the serial switch and the break-glass unit carry no DPU: their
uplinks are the out-of-band fabric and the 10GbE firewall pair, which the RA
cables separately.

On the NVIDIA profiles the equivalent is the RA's own control-plane node — and
the three NVIDIA stacks do not agree on what goes in it, so the adapter is
carried on each profile rather than fixed:

| Stack | Control-plane adapter | Ports | Source |
|---|---|---|---|
| HGX B300/B200/H200/H100, RTX PRO, L40S | NVIDIA BlueField-3 B3220 DPU | 2 × 200G | Enterprise RA, Table 3 |
| GB300 NVL72 | NVIDIA ConnectX-7 200G single-port | 4 × 200G | NVL72 AI Factory RA, Table 2 |
| DGX SuperPOD | 400GbE in-band adapter — **not** a BlueField | 2 × 400G | RA-11337-001 §6.1 and Table 9.1 |

The DGX SuperPOD entry is deliberately not described as a BlueField: RA-11337-001
§6.1 gives the connectivity (Base Command Manager HA on in-band and OOB,
Kubernetes and Slurm login on in-band and storage, every device on OOB at 1 GbE
for IPMI/Redfish) and its Table 9.1 quotes a 400G transceiver for the
control-plane nodes, `980-9I51S-F4NS00` — a different part from the
BlueField-3's `980-9I693-F4NS00`. A single hard-coded B3220 was wrong on two of
the three stacks.

**What the facility buys is what the elevation draws.** The roll-up and the
drawing are separate pieces of code that must agree on rack counts, and they
came apart in three ways that only a sweep across the whole size range showed:
the roll-up reserved units at the top of a fabric rack that the drawing then
filled, so a design could be costed for a rack more than it drew; the InferX
management rack drew an out-of-band leaf pair that the fabric rack also drew
and the roll-up also bought space for; and the edge tier, which has no fabric
rack, drew its leaves past the bottom of the management rack instead of opening
one. The reserved units are now named once in `RACK` and honoured by both, the
management rack's pair counts towards the fabric's own leaf total rather than
being additional to it, and the edge tier opens a fabric rack as soon as its
fabric grows a spine tier or outgrows the units the rack has spare. The
verification script sweeps 5,580 configurations — every profile × node ×
size × cooling × storage size — asserting that the rack count bought equals the
rack count drawn, that every switch and storage node bought is drawn exactly
once, and that nothing lands outside 48U.

**Every north-south endpoint is counted the same way in three places**: the port
budget the leaves are sized from, the cable plan the rear elevation draws, and
the optics BOM. `fabric.nsPorts` is every endpoint — GPU nodes, management
stack or control plane, Tier 2 and storage — with `nsNodePorts`,
`nsMgmtPorts`, `nsTier2Ports` and `nsStoragePorts` giving the split. The
verification script asserts, for every profile, that the number of sources the
drawing cables equals the number the fabric was sized for.

**The adapter is named on the elevation, not just drawn.** A fitted card carries
a green faceplate stripe and its part and port speed beneath it. On an 8U GPU
node an adapter is obvious from its size; on a 1U platform server a fitted
BlueField sat beside an empty PCIe slot looked like a second blank, which is how
the management stack's DPUs came to read as absent even though they were being
drawn and cabled all along.

**Each stack quotes its own part numbers.** The transceiver, fibre and copper
lines are selected through an `OPTIC_SETS` table rather than a single global
list, so an InferX design is priced on the parts the InferX RA BOM names
(`MMS4X00-NS400`, `MMS1X00-NS400` `980-9I068-00NM00`, the MFP7E30 fibre
assemblies, `MFA1A00-C005`) and an NVIDIA design on the parts its reference
architecture names. The verification script asserts the two sets never leak
into each other.

## Server specifications

Every server in the solution is configurable on **processor, memory and disk**
on the journey's **Platform** step — GPU nodes, platform servers, platform
routers, CPU compute nodes, control-plane nodes and Tier 2 storage — and each
build is checked against the specification NVIDIA publishes for that role.

**The defaults are the reference architecture's own build.** An untouched
journey reproduces the published elevations exactly; the verification script
asserts that every role's default draw and weight equal the record it came
from, and that the InferX GPU nodes' core count, memory, boot device and data
cache agree with the node catalogue. Changing a part moves power and weight by
the *difference* between the chosen part and the default one, so the measured
elevation figure — which carries fans, PSU losses, the baseboard and the
adapters, and is not a component sum — stays intact rather than being replaced
by an invented total. Component wattages are the RA BOM's own where the BOM
gives them (6.6 W per 32 GB DDR5 RDIMM, 3.9 W per 480 GB M.2, 20 W per 7.68 TB
U.3, 150 W per BlueField-3) and the vendor's published active power elsewhere.

**What NCP actually specifies.** NVIDIA's NCP material — the [NCP Software
Reference Guide](https://docs.nvidia.com/ncx/ncp-software-reference-guide/latest/software-reference-guide.html)
and [NVIDIA Requirements for AI
Clouds](https://docs.nvidia.com/dsx/ncp/nvidia-requirements-for-ai-clouds/introduction)
— is written as outcomes rather than parts: it states that compliance is judged
on whether an implementation satisfies the stated outcome, and refers hardware
detail to an access-controlled reference. It publishes no processor, memory or
disk figures to check a build against. The prescriptive specifications NVIDIA
*does* publish are in the Enterprise Reference Architectures and the NVL72 AI
Factory RA, and those are the guideline used here — the same ones every
NVIDIA-Certified system carrying these roles is built to.

| Role | Guideline | Published minimum |
|---|---|---|
| Platform server, platform router, CPU compute node, control-plane node | Enterprise RA, Table 3 | 2 × 32C (**Intel Xeon Gold 6448Y or AMD EPYC 9354**), 256 GB DDR5, 1 TB NVMe boot, 4 TB NVMe data, BlueField-3 B3220, 1 Gb RJ45 BMC |
| NVL72 management node | NVL72 AI Factory RA, Table 2 | 2 × 32C, 512 GB (8 × 64 GB), 2 × 960 GB M.2 RAID1 boot, 2 × 7.68 TB NVMe data cache, 4 × ConnectX-7 200G |
| HGX B300 node | HGX B300 Enterprise RA (2-8-9-800) | ≥ 48 cores/socket (56 recommended), ≥ 2 TB system memory, ≥ 1 TB NVMe/socket + 1 TB boot |
| HGX H100/H200/B200 node | HGX Enterprise RA (2-8-9-400) | ≥ 48 cores/socket, ≥ 1.5 TB system memory, ≥ 1 TB NVMe/socket + 1 TB boot |
| RTX PRO node | RTX PRO Enterprise RA (2-8-5-200) | ≥ 7 cores/GPU (48/socket recommended), ≥ 128 GB/GPU (1 TB recommended), 1 TB NVMe/socket + boot |
| Tier 2 block storage | none published | NVIDIA specifies no block-storage node; the build is the InferX RA BOM's own |

**Processors: the whole range, on both vendors.** NVIDIA's RAs specify a
minimum per socket, not a processor vendor, and the NVIDIA-Certified systems
that implement each one ship in AMD and Intel builds — the Enterprise RA's
control-plane node names both outright ("Intel Xeon Gold 6448Y or AMD EPYC
9354"). Every role therefore offers the full two-socket-capable AMD EPYC
catalogue — 43 parts across Genoa, Genoa-X, Bergamo, Turin and Turin Dense,
from the 8-core 9015 to the 192-core 9965 — alongside the Intel range its
chassis family takes. Cores, threads, base clock and default TDP are
AMD's own, from the EPYC 9004 and 9005 Series Processors data sheets; the Intel
figures are Intel ARK's. The single-socket P suffixes (9354P, 9454P, 9554P,
9654P, 9355P, 9455P, 9555P, 9655P) are excluded: every role here is two-socket,
so offering them would build a machine that cannot be ordered.

The list is grouped rather than filtered. Parts that clear the role's
per-socket guideline sit under "Within *<the RA>*"; the rest sit under "Below
the *n*-core-per-socket guideline" and stay selectable, because the InferX RA
BOM's own 24-core EPYC 9254 is one of them and the reference build has to stay
reproducible. Each option carries its cores, clock and TDP, and parts above the
chassis's own TDP ceiling are not offered at all.

| Role | Platforms offered | Per-socket guideline |
|---|---|---|
| Platform server, router, CPU compute node | AMD SP5 | 32 cores (Enterprise RA Table 3) |
| Control-plane node | AMD SP5 **or** Intel Socket E | 32 cores |
| HGX B300 RA node | Intel Xeon 6700P **or** AMD SP5 | 48 cores |
| HGX B200 RA node | Intel Xeon 6900P **or** AMD SP5 | 48 cores |
| HGX H200 / H100 RA node | AMD SP5 **or** Intel Socket E | 48 cores |
| RTX PRO / L40S RA node | AMD SP5 **or** Intel Socket E | 28 cores (7 per GPU) |
| InferX GPU nodes | AMD SP5 | per that node's RA |
| Tier 2 block storage | Intel Socket E only | none published |

Tier 2 is Intel-only deliberately: the SSG-641E-E1CR36L is a Socket E chassis
and Supermicro's AMD storage line has no 4U 36-bay 3.5" equivalent to swap the
board for, and NVIDIA publishes no block-storage node specification pulling it
either way.

**Processor options are grouped by vendor first**, because a reader picking a
processor is choosing a platform before a core count, and on a role with two
chassis families the two vendors' parts are not interchangeable. An HTML select
cannot nest its groups, so each vendor appears twice where the role has a
guideline — "AMD EPYC — meets *<the RA>*", then "AMD EPYC — below the
*n*-core-per-socket guideline" — with the vendors in the order the role
declares its platforms, so the family the reference architecture's own build
uses leads the list.

**The processor picks the platform.** Where a role has two chassis families the
choice is also a system choice, so the chassis line follows the socket of the
part fitted, and so do the board's DIMM slots and memory channels: EPYC SP5 and
Xeon 6900P interleave 12 channels per socket across 24 slots, the Xeon Socket E
and 6700P parts 8 channels across 32. Taking an HGX B300 RA node from its Intel
default to an EPYC 9575F therefore drops it from 32 DIMM slots to 24 — 2 TB of
memory becomes 1.5 TB, and the card says so against the RA's 2 TB minimum until
the module size is raised.

**Where the InferX designs sit against that.** The comparison is reported, not
quietly closed. The InferX RA BOM builds its management stack on two 24-core
EPYC 9254s and a mirrored pair of 480 GB boot devices, so the platform servers,
platform routers and CPU compute nodes come in **16 cores short of the Enterprise
RA's two 32-core sockets and 40 GB short of its 1 TB of boot**. That gap shows on
each card, is repeated in the results page's design checks, and is pinned by the
verification script so a change to the BOM defaults cannot pass silently. The
GPU nodes and the Tier 2 chassis clear their guidelines as built.

**Align every server to the NVIDIA guideline** raises each short role to the
processor the reference architecture *names by model* where the socket accepts
one — EPYC 9354 or Xeon Gold 6448Y — or else the lowest-power part in that
chassis's own option list that clears the figure, and leaves everything already
over the bar alone. On the InferX core tier that is +160 W per server and takes
the management rack from the RA's 7,826 W to 8,946 W. **Reset to the reference
build** puts every role back, and the facility returns to the published figures
exactly.

**How many control-plane nodes is a sizing decision, not a fixture.** Each
NVIDIA reference architecture states a recommended count — eight for the
Enterprise RAs, twelve for the NVL72 RA, seven for the DGX SuperPOD RA — and
the InferX tiers' equivalent is the CPU compute node, which the RA elevation
has two of. All of them are adjustable on the platform step, starting at that
recommendation, with the figure named beside the control so a design that
departs from it does so visibly. The floor is a high-availability pair; the
ceiling is what the rack physically holds at the pitch the elevation draws them
(23 one-U nodes, 15 of the DGX SuperPOD's two-U class, 10 CPU compute nodes
above whatever else stands at the bottom of the management rack). Changing the
count moves power, weight, north-south ports, the out-of-band cable schedule
and the elevation together; **Reset to the reference build** puts it back, and
the published 7,826 W management rack returns exactly. On the edge tier, which
stacks its data-plane leaves in the management rack, adding CPU compute nodes
can leave the fabric no room — at which point it opens a fabric rack rather
than drawing switches over the top of the nodes.

**Connectivity is not a free choice.** The fabric sizing and the cable schedule
are counted from each role's adapters, so those are fixed at what the reference
architecture specifies and shown read-only: which of the five networks
(east-west compute, north-south in-band, external/edge, out-of-band management,
BMC) the server reaches, with what adapter and at what port speed. The
verification script asserts that every role's declared north-south and
east-west ports match the figures the fabric is actually sized from, and that
every server has an out-of-band path.

**Appliances are read-only.** A DGX B300, a GB300 NVL72 rack, a WEKApod and the
Tier 3 Synology are bought as built; their cards show the fixed specification
and say why it is fixed. A WEKApod is chosen by model on the storage step,
which is where its processor, memory and drives are decided.

The engine reads server power and weight through `specWatts`/`specWeight`
rather than off the catalogue record, so a change on the platform step flows
into the facility roll-up, the rack elevations, the design checks and both the
on-page and exported bills of materials at once. The verification script checks
that reconciliation under a changed build as well as a default one.

## Optics and cabling

The results page carries a transceiver, fibre and copper BOM with NVIDIA part
numbers, derived from the design's own port totals using the per-link ratios in
NVIDIA RA-11337-001 Table 9.1. Feeding that document's own 4 SU / 256-node
configuration back into the model reproduces its quantities exactly:

| 2,048 compute ports | Model | NVIDIA |
|---|---|---|
| Node-side 800G transceivers | 2,048 | 2,048 |
| Twin-port transceivers, leaf to node | 2,048 | 2,048 |
| Node-leaf fibre | 4,096 | 4,096 |
| Twin-port transceivers, leaf to spine | 4,096 | 4,096 |
| Leaf-spine fibre | 4,096 | 4,096 |

Every transceiver in the BOM is a shipping part: the switch-side twin-port OSFP
(MMS4X00-NS / MMA4Z00-NS-T, `980-9I510-F4NS00` in Ethernet trim) is an **800G**
module carrying 2 × 400G over two MPO-12/APC connectors, not a 1.6T one, and
nothing in the catalogue quotes a 1.6T optic.

**Every count comes from one definition.** Out-of-band links used to be
counted two different ways — the facility model doubled every device, the
cabling BOM used three per node and one per box — so a design could be quoted
a leaf count its own cable schedule disagreed with. Both now call the same
function: a GPU node contributes what its record says (three per DGX chassis
per RA-11337-001 Figure 4.9, six per HGX or RTX PRO node, 71 per NVL72 rack),
a WEKApod its two management ports, a switch its one management port, a
platform or control-plane server two for BMC and host management, a CDU
cabinet one. The verification script asserts the CAT6 line equals that count
and that the leaf total was sized from it.

Storage and the control plane also take switch-side cages of their own, which
the RA lists as separate lines ("switch to Storage", "switch to control-plane
B3220 DPUs") rather than folding into the node figure — an 800G cage takes two
400G WEKApod ports or four 200G control-plane ports, which is how the model
lands on the RA's own figure of 4 control-plane cages.

Cable counts are double the port counts because a twin-port OSFP cage carries two
links — an 800G ConnectX-8 port is two 400G links on the dual-plane fabric. The
same ratios stated per link (half a twin-port transceiver and one fibre per
link, one twin-port and one fibre per link on the leaf–spine tier) reproduce
the NVIDIA Enterprise RA cabling tables for 400G nodes too: an HGX H200 node's
eight B3140H ports are eight links, so 32 nodes take 256 node-side 400G
transceivers, 128 switch-side twin-ports and 256 fibres, as that RA's Table 7
lists them, and a 200G BlueField-3 B3220 pair lands four to a cage. Each plane's
switch-side optics follow its transport — Ethernet (F4) or InfiniBand (00NS)
part variants — while in-band management stays Ethernet regardless. Cable *lengths* are not
sized — the listed fibre is the RA's 30 m part, and a real order needs a length
schedule from the floor plan.

## Rack elevations

`rack.html` turns the sized cluster into to-scale front and rear rack elevations,
drawn in the flat technical style of VisioCafe / VSD Grafx stencils: dark
charcoal faceplates with drive carriers, bezel LEDs and perforated vent zones on
the front; light grey chassis with PSUs, exhaust perforation and PCIe port cages
on the rear. The rear view overlays the storage fabric cabling, splitting each
node's ports across a redundant top-of-rack switch pair.

It reads the same configuration the sizing page writes to `localStorage`, so the
two stay in sync — edit the sizing inputs and the rack redraws. Opened on its
own it falls back to the default configuration.

Proportions are deliberate rather than decorative. A 2.5" carrier is about 15 mm
across on a 450 mm usable face, so ten of them cover roughly a third of the
width and the remaining bezel is drawn as vent. Switch orientation follows
Lenovo LP1698, which specifies port-side-exhaust switches mounted ports-to-rear —
so the switches show their PSU/fan side on the front elevation and their port
side on the rear, which is where the cabling lands.

Device colours are fixed rather than themed: a rack elevation is a drawing of
physical hardware, so it looks identical in light mode, dark mode and on paper.

This is a planning sketch, not a wiring schedule — port-level assignment, cable
lengths, breakout cabling, PDU placement and out-of-band management are all left
to detailed design.

### Stencil style

**The elevation is drawn to scale.** A 19" rack face is 482.6 mm wide and a
rack unit is 44.45 mm, so at the 530 px the face occupies here one unit is
48.8 px — the drawing uses 49. That makes a 48U rack about four and a half
times taller than it is wide, as a real one is, and it is what lets a device
be recognised from its proportions alone: a 1U switch is as flat against the
face as it is in the room. It also leaves room for the detail that identifies
a part, which a squashed elevation cannot carry. The racks stand in a
horizontally scrolling row and scale down to fit the page when printed.

The device faces follow the VisioCafe stencil conventions the rest of the
industry draws racks in, so an elevation reads the way a datacentre engineer
expects. Switches carry their port field with the `1/2 ▲▼ 3/4` numbering the
Spectrum faceplates print, the status icon column at the left edge, and the
management jacks, model name and vendor mark at the right; RJ45 jacks are
drawn as a light shell around a dark cavity with the gold contact row and the
latch slot, and transceiver cages as a dark cage with the insert bar and lane
dots. Power supplies carry a vent grid, the IEC C14 inlet with its three pins,
a pull handle and the red/blue release latch; fan modules are the wide
hex-mesh cartridges with a pull handle that the switch rears actually show.
Drive carriers are the dark bodies with vent slots, the coloured release latch
and the activity LEDs that a populated bay shows, labelled with the media they
hold. Compute nodes follow their own chassis: the Supermicro GPU SuperServer
is a silver chassis with the vendor name down each ear, the vented top band
with the GPU tray's slot cutouts, the large hex-mesh intake and the E1.S bay
row; the DGX its black chassis and gold lattice bezel. On the rear a power
supply and a fan module keep their real size whatever the chassis height, so
the PSU bank stays a band along the bottom and the fan wall fills the middle
rather than either stretching to fill the face.

Colours are fixed rather than themed, because a rack elevation is a drawing of
physical hardware: it looks identical in light mode, dark mode and on paper.

### Racks and fabric on the guided results page

The guided journey draws the whole solution in the same stencil idiom
(`ra-rack.js`), with each device laid out the way its real front and rear are
organised rather than as a generic box. The faces are assembled from a small
set of primitives — fan modules with finger guards, PSUs with latch, inlet,
grille and pull handle, upright 2.5" and flat 3.5" carriers, RJ45 jacks,
transceiver cages, PCIe brackets, control panels and onboard I/O clusters —
and the layout tags every device with what it carries:

- Supermicro GPU SuperServer: the GPU tray's hex-mesh intake over a 24-slot
  bay row with the configured NVMe populated and the rest blanked; on the rear,
  eight low-profile NIC slots (one SuperNIC per GPU pair, or one dual-port DPU
  with the rest blanked), the fan wall, and the CPU tray's I/O and BlueField-3
  DPU beside the PSU bank.
- DGX B300: the gold lattice bezel per RA-11337-001; on the rear, four OSFP at
  each top corner, BMC and LAN between, a DPU at each side of the slot row, the
  fans and the two-row PSU bank.
- GB300 NVL72: the rack as NVIDIA and Supermicro draw it — the OOB SN2201 pair
  and four power shelves at the top, ten compute trays, the nine NVLink switch
  trays in the middle, eight more trays, the other four shelves, and (in-rack
  option only) the 4U CDU below. A compute tray carries all its I/O on the
  front — E1.S bank, four ConnectX-8 OSFP cages, the BlueField-3's two QSFP112
  cages and BMC, the tray BMC and console — because its rear is busbar clip,
  coolant quick-disconnects and the NVLink cable cartridge. The cabling view
  therefore draws NVL72 racks front-on. Switch trays show the NVSwitch badges
  and management jacks; power shelves the six PSUs and the PMB's BMC jack.
  In-row and sidecar CDUs draw as full-height floor cabinets with the
  controller display, the heat-exchanger grille (a fan wall on the sidecar) and
  the supply/return couplings.
- NVIDIA Spectrum and Quantum switches: dark chassis with the green accent, a
  management block, and the cages in groups of four — two rows above sixteen
  ports — or, on the SN2201, 48 RJ45 in two rows of four groups of six with the
  QSFP28 uplinks at the right; the fan side shows a PSU at each end and five
  fan modules.
- WEKApod: dark chassis with the WEKA badge; E3.S blades across a 1U face,
  U.2 carriers in two rows on the 2U Prime 2218; PSUs, I/O and the ConnectX-7
  card on the rear.
- Platform: the 12-bay Hyper 1U with eight drives populated, the 36-bay LFF
  chassis (24 front, 12 rear), the four-bay Synology, the firewall and console
  server with their RJ45 and SFP banks, the CDU with its display and coolant
  couplings, the break-glass DIN shelf, and the LC patch panel and media
  converter.

The card has three parts:

- **Deployment overview** — every rack in the row as a small schematic, devices
  coloured by class (GPU node, switch per plane, WEKApod, platform, CDU), with
  identical racks collapsed into a run and badged with their count. Clicking a
  rack scrolls the detailed elevation into view. The detailed racks stand side
  by side in a horizontally scrolling row on screen and wrap on paper. On an
  NVIDIA profile the InferX management rack gives way to a control-plane rack
  of the RA's management nodes, the compute racks carry four nodes (an
  in-rack SN2201 on the DGX SuperPOD), and at the RA's consolidated design
  points the fabric rack holds "converged" leaves that carry both planes.
- **Rear + cabling** — cabling is planned once over the whole layout
  (`RARack.planLinks`) rather than per rack, because in the reference designs
  the switches live in a dedicated fabric rack. A GPU or storage rack's ports
  run into the cable channel and out of the top of the rack as a trunk labelled
  with count, speed and destination ("16 × 800G east-west → Switch fabric
  rack 1"); the fabric rack shows the matching trunk arriving at each leaf
  ("64 × 800G east-west into each leaf ← 16 GPU racks") and dashed uplinks from
  every leaf to a bar across the spine group. A rack that carries its own leaves
  — the management rack's OOB pair, or every plane in the edge design — cables
  its devices to them directly. Per-device port counts are the same ones the
  rear faces draw: east-west and north-south ports per GPU node from the node
  catalog, two data ports and a BMC per WEKApod, a BMC per platform box.
- **Fabric topology** — one leaf–spine panel per plane (east-west, north-south,
  out-of-band) with the switch counts, transport, oversubscription, per-leaf
  uplink and downlink port budget, and the racks that hang off each plane. The
  fan-out is schematic; the numbers come from the same oversubscription rules
  as the switch count.

### Bill-of-materials export

**Export BOM** on the guided journey's top bar downloads the bill of materials
on its own as an Excel workbook (`inferx-bill-of-materials-<date>.xlsx`), for
the case where what is wanted is the parts list rather than the whole story.
Three sheets:

- **Bill of Materials** — every purchasable hardware line: item, model,
  quantity, unit and extended power, unit and extended weight, and the
  configuration it was sized at. Quantities and figures are real numbers, so
  the sheet sorts, filters and totals as a spreadsheet should.
- **Optics and Cabling** — the transceiver, fibre and copper lines with their
  NVIDIA part numbers, grouped by fabric, followed by the order total by part
  number, which is the list a buyer actually works from.
- **Server Specifications** — one row per server role as configured on the
  platform step: processor, core count, memory, boot and data media, every
  network it lands on with the adapter and port speed that reaches it, unit and
  extended power, and the NVIDIA guideline it was checked against together with
  the result. This is the sheet a vendor is asked to quote against.

All three sheets open with a short block naming the design the parts belong to —
reference architecture, node, cooling, fabric, storage, racks, total load — so
a sheet that has been mailed onward still says what it is a BOM of.

Component figures follow one source per family, because the export reads the
*difference* between two builds rather than an absolute: processor cores,
threads, base clock and TDP are AMD's and Intel's own data sheets, NVMe power is
Micron's published 7450 PRO figures, SAS power and weight are Western Digital's
Ultrastar data sheet, and the DDR5 ladder is scaled from the reference BOM's own
32 GB datum. Mixing a vendor number for one capacity with an estimate for the
next would invent a difference that is not there.

A part is described by what it *is*, not by which node types across the
catalogue happen to use it. The optics BOM's role column used to enumerate the
latter, which put "H200 east-west" in the cable schedule of a B300 design; what
a part is doing in *this* design is the row's own note, and the verification
script asserts that no transceiver or cable names a GPU model.

The rows come from the same `hardwareBOM` and `cablingBOM` functions the
results page renders, so the spreadsheet cannot drift from the page; the
verification script asserts that the hardware lines sum to the facility card's
own total IT load and weight on every profile. Lines that are already inside
another — the GPUs inside a node, the trays and power shelves inside an NVL72
rack — carry their quantity but no extended total, and say so.

The writer (`xlsx-export.js`) has no dependencies: an `.xlsx` is a ZIP of XML
parts, so it writes both by hand, in about as much code as the CSV export
beside it. Entries are stored rather than deflated, which every spreadsheet
application opens and which keeps the file readable by eye.

### PowerPoint export

**Export PPTX** on the guided journey's top bar downloads the results as a
16:9 deck (`inferx-solution-sizing-<date>.pptx`) in the Radian Arc "InferX
Platform Model" sales-enablement template. The template was measured from that
deck rather than approximated: the full-bleed teal wash, the wordmark and its
square, the Space Mono kicker, the Inter Tight title over a bold teal
strapline, the short lime-to-teal rule, the content band, the bold takeaway
line and the `CONFIDENTIAL` / `[n]` footer all sit at the template's own
positions, sizes and colours, and the title slide carries the template's photo
mosaic, app icon and coloured squares. The artwork is embedded in
`assets/deck-assets.js` so the export works from `file://` as well as a server.

The deck opens with the title slide and a "Solution at a Glance" slide in the
template's five-card layout (compute, networking, storage, facility,
performance), then follows the results page card by card — solution summary,
performance tiles, memory, GPU specification, fabric, storage, capacity
waterfall, protection trade-off, bills of materials, cluster totals and design
checks — with a strapline and takeaway written for each, long tables continuing
across slides with the header repeated. The racks card becomes the deployment
overview, front elevations, rear elevations with cabling, and one fabric
topology slide per plane, rendered from the SVGs at 2× so they stay sharp when
zoomed. Source citations are left out: there is no sources slide, and notes
that only cite where a figure came from are dropped.

The generator is PptxGenJS (`vendor/pptxgen.bundle.js`, MIT), loaded on the
first export so the page itself stays light. Everything happens in the
browser; no sizing data leaves the machine. The template's typefaces (Inter
Tight, Space Mono, Roboto Mono) are named in the file, so machines with them
installed render the deck as designed and others substitute.

## What is derived vs modelled

**Taken straight from published documentation** (trust these):

- **Net capacity** — `Net = Raw × (FD − spares)/FD × D/(D+P) × 0.9`, published in Lenovo
  Press LP1698. The engine reproduces both of that document's worked examples exactly
  (96 TB and 498 TB).
- **Per-server memory** — WEKA's published component formula, including the process
  layout rule (one drive process per SSD up to six, then one per two SSDs; two compute
  processes per drive process).
- **Constraints** — protection scheme ranges (D 3–16, P 2–4, stripe 5–20), stripe width
  ≤ failure domains, the 25%-of-cluster stripe advisory, 8000:1 storage-to-RAM ratio,
  30 TB max drive, 19 cores per container, per-vendor minimum cluster sizes.

**Anchored to audited third-party benchmarks**:

- **SPECstorage 2020 projection** — the eight published bare-metal WEKA submissions
  (HPE+WEKA on 12x Alletra 4110, and Samsung+WekaFS on 6x Dell R7515, each across
  AI_IMAGE / GENOMICS / EDA_BLENDED / VDA) are stored verbatim in `SPEC_SUBMISSIONS`,
  normalised per node and scaled by node count.

  This is deliberately *not* a fitted curve. Normalising the two references per node
  shows their ratio swinging from **0.90x (VDA) to 2.50x (GENOMICS)** — two data points
  cannot support a transfer function, so the tool reports the spread as a range and
  shows both reference configurations. Feeding either reference's own hardware back in
  reproduces its published result exactly.

**Modelled** (planning estimates, not guarantees):

- **Peak sequential throughput** — per node, the lowest of the network, drive and CPU
  ceilings; writes additionally pay the `D/(D+P)` parity cost. Calibrated against WEKA's
  published eight-node benchmark to within ~2% on read GB/s, write GB/s and both IOPS
  figures. This is a best case for large sequential IO and sits *above* the SPEC
  projection, which is expected — SPEC workloads are mixed read/write with metadata.
- **Power, rack space and switch counts** — typical figures per platform, not measured.

Coefficients live in `WEKA.perf` in `catalog.js` if you want to retune them. The CPU
term (`gbPerSecPerCore`) used to be the least constrained — no benchmark in the
original set was CPU-bound. WEKApod supplies an anchor: 71 GB/s per node on 32 WEKA
cores needs at least 2.2 GB/s per core, so the old 1.6 was capping the model below
hardware WEKA ships. It is now 2.4, which leaves the eight-node benchmark drive-bound
exactly as before and puts the modelled ceiling just above WEKA's real-world figure.

## Styling

The interface follows [llmsizer](https://github.com/onepunk/llmsizer)'s terminal
theme: monospace throughout, dark by default (`#111111` page on a zinc scale) with a
stone-scale light mode via `prefers-color-scheme` or the `data-theme` toggle, 2 px
radii, hairline borders, and tiny uppercase labels above every field, column and tile.
Status colour is carried entirely by the four fit colours — green, blue, amber, red —
and the primary button inverts to the text colour rather than taking an accent fill.

Light mode moves `--text-muted` one step darker than llmsizer's (stone-500 rather than
stone-400): this tool leans on muted text for running prose, not just short labels, and
stone-400 on the light page falls below a readable contrast ratio.

The token names in `styles.css` are load-bearing. `app.js`, `compute-app.js`,
`inference.js` and `wizard.js` emit inline `var(--series-1)`-style references for chart
fills and bar segments, so the palette can be re-pointed but the names must stay.

## Sources

- [Lenovo EveryScale Design Architecture for WEKA Storage (LP1698)](https://lenovopress.lenovo.com/lp1698-lenovo-everyscale-design-architecture-for-weka-storage)
- [HPE Solutions with WEKA (QuickSpecs a00001270enw)](https://www.hpe.com/us/en/collaterals/collateral.a00001270enw.html)
- [WEKA — Planning a WEKA system installation](https://docs.weka.io/planning-and-installation/bare-metal/planning-a-weka-system-installation)
- [SPECstorage Solution 2020 published results](https://www.spec.org/storage2020/results/) — every submission cited in `SPEC_SUBMISSIONS` links to its own audited result page
- InferX / Radian Arc reference architecture — platform model, the Regional/Core/Edge
  elevations, and the 2 MW rack design template (per-node power, weight, BOM part
  numbers, fabric topology and MEP responses)
- [open-gpu-db](https://github.com/onepunk/open-gpu-db) (Apache-2.0) — GPU specifications;
  its TDP figures independently confirm the RA BOM
- [NVIDIA Enterprise Reference Architectures](https://docs.nvidia.com/enterprise-reference-architectures/) —
  the [HGX AI Factory](https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory/latest/index.html) (HGX B300, 2-8-9-800),
  [HGX AI Factory for H100/H200/B200](https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory-h100-h200-b200/latest/index.html) (2-8-9-400),
  [RTX PRO AI Factory](https://docs.nvidia.com/enterprise-reference-architectures/rtx-pro-ai-factory/latest/index.html) (2-8-5-200) and
  [NVL72 AI Factory](https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/index.html) (2-4-5-800) documents —
  node patterns and minimums, scalable units, fabric tables, converged-fabric allocations, cabling tables and control plane
- [NVIDIA DGX SuperPOD with DGX B300 (RA-11337-001)](https://docs.nvidia.com/dgx-superpod/reference-architecture/scalable-infrastructure-b300/latest/index.html) —
  64-node scalable unit, four DGX per rack, dual-plane compute fabric, storage and in-band fabrics, management servers
- Supermicro NVIDIA AI Factory datasheets for [HGX B300](https://www.supermicro.com/datasheet/Datasheet_Supermicro_NVIDIA_AI_Factories_HGX_B300.pdf)
  (SYS-822GS-NB3RT, 15 kW per node, four per rack at 60 kW) and [HGX B200](https://www.supermicro.com/datasheet/Datasheet_Supermicro_NVIDIA_AI_Factories_HGX.pdf)
  (SYS-A22GA-NBRT-G1, 13.4 kW, 53.6 kW per rack) — NVIDIA-endorsed implementations of the Enterprise RAs; the
  [Supermicro OVX 3.0 solution brief](https://www.supermicro.com/solutions/Solution-Brief_OVX.pdf) for the L40S node
- [NVIDIA GB300 NVL72](https://www.nvidia.com/en-us/data-center/gb300-nvl72/) — per-rack tensor
  rates, memory, bandwidth and NVLink domain (sparse unless noted)
- [Supermicro SRS-GB300-NVL72 datasheet](https://www.supermicro.com/datasheet/datasheet_SuperCluster_GB300_NVL72.pdf) —
  rack composition, power shelves, operating power, dimensions, the three CDU options
- [NVIDIA NVL72 AI Factory reference architecture](https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/components.html) —
  per-tray networking (ConnectX-8, BlueField-3 B3240), SN2201 per rack, up to 142 kW
- [Lenovo NVIDIA GB300 NVL72 product guide (LP2357)](https://lenovopress.lenovo.com/lp2357-lenovo-nvidia-gb300-nvl72-rack-scale-ai) —
  48U MGX rack dimensions, tray weights, LPDDR5X per tray, coolant flow and inlet temperature
- Supermicro DCBBS datasheets — [In-Row CDU](https://www.supermicro.com/datasheet/datasheet_In_Row_CDU.pdf),
  [In-Rack CDU](https://www.supermicro.com/datasheet/datasheet_In_Rack_CDU.pdf),
  [L2A Sidecar CDU](https://www.supermicro.com/datasheet/datasheet_Sidecar_CDU.pdf)
- [LLMcalc](https://github.com/kkpkishan/llm-infra-planner) (MIT) — memory and roofline formulas
- [llmsizer](https://github.com/onepunk/llmsizer) (MIT) — quantisation-aware sizing and tensor-parallel scaling

Confirm any committed design with WEKA and your hardware vendor before quoting.
