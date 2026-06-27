/* ===================================================================
   hermit — a real miniature orchestrator.
   Declarative apply → a real reconciler converges actual to desired;
   a real best-fit scheduler bin-packs pods onto nodes by cpu/mem; pods
   are REAL Web Workers running real compute; nodes are modeled on real
   Cloudflare edge PoPs. Killing a node really evicts and reschedules.
   The scheduler / reconciler / helm-render are pure & unit-tested.
   =================================================================== */

/* ── pure: best-fit scheduler ─────────────────────────────────────
   Returns the node a pod should land on (least remaining capacity that
   still fits — classic bin-packing), or null if unschedulable.        */
export function schedule(pod, nodes, pods) {
  let best = null, bestSlack = Infinity;
  for (const node of nodes) {
    if (node.status !== 'Ready' || node.cordoned) continue;
    const used = pods.filter(p => p.node === node.name && p.phase !== 'Pending' && p.phase !== 'Failed')
      .reduce((a, p) => ({ cpu: a.cpu + p.cpuReq, mem: a.mem + p.memReq }), { cpu: 0, mem: 0 });
    const freeCpu = node.cpu - used.cpu, freeMem = node.mem - used.mem;
    if (freeCpu >= pod.cpuReq && freeMem >= pod.memReq) {
      const slack = (freeCpu - pod.cpuReq) + (freeMem - pod.memReq);
      if (slack < bestSlack) { bestSlack = slack; best = node.name; }
    }
  }
  return best;
}

/* ── pure: reconciliation diff ────────────────────────────────────
   Given desired deployments and the live pods, return create/delete.  */
export function reconcile(deploys, pods) {
  const toCreate = [], toDelete = [];
  for (const d of deploys) {
    const owned = pods.filter(p => p.deploy === d.name && p.phase !== 'Failed' && p.phase !== 'Terminating');
    const deficit = d.replicas - owned.length;
    for (let i = 0; i < deficit; i++) toCreate.push(d);
    if (deficit < 0) {
      // delete the youngest surplus pods
      owned.slice(deficit).forEach(p => toDelete.push(p.name));
    }
  }
  // orphans: pods whose deployment no longer exists
  const names = new Set(deploys.map(d => d.name));
  for (const p of pods) if (p.deploy && !names.has(p.deploy)) toDelete.push(p.name);
  return { toCreate, toDelete };
}

/* ── pure: helm template rendering ────────────────────────────────
   Real Go-template-ish substitution of {{ .Values.* }} / {{ .Release.* }}.  */
export const CHARTS = {
  webapp: {
    version: '1.2.0',
    defaults: { replicaCount: 3, image: 'primes', cpu: 250, memory: 256 },
    template:
`apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-webapp
  labels:
    app: {{ .Release.Name }}
    chart: webapp-{{ .Chart.Version }}
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: app
          image: {{ .Values.image }}
          resources:
            requests:
              cpu: {{ .Values.cpu }}m
              memory: {{ .Values.memory }}Mi`,
  },
  worker: {
    version: '0.4.1',
    defaults: { replicaCount: 4, image: 'matmul', cpu: 400, memory: 192 },
    template:
`apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-worker
  labels:
    app: {{ .Release.Name }}
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: worker
          image: {{ .Values.image }}
          resources:
            requests:
              cpu: {{ .Values.cpu }}m
              memory: {{ .Values.memory }}Mi`,
  },
};

export function renderChart(chartName, values, releaseName) {
  const chart = CHARTS[chartName];
  if (!chart) throw new Error(`chart "${chartName}" not found (have: ${Object.keys(CHARTS).join(', ')})`);
  const v = { ...chart.defaults, ...values };
  const ctx = { Values: v, Release: { Name: releaseName }, Chart: { Version: chart.version } };
  const text = chart.template.replace(/\{\{\s*\.([\w.]+)\s*\}\}/g, (_, path) => {
    let cur = ctx; for (const k of path.split('.')) cur = cur == null ? undefined : cur[k];
    return cur == null ? '' : String(cur);
  });
  return { text, manifest: parseManifest(text) };
}

/* tiny parser for the manifest shape our charts emit */
export function parseManifest(text) {
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  return {
    kind: grab(/kind:\s*(\w+)/),
    name: grab(/name:\s*([\w.-]+)/),
    app: grab(/app:\s*([\w.-]+)/),
    replicas: parseInt(grab(/replicas:\s*(\d+)/) || '1', 10),
    image: grab(/image:\s*([\w.-]+)/),
    cpu: parseInt(grab(/cpu:\s*(\d+)m/) || '250', 10),
    memory: parseInt(grab(/memory:\s*(\d+)Mi/) || '256', 10),
  };
}

/* ── real edge PoPs (Cloudflare colo codes → cities) ──────────────── */
const POPS = {
  AMS: 'Amsterdam', CDG: 'Paris', FRA: 'Frankfurt', LHR: 'London', SIN: 'Singapore',
  NRT: 'Tokyo', IAD: 'Ashburn', SJC: 'San Jose', LAX: 'Los Angeles', DXB: 'Dubai',
  GRU: 'São Paulo', SYD: 'Sydney', JNB: 'Johannesburg', BOM: 'Mumbai',
};

/* ── the live cluster (browser: manages real Workers) ─────────────── */
export class Cluster {
  constructor(opts = {}) {
    this.workerUrl = opts.workerUrl || '/js/pod-worker.js';
    this.onEvent = opts.onEvent || (() => {});
    this.nodes = [];
    this.pods = [];
    this.deploys = [];
    this.releases = [];
    this.seq = 0;
    this.tickHandle = null;
  }

