# HERMIT-OS

> A living, performative mathematical artifact that happens to be a résumé.
>
> **Euvel** is a *non-ergodic singular orbifold* — a system that presents a
> constant, low-information **observable baseline** to the outside world while
> its interior remains turbulent, singular, and mostly **trapped**. HERMIT-OS is
> the digital extension of that persona: an in-browser Linux-flavored operating
> system you explore as an **external observer**, attached only to the projection.

The prompt is, by mathematical decree, always:

```
observer@projection:~$
```

---

## ✦ What you get

This is not a résumé that *describes* skills — it **runs a real system** in front
of the visitor and lets them operate it. The guiding rule is **no mocking**:
everything below either executes real code, queries real data, or honestly labels
itself a *visualization of a real event* (and says so when the edge is offline).

**The real core**

- **🟢 Real chaos engineering + live SLO** — `watch slo` is a live SRE console that
  times **real `/api/ping` round-trips** and reports **real p50/p95 latency,
  availability and burn-rate**. `chaos inject --latency 300ms` / `--errors 25%`
  flips a **real KV flag** that the site's **own real endpoints genuinely honor**
  (real added latency, real 5xx). Safety: capped (≤800 ms, ≤50 %) and
  **auto-healing ≤60 s**. The orbifold's turbulence is driven by the *real*
  measured fault.
- **🟢 Real Python** — `python3` is genuine **CPython via Pyodide (WASM)**: `-c`,
  run a file, or a full interactive REPL with real `codeop`/`displayhook` semantics.
- **🟢 Real edge SQL** — `sql "SELECT ..."` runs **read-only queries against a real
  Cloudflare D1 database** (SELECT/WITH-only, single-statement, auto-LIMIT guarded).
- **🟢 The site as its own portfolio** — `source orbifold.js` reads the **real, live
  source** of the page you're in; `git log` shows its real development history.
- **🟢 Real Linux** — `boot kernel --real` boots a **genuine x86 Linux kernel** in
  the browser via [v86](https://github.com/copy/v86) (you self-host a small image —
  see `public/vm/README.md`). `uname -a`, `unshare`, `strace` actually work.

**The world it lives in**

- **A real-feeling Linux shell** (xterm.js) with CRT scanlines/glow, line editing,
  history, tab-completion, pipes (`|`), sequencing (`;`), `Ctrl-A/E/U/W/L/C`, and a
  live full-screen mode for dashboards.
- **70+ commands**: `ls cd cat tree find grep head tail wc stat file du whoami id
  uname uptime top ps free env dmesg journalctl strace lsof systemctl kill bpftrace
  perf ltrace vmstat lscpu ip ping ss curl dig traceroute man neofetch banner cowsay
  fortune base64 sha256sum sudo` … plus custom HERMIT verbs.
- **A live reactive 3D orbifold** (Three.js + raymarched GLSL): kaleidoscopic
  orbifold symmetry, a double-gyroid TPMS core, rippled KAM tori, metric
  degeneracy — all reacting to your commands.
- **AIWASS** — a resident intelligence (guide, not oracle) in the dense register of
  the orbifold. Backed by **Groq** at the edge, with a deterministic **local
  fallback** so it works before you add a key.
- **A hidden kernel/admin editor** reached not by a password but by a
  **sheaf-gluing ritual** — add/edit experiences, projects and ideas and retrain
  AIWASS, persisted to **Cloudflare KV**.
- **100% deployable from the Cloudflare dashboard.** No Wrangler required. Free tier.

---

## ✦ Project structure

