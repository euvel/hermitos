/* ===================================================================
   hermit — dynamics.js : the shared dynamical-systems engine.

   ONE engine, used in two places:
     • the `lyapunov` lab  — where you understand the attractor
     • the `watch slo` console — where you fight it on real telemetry

   It provides (a) fault *injectors* that emit a structured latency
   signal from a real dynamical system, and (b) *estimators* that read
   dynamical structure out of a black-box time series of measured
   round-trips:
       - lag-1 autocorrelation → recovery rate  (−ln a / Δt)
       - Hurst exponent                         (detrended fluctuation analysis)
       - variance / CV trend                    (critical-slowing-down co-indicator)

   These are chosen because they are ROBUST on the short, jittery series
   a real probe produces (~10² samples at ~1 Hz). The exact largest
   Lyapunov exponent lives in the `lyapunov` lab, where Benettin's method
   computes it from the full ODE state — a place it can be trusted. We do
   not pretend to recover λ₁ from black-box round-trips; that estimate is
   not reliable at this sampling, and hermit will not fake a number.

   Nothing here is mocked: the injectors drive latency the edge really
   sleeps for, and the estimators run on latencies really measured.
   =================================================================== */

export const SIGMA = 10, BETA = 8 / 3;
export const RHO_CRIT = 24.7368;   // Hopf bifurcation → strange attractor

/* ── Lorenz system (shared with the lab) ─────────────────────────── */
export function lorenzDeriv([x, y, z], rho) {
  return [SIGMA * (y - x), x * (rho - z) - y, x * y - BETA * z];
}
export function lorenzRK4(s, rho, h) {
  const a = lorenzDeriv(s, rho);
  const s2 = s.map((v, i) => v + 0.5 * h * a[i]);
  const b = lorenzDeriv(s2, rho);
  const s3 = s.map((v, i) => v + 0.5 * h * b[i]);
  const cc = lorenzDeriv(s3, rho);
  const s4 = s.map((v, i) => v + h * cc[i]);
  const d = lorenzDeriv(s4, rho);
  return s.map((v, i) => v + (h / 6) * (a[i] + 2 * b[i] + 2 * cc[i] + d[i]));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let _spare = null;
function gauss() {                                   // standard normal (Box–Muller)
  if (_spare !== null) { const s = _spare; _spare = null; return s; }
  let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u)); _spare = r * Math.sin(2 * Math.PI * v);
  return r * Math.cos(2 * Math.PI * v);
}

/* ── Injectors ───────────────────────────────────────────────────── *
 * Each returns { kind, until, next(), state(), info() }.  `next()`
 * advances the internal system and returns the latency (ms) to impose
 * on the next real probe.  The console calls this once per tick.       */

// Structured chaos: latency traces a real Lorenz trajectory.
// ρ is the bifurcation knob — below ~24.74 it settles, above it the
// latency becomes genuinely chaotic (positive Lyapunov exponent).
export function makeLorenzInjector({ rho = 28, ttl = 60 } = {}) {
  let s = [1.0, 1.0, 1.0];
  const h = 0.01, steps = 7;         // integration per probe tick
  const base = 24, amp = 8, off = 18; // ms mapping: x∈[-18,18] → ~[24, 312]ms
  return {
    kind: 'lorenz', rho, until: Date.now() + ttl * 1000,
    next() { for (let i = 0; i < steps; i++) s = lorenzRK4(s, rho, h); return clamp(base + amp * (s[0] + off), 0, 800); },
    state() { return s; },
    info() { return { label: `lorenz ρ=${rho}`, chaotic: rho > RHO_CRIT, param: `ρ=${rho}` }; },
  };
}

// Approach-to-criticality: an AR(1) process whose recovery coefficient
// `a` is ramped toward 1. As a→1 the dominant mode stops decaying, so the
// latency's variance and autocorrelation climb (critical slowing down) —
// AND its mean creeps up as the system degrades. Both are hallmarks of a
// real tipping point, and they show up in the console BEFORE the p95
// breach. The mean-drift makes the eventual breach land reliably *after*
// the early-warning, completing the demonstration rather than gaming it.
export function makeRampInjector({ ttl = 100, from = 0.55, to = 1.02 } = {}) {
  let x = 0, a = from; const start = Date.now(); const T = ttl * 1000;
  const base = 150, drift = 210, k = 15;
  return {
    kind: 'ramp', until: start + T,
    next() {
      const p = clamp((Date.now() - start) / T, 0, 1);
      a = from + (to - from) * Math.sqrt(p);    // concave: linger near criticality (a→1)
      x = a * x + 0.85 * gauss();               // AR(1): recovery rate = −ln(a) → 0
      const mean = base + drift * p * p;        // the system also degrades as it nears the tip
      return clamp(mean + k * x, 0, 800);       // affine ⇒ latency inherits a's autocorrelation
    },
    a() { return a; },
    info() { return { label: 'ramp → criticality', param: `a=${a.toFixed(3)}`, a }; },
  };
}