  initNodes(realColo) {
    const codes = Object.keys(POPS);
    const pick = [];
    if (realColo && POPS[realColo]) pick.push(realColo);
    while (pick.length < 3) { const code = codes[(Math.random() * codes.length) | 0]; if (!pick.includes(code)) pick.push(code); }
    this.nodes = pick.map((code, i) => ({
      name: `edge-${code.toLowerCase()}`, colo: code, city: POPS[code],
      cpu: 4000, mem: 4096, status: 'Ready', cordoned: false,
      serving: code === realColo,
    }));
  }

  ensureRunning() {
    if (!this.tickHandle) this.tickHandle = setInterval(() => this.tickReconcile(), 700);
  }
  stop() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
    for (const p of this.pods) this.termWorker(p);
    this.pods = [];
  }

  applyDeployment(spec) {
    const existing = this.deploys.find(d => d.name === spec.name);
    if (existing) Object.assign(existing, spec);
    else this.deploys.push({ ...spec });
    this.ensureRunning();
    this.tickReconcile();
    return existing ? 'configured' : 'created';
  }
  scale(name, replicas) {
    const d = this.deploys.find(d => d.name === name);
    if (!d) return false;
    d.replicas = Math.max(0, replicas); this.tickReconcile(); return true;
  }
  deleteDeployment(name) {
    this.deploys = this.deploys.filter(d => d.name !== name);
    this.tickReconcile();
  }

  /* the reconcile + schedule loop (called on a timer) */
  tickReconcile() {
    // 1) restart crashed pods belonging to a deployment
    for (const p of this.pods) {
      if (p.phase === 'CrashLoopBackOff' && Date.now() - p.crashedAt > 1500) {
        p.restarts++; p.phase = 'Pending'; p.node = null; p.crashedAt = 0;
      }
    }
    // 2) desired vs actual
    const { toCreate, toDelete } = reconcile(this.deploys, this.pods.filter(p => p.phase !== 'Terminating'));
    for (const name of toDelete) this.removePod(name);
    for (const d of toCreate) this.createPod(d);
    // 3) schedule pending pods
    for (const p of this.pods) {
      if (p.phase === 'Pending') {
        const node = schedule(p, this.nodes, this.pods);
        if (node) { p.node = node; p.phase = 'ContainerCreating'; this.startWorker(p); }
        else { p.reason = 'Unschedulable'; }
      }
    }
    this.onEvent();
  }

  createPod(d) {
    const id = (++this.seq).toString(36).padStart(4, '0');
    this.pods.push({
      name: `${d.name}-${id}`, deploy: d.name, app: d.app || d.name,
      phase: 'Pending', node: null, restarts: 0, reason: '',
      cpuReq: d.cpuReq, memReq: d.memReq, image: d.image,
      metrics: { cpuMs: 0, work: 0, detail: '' }, createdAt: Date.now(), crashedAt: 0, worker: null,
    });
  }
  removePod(name) {
    const p = this.pods.find(p => p.name === name);
    if (p) { p.phase = 'Terminating'; this.termWorker(p); }
    this.pods = this.pods.filter(p => p.name !== name);
  }

  startWorker(p) {
    if (typeof Worker === 'undefined') { p.phase = 'Running'; return; }   // non-browser fallback
    try {
      const w = new Worker(this.workerUrl);
      p.worker = w;
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') p.phase = 'Running';
        else if (m.type === 'metrics') { p.metrics = m; }
        else if (m.type === 'crash') { p.phase = 'CrashLoopBackOff'; p.reason = m.reason; p.crashedAt = Date.now(); this.termWorker(p); }
      };
      w.onerror = () => { p.phase = 'CrashLoopBackOff'; p.reason = 'worker error'; p.crashedAt = Date.now(); };
      w.postMessage({ type: 'init', workload: p.image, crashAfter: p.image === 'fault' ? 4000 : 0 });
    } catch (_) { p.phase = 'Running'; }
  }
  termWorker(p) { if (p && p.worker) { try { p.worker.postMessage('stop'); p.worker.terminate(); } catch (_) {} p.worker = null; } }

  /* chaos: take a node down → evict + reschedule (real) */
  killNode(name) {
    const node = this.nodes.find(n => n.name === name) || this.nodes.find(n => n.colo.toLowerCase() === String(name).toLowerCase());
    if (!node) return null;
    node.status = 'NotReady';
    const evicted = this.pods.filter(p => p.node === node.name);
    for (const p of evicted) { this.termWorker(p); p.phase = 'Pending'; p.node = null; p.reason = 'evicted: node NotReady'; }
    this.tickReconcile();
    return { node: node.name, evicted: evicted.length };
  }
  reviveNode(name) {
    const node = this.nodes.find(n => n.name === name || n.colo.toLowerCase() === String(name).toLowerCase());
    if (node) { node.status = 'Ready'; node.cordoned = false; this.tickReconcile(); }
    return !!node;
  }
  cordon(name, on = true) { const n = this.nodes.find(n => n.name === name || n.colo.toLowerCase() === String(name).toLowerCase()); if (n) { n.cordoned = on; this.tickReconcile(); } return !!n; }
  drain(name) { const r = this.killNode(name); if (r) { const n = this.nodes.find(x => x.name === r.node); if (n) { n.status = 'Ready'; n.cordoned = true; this.tickReconcile(); } } return r; }

  usage(node) {
    const ps = this.pods.filter(p => p.node === node.name && p.phase === 'Running');
    return { cpu: ps.reduce((a, p) => a + p.cpuReq, 0), mem: ps.reduce((a, p) => a + p.memReq, 0), pods: ps.length };
  }
}