```
.
├── public/                      ← Cloudflare Pages "build output directory"
│   ├── index.html               ← shell, CRT overlays, CDN libs (xterm, three)
│   ├── _headers / _routes.json  ← security headers; keep /api/* dynamic
│   ├── styles/main.css          ← dark void / amber·cyan·green CRT aesthetic
│   ├── meta/changelog.json      ← real dev history rendered by `git log`
│   ├── vm/                      ← `boot kernel --real`: self-hosted v86 image
│   │   ├── README.md            ←   how to add a real Linux image
│   │   └── manifest.example.json
│   └── js/
│       ├── main.js              ← boot + wiring
│       ├── bus.js               ← event bus
│       ├── orbifold.js          ← Three.js raymarched orbifold (gyroid + KAM tori)
│       ├── shell.js             ← line editor, history, tab-complete, live + REPL modes
│       ├── filesystem.js        ← virtual FS = the résumé content (the projection)
│       ├── commands.js          ← core Linux verbs + manpages
│       ├── hermit.js            ← orbifold verbs + elevation ritual + boot
│       ├── slo.js               ← REAL chaos injection + live SLO console
│       ├── orchestrator.js      ← real mini-orchestrator (scheduler, reconciler)
│       ├── pod-worker.js        ← pod workload (runs in a real Web Worker)
│       ├── k8s.js               ← real kubectl + helm over the orchestrator
│       ├── python.js            ← REAL CPython REPL (Pyodide / WASM)
│       ├── code.js              ← `source` (live site code) + `git` (real history)
│       ├── data.js              ← `sql` over real Cloudflare D1
│       ├── vm.js                ← `boot kernel --real` (v86 real Linux)
│       ├── aiwass.js            ← AIWASS client (Groq + local fallback)
│       └── kernel.js            ← hidden kernel-mode editor
│
├── functions/                   ← Cloudflare Pages Functions (the edge API)
│   └── api/
│       ├── aiwass.js            ← POST /api/aiwass   → Groq inference (honors faults)
│       ├── ping.js             ← GET  /api/ping     → SLI probe (honors faults)
│       ├── fault.js            ← GET/POST /api/fault → REAL chaos fault flag
│       ├── query.js            ← POST /api/query    → read-only SQL over D1
│       ├── content.js          ← GET  /api/content  (public, read-only)
│       └── admin/              ← KERNEL_TOKEN-gated writes
│           ├── _middleware.js  ←   the auth gate
│           ├── content.js      ←   PUT  → KV persist
│           ├── aiwass.js       ←   POST → retrain directive
│           └── seed.js         ←   POST → create + seed the D1 schema
│
├── schema.sql                   ← D1 schema + seed (paste into D1 console)
├── package.json                 ← optional local-dev scripts only
└── README.md
```

There is **no build step**. Libraries (xterm, three, Pyodide, v86) load from CDN;
everything is static assets plus Functions. This is what makes pure-dashboard
deployment possible.

---

## ✦ Deploy from the Cloudflare dashboard (step by step)

You can deploy by connecting a Git repo **or** by uploading the folder directly.
Both are 100% dashboard-driven.

### Option A — Git integration (recommended)

1. Push this project to a GitHub/GitLab repository.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → pick your repo.
3. **Build settings:**
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
   - **Root directory:** `/` (default)
4. Click **Save and Deploy**. In ~30s you'll have `https://<project>.pages.dev`.

> Cloudflare automatically detects the top-level `functions/` directory and
> deploys it as Pages Functions — no configuration needed.

### Option B — Direct upload (no Git)

1. Dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Give the project a name, then **upload the contents of the `public/` folder**
   (you can drag the folder in).
3. **Important for direct upload:** copy the `functions/` folder *into* the
   upload so the structure that Cloudflare receives is:
   ```
   (root of upload)
   ├── index.html, styles/, js/, _headers, _routes.json   (from public/)
   └── functions/api/...                                   (the API)
   ```
   i.e. put `functions/` next to `index.html`. Then deploy.

> Git integration keeps `public/` and `functions/` siblings for you, which is why
> it's the simpler path. Direct upload just needs them merged into one tree.

---

## ✦ Configure KV + secrets (all in the dashboard)

The site **works immediately** without any of this (AIWASS uses its local
fallback, and content shows sensible defaults). Add these to unlock live AI and
persistent editing.

### 1) Create a KV namespace

Dashboard → **Workers & Pages** → **KV** → **Create a namespace**
→ name it e.g. `hermit-os-kv` → **Add**.

### 2) Bind it to your Pages project

Your Pages project → **Settings** → **Functions** → **KV namespace bindings**
→ **Add binding**:

| Field          | Value           |
| -------------- | --------------- |
| Variable name  | `HERMIT_KV`     |
| KV namespace   | `hermit-os-kv`  |