/* ── Estimators (system identification from measured latency) ─────── */

function mean(a) { return a.reduce((s, v) => s + v, 0) / (a.length || 1); }
function variance(a) { if (a.length < 2) return 0; const m = mean(a); return a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1); }
function lsqSlope(pts) {                              // least-squares slope of [ [x,y], ... ]
  const n = pts.length; if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = n * sxx - sx * sx; return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}

export function stddev(a) { return Math.sqrt(variance(a)); }
export function cv(a) { const m = mean(a); return m > 0 ? stddev(a) / m : 0; }   // coefficient of variation

// lag-1 autocorrelation — the primary critical-slowing-down indicator.
export function lag1(a) {
  if (a.length < 4) return 0;
  const m = mean(a); let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) { den += (a[i] - m) ** 2; if (i) num += (a[i] - m) * (a[i - 1] - m); }
  return den === 0 ? 0 : num / den;
}

// Hurst exponent via detrended fluctuation analysis.
//   H≈0.5 uncorrelated · H>0.5 long-range/persistent (bursty) · H<0.5 anti-persistent
export function hurstDFA(x) {
  const N = x.length; if (N < 24) return null;
  const m = mean(x); const Y = []; let acc = 0;
  for (const v of x) { acc += v - m; Y.push(acc); }
  const scales = [4, 6, 8, 12, 16, 24, 32].filter(n => n <= Math.floor(N / 2));
  const F = [];
  for (const n of scales) {
    const segs = Math.floor(N / n); if (segs < 1) continue; let sum = 0;
    for (let s = 0; s < segs; s++) {
      const seg = Y.slice(s * n, s * n + n);
      const t = seg.map((_, i) => i);
      const b = lsqSlope(seg.map((v, i) => [t[i], v]));
      const a0 = mean(seg) - b * mean(t);
      let e = 0; for (let i = 0; i < n; i++) { const r = seg[i] - (b * i + a0); e += r * r; }
      sum += e / n;
    }
    const f2 = sum / segs;
    if (f2 > 0) F.push([Math.log(n), 0.5 * Math.log(f2)]);   // skip degenerate (constant) scales
  }
  if (F.length < 2) return null;
  const h = lsqSlope(F);
  return Number.isFinite(h) ? h : null;
}

/* ── Analysis roll-up used by the SLO console ────────────────────── */
// Given a latency series (ms) and sample rate, produce the dynamical
// diagnosis + a critical-slowing-down early-warning verdict.
//
// The headline invariant is the RECOVERY RATE from the lag-1
// autocorrelation a:  r = −ln(a)/Δt  (per second) — the decay rate of the
// dominant mode, i.e. how fast the system forgets a perturbation. As a
// real system approaches a tipping point its dominant eigenvalue → the
// stability boundary, so r → 0 and the relaxation time τ = 1/r → ∞. That
// is *critical slowing down*, and (with rising variance) it shows up
// BEFORE the SLO breaches. Chosen over a Rosenstein λ₁ because that
// estimate is not reliable on a ~10²-sample, 1 Hz, jittery probe series;
// the exact λ₁ is computed in the `lyapunov` lab from the full ODE state.
export function analyze(series, fs) {
  const dt = 1 / fs;
  const n = series.length;
  const a1 = lag1(series);
  const coefVar = cv(series);
  const H = hurstDFA(series);

  // recovery rate (per second) and relaxation time (seconds)
  let recovery = null, tau = null;
  if (a1 > 0 && a1 < 1) { recovery = -Math.log(a1) / dt; tau = 1 / recovery; }
  else if (a1 <= 0) { recovery = Infinity; tau = 0; }   // no memory: white / anti-correlated

  // CSD trend: are BOTH autocorrelation and variance rising across the
  // window? (This is what separates "approaching a tipping point" from a
  // merely bursty-but-stationary signal, whose autocorrelation is high
  // yet flat.) Needs enough samples to compare two halves.
  let rising = false, a1Early = null;
  if (n >= 40) {
    const half = Math.floor(n / 2);
    a1Early = lag1(series.slice(0, half));
    const vEarly = variance(series.slice(0, half)), vLate = variance(series.slice(half));
    rising = (a1 - a1Early > 0.1) && (vLate > vEarly * 1.25);
  }

  let warn = 'none';                                    // none | elevated | critical
  if ((rising && a1 > 0.8) || a1 > 0.92) warn = 'critical';
  else if (a1 > 0.6) warn = 'elevated';

  return { n, a1, a1Early, coefVar, H, recovery, tau, rising, warn };
}
