/* ===================================================================
   hermit — pod workload (runs in a REAL Web Worker / OS thread)
   A pod is not a placeholder: it is this script executing real CPU work
   and reporting real metrics (throughput, cpu time, iterations). The
   "image" selects the workload. Postdcard from a real thread.
   =================================================================== */

let running = true;
let workload = 'primes';
let crashAfter = 0;           // for CrashLoopBackOff demos (0 = never)
const t0 = performance.now();
let iters = 0, work = 0, n = 2;

// ── workloads (all real computation) ──────────────────────────────
function stepPrimes(deadline) {
  while (performance.now() < deadline) {
    let prime = true;
    for (let i = 2; i * i <= n; i++) { iters++; if (n % i === 0) { prime = false; break; } }
    if (prime) work++;
    n++;
  }
}
let M = null;
function stepMatmul(deadline) {
  const S = 24;
  if (!M) { M = Array.from({ length: S }, () => Float64Array.from({ length: S }, () => Math.random())); }
  while (performance.now() < deadline) {
    const C = Array.from({ length: S }, () => new Float64Array(S));
    for (let i = 0; i < S; i++) for (let k = 0; k < S; k++) { const a = M[i][k]; for (let j = 0; j < S; j++) { C[i][j] += a * M[k][j]; iters++; } }
    work++;
  }
}
let h = 2166136261 >>> 0;
function stepHash(deadline) {
  while (performance.now() < deadline) {
    h ^= (n & 0xff); h = Math.imul(h, 16777619) >>> 0; n++; iters++;
    if ((iters & 0x3fff) === 0) work++;
  }
}

const STEP = { primes: stepPrimes, matmul: stepMatmul, hash: stepHash };

function tick() {
  if (!running) return;
  if (crashAfter && (performance.now() - t0) > crashAfter) {
    self.postMessage({ type: 'crash', reason: 'OOMKilled (simulated fault image)' });
    running = false; return;
  }
  (STEP[workload] || stepPrimes)(performance.now() + 28);   // ~28ms of real busy work
  self.postMessage({
    type: 'metrics',
    work, iters,
    cpuMs: Math.round(performance.now() - t0),
    detail: workload === 'primes' ? `${work} primes (n=${n})` : workload === 'matmul' ? `${work} matmuls` : `${work}k hashes`,
  });
  setTimeout(tick, 22);   // yield the thread between slices
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'init') { workload = m.workload || 'primes'; crashAfter = m.crashAfter || 0; self.postMessage({ type: 'ready' }); tick(); }
  else if (m === 'stop' || m.type === 'stop') { running = false; self.close(); }
};