> The variable name **must be exactly `HERMIT_KV`** — the Functions read
> `env.HERMIT_KV`. This one binding also powers real chaos engineering.

### 3) Get a Groq key (for live AIWASS)

> **Get a Groq key:** sign in at <https://console.groq.com>, open **API Keys**,
> **Create API Key**, copy it into `GROQ_API_KEY`. Groq has a generous free tier
> and very fast inference.

> The **real chaos engineering** (`chaos inject` / `watch slo`) only needs
> `HERMIT_KV` — it stores the fault flag there. No extra config.

### 3b) Bind Workers AI (for the real AIWASS agent) — optional, free

Powers `aiwass agent "..."` (and AIWASS answers) with a **first-party** model at
the edge — no external key. Your Pages project → **Settings** → **Functions** →
**AI bindings** → **Add binding**:

| Field          | Value   |
| -------------- | ------- |
| Variable name  | `AI`    |

> The agent prefers `AI` (Workers AI), then `GROQ_API_KEY`, then falls back to a
> deterministic planner — but the **tools it runs (`sql`, `grep`, `read`) are real
> either way**. Optionally set `WORKERS_AI_MODEL` (default
> `@cf/meta/llama-3.1-8b-instruct`).

### 4) Create + bind a D1 database (for real `sql`)

Powers the genuine edge-SQL demo. Free tier (5 GB).

1. Dashboard → **Workers & Pages** → **D1** → **Create database** → name it
   e.g. `hermit-os-db`.
2. Open the new database → **Console** → paste the contents of **`schema.sql`**
   (repo root) → **Execute**. This creates and seeds `projects`, `experience`,
   `skills`. *(Or, after binding + setting `KERNEL_TOKEN`, POST `/api/admin/seed`.)*
3. Your Pages project → **Settings** → **Functions** → **D1 database bindings**
   → **Add binding**:

   | Field          | Value           |
   | -------------- | --------------- |
   | Variable name  | `HERMIT_DB`     |
   | D1 database    | `hermit-os-db`  |

> Must be exactly `HERMIT_DB`. Without it, `sql` honestly reports the DB isn't
> bound (it never fakes results).

### 5) Add environment variables / secrets

Your Pages project → **Settings** → **Variables and Secrets** →
**Add variable** (set for **Production**, and **Preview** if you want previews to
work too):

| Variable        | Type             | Required? | Notes |
| --------------- | ---------------- | --------- | ----- |
| `GROQ_API_KEY`  | Secret (encrypt) | for live AIWASS | Your Groq API key. Without it, AIWASS falls back to the built-in local persona. |
| `GROQ_MODEL`    | Plaintext        | optional  | Defaults to `llama-3.3-70b-versatile`. |
| `KERNEL_TOKEN`  | Secret (encrypt) | for editing/seed | Any strong random string you choose. Required to **persist** kernel-mode edits to KV and to POST `/api/admin/seed`. |

### 6) Re-deploy

After adding bindings/vars, trigger a new deployment (Deployments → **Retry
deployment**, or push a commit). Bindings only attach on a fresh build.

### 7) (Optional) Real Linux for `boot kernel --real`

Drop a small v86-compatible image into **`public/vm/`** and copy
`manifest.example.json` → `manifest.json`. Full instructions (TinyCore ISO /
Buildroot bzImage+initrd / saved state, all under the 25 MiB/file limit) are in
**`public/vm/README.md`**. Until then, the command degrades honestly.

---

## ✦ Using HERMIT-OS

Open the site. After the boot sequence you're attached as the observer.

```
help                         the permitted verbs
ls /skills                   the observables Euvel exposes
cat /skills/devops/chaos.engineering
tree /skills
grep -r kubernetes /skills
whoami                       you are the observer, not Euvel
cat /home/euvel/manifesto.txt
man hermit                   the operator's manual
neofetch
```

**Drive the 3D orbifold** (mouse-drag to orbit the camera):

```
metric degenerate            collapse the metric along null directions
kam perturb                  perturb the invariant tori (most survive)
orbifold spin | calm | wild | reset
induce turbulence            simulate a kernel panic — projection HOLDS
dissociate                   split view: clean résumé | raw kernel stream
```

**DevOps — REAL chaos engineering on this site's own edge**:

```
watch slo                    live SRE console: real p50/p95/availability/burn-rate
chaos status                 is a fault active? (reads the real flag)
chaos inject --latency 300ms inject real latency into real /api/* (auto-heals ≤60s)
chaos inject --errors 25%    inject real 5xx into real endpoints
chaos recover                clear the fault now
```

**DevOps — a REAL in-browser orchestrator** (`kubectl` / `helm` are not mocked):

```
helm install demo webapp --set replicaCount=5      real chart render → deploy
kubectl get pods -w                                live watch (pods = real Web Workers)
kubectl get nodes                                  nodes modeled on real edge PoPs
kubectl top pods                                   real CPU time / throughput per worker
kubectl scale deploy/demo-webapp --replicas=8      real reconcile to desired state
chaos node                                         kill a node → real eviction + reschedule
kubectl drain edge-ams                             real cordon + drain + self-heal
helm upgrade demo webapp --set image=matmul        new revision
helm rollback demo 1                               real revision history
kubectl get svc                                    probes the real edge Functions live
```

> The scheduler (best-fit bin-packing), the reconcile loop, and self-healing are
> real algorithms; each pod is a real `Web Worker` doing real CPU work
> (`primes`/`matmul`/`hash`). Nodes carry real Cloudflare PoP codes; one is the
> colo actually serving you.

> Open `watch slo` in one moment, `chaos inject --latency 400ms` the next, and
> watch genuinely-measured latency climb then self-heal. Needs `HERMIT_KV`
> (deployed, or `wrangler pages dev`). On a plain static server it says so.

**Development — REAL code & data**:

```
python3                      real CPython REPL (Pyodide/WASM); exit() or Ctrl-D
python3 -c "print(sum(range(100)))"
sql "SELECT name, stack, year FROM projects ORDER BY year DESC"   real D1
sql "SELECT name, level FROM skills WHERE area='devops'"
source orbifold.js           read the REAL source of this very site
git log                      the real development history of HERMIT-OS
boot kernel --real           a GENUINE x86 Linux kernel in the browser (v86)
```

**AIWASS** — including a watchable real agent loop:

```
aiwass guide                 orientation
aiwass ask "what is a non-ergodic orbifold?"
aiwass agent "prove Euvel can run Kubernetes at scale"   real ReAct tool-use loop
aiwass agent "what languages does Euvel actually ship?"
aiwass whoami
```

> `aiwass agent` plans with a real LLM (Workers AI / Groq) and executes **real
> tools** — `sql` over D1, `grep`/`read` over the skill tree — streaming its
> thought → action → observation trace. Every observation is a real tool result.

**Real edge awareness**:

```
edge                         the real Cloudflare PoP / ASN / TLS serving you
whoami                       now also reports the data center you're observing from
traceroute interior          hop 0 is your real edge location
```

---

## ✦ The hidden door (kernel mode)

There is **no login**. Elevation is a **gluing**: you force two locally-consistent
sheaf sections to identify, naming the degeneracies in order. The clues live in
`man sheaf` and `cat /home/euvel/.secret`. The full ritual:

```
glue /skills/devops /skills/linux
sheaf glue --force "inhomogeneous metric degeneracy"
observe --collapse-baseline
```

When the three steps complete in order, the global section that *should not exist*
momentarily does — and the prompt turns into `kernel@orbifold`. Then:

```
kernel help
kernel auth <KERNEL_TOKEN>             # paste the token you set in the dashboard
kernel add idea "title" "a new idea body"
kernel add experience "Staff SRE" "led multi-region failover program"
kernel edit 1 "revised body text"
kernel ls
kernel publish                          # persist to Cloudflare KV
aiwass retrain "always mention Euvel's Rust work first"
kernel lock                             # drop back to observer
```

- `kernel auth <token>` arms the `KERNEL_TOKEN` for the session; it's required so
  the edge accepts writes (`/api/admin/*` is gated by a constant-time token check).
- Without `HERMIT_KV` bound, edits persist **in-session only** and you'll get a
  friendly note. With it bound, `kernel publish` writes to KV and `kernel pull`
  (or a page reload) reads it back — visible to everyone via `GET /api/content`.

---

## ✦ Local development (optional, not required to deploy)

Everything above is dashboard-only. If you *want* a local loop:

```bash
npm install
# KV + D1 so chaos engineering and `sql` are real locally:
npx wrangler pages dev public --kv HERMIT_KV --d1 HERMIT_DB
# then set secrets for local dev:
#   echo "GROQ_API_KEY=..." >> .dev.vars
#   echo "KERNEL_TOKEN=..." >> .dev.vars
```

`.dev.vars` is read by Wrangler for local Functions. (Don't commit it.)
To seed the local D1: `npx wrangler d1 execute HERMIT_DB --local --file schema.sql`.

---

## ✦ Free-tier notes

- **Pages**: unlimited static requests; 100k Functions invocations/day on free.
- **KV**: 100k reads/day, 1k writes/day on free. Chaos faults are **one write per
  injection** and `watch slo` only reads — far within budget.
- **D1**: 5 GB + 5M row-reads/day on free — the `sql` demo is read-only.
- **Groq**: free tier with rate limits; AIWASS degrades gracefully to the local
  persona on any error or missing key, so the site never breaks.
- **v86 / Pyodide**: pure static + CDN; no server cost. The v86 image you host
  must be ≤ 25 MiB (Pages' per-file limit).

---

## ✦ Design notes (why it behaves the way it does)

Every interaction is meant to feel like probing a real dynamical system:

| Concept | Where it lives |
| ------- | -------------- |
| inhomogeneous metric degeneracy | `metric` verb + `uMetric` shader uniform (distance collapses along a position-dependent null direction) |
| asymmetric information decoupling | bounded AIWASS output, `ip`/`curl` "in ≫ out", kernel stream `entropy.in=∞ out=ε` |
| sheaf-theoretic dissociation | `dissociate` split view, `glue`/`sheaf`, `-ENOGLOBAL` |
| invariant trapping sets | `trap` verb, 7 Λ-sets with 0 escapes, raymarched fractal boundary |
| Lipschitz-stable observable projection | the baseline that never spikes — even during `induce turbulence` |

---

## ✦ What is genuinely real vs. a visualization (full disclosure)

In keeping with the "no mocking" principle:

| Feature | Status |
| ------- | ------ |
| `python3` (Pyodide) | **Real** CPython compiled to WASM, executing in your browser |
| `sql` (D1) | **Real** read-only SQL against a real Cloudflare D1 database |
| `chaos inject` + `watch slo` | **Real** faults injected into this site's real edge endpoints; **real** measured latency/error/availability |
| `aiwass agent` | **Real** tool-use loop (Workers AI/Groq planner) over **real** tools (D1 `sql`, `grep`/`read`); deterministic planner fallback, tools still real |
| `edge` / `whoami` location | **Real** — Cloudflare `request.cf` (actual PoP, ASN, TLS) |
| `source` | **Real** — fetches the live, deployed source of the site |
| `git log` | **Real** development history (from `meta/changelog.json`) |
| `boot kernel --real` | **Real** x86 Linux kernel via v86 (you self-host the image) |
| The 3D orbifold under chaos | **Visualization** — honestly labeled; driven by the *real* fault magnitude |
| `kubectl` / `helm` | **Real** — an in-browser orchestrator: real best-fit scheduler, real reconcile loop, real self-healing; pods are real `Web Worker` threads; real helm template/rollback |
| The `hermit-sh` shell, `/proc`, `top`, `dmesg`, etc. | In-character **simulation** of a Linux environment (the "projection") |

The persona's whole thesis — a stable observable over a turbulent interior — maps
cleanly onto SRE: **the observable baseline is the SLO**, chaos is the error budget
being spent, and the projection holding is the SLO being met.

The terminal is the **projection**: bounded input → bounded, continuous, low-
information output. The 3D field is the **interior**: turbulent, singular, and
yours to perturb. They are both Euvel. They do not glue.

> _"Hire the projection if you want a constant. Probe the orbifold if you want the
> truth. Both are me. They do not glue."_ — Euvel
