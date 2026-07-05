/* ===================================================================
   hermit — `kam` : the Chirikov–Taylor standard map, for real.

   The old `kam` verb printed poetry about "invariant tori dissolving at
   golden-ratio winding." That is a real, famous result — so this computes
   it instead of asserting it.

   The standard map (area-preserving, the canonical model of Hamiltonian
   chaos):
        p' = p + K·sin θ
        θ' = θ + p'                      (θ mod 2π; p on the cylinder)

   K is the kick strength. At K=0 the map is integrable — every horizontal
   line is an invariant torus (a KAM curve). As K grows, resonant tori
   dissolve into island chains and a chaotic sea. The LAST invariant torus
   to survive is the one with golden-mean winding; it breaks at the
   Chirikov / Greene critical value

        K_c ≈ 0.971635 .

   Below K_c that torus is an impenetrable transport barrier — a chaotic
   orbit cannot diffuse across the cylinder. Above K_c the barrier is gone
   and p diffuses without bound (global chaos). Both the phase portrait and
   the largest Lyapunov exponent here are MEASURED from the real map.
   =================================================================== */

import { c } from './shell.js';

export const K_CRIT = 0.971635;
const TAU = Math.PI * 2;
const wrap = (x) => { x %= TAU; return x < 0 ? x + TAU : x; };

// one step on the cylinder: θ wrapped, p free (so we can see diffusion)
export function stdMapStep(th, p, K) {
  const p1 = p + K * Math.sin(th);
  const th1 = wrap(th + p1);
  return [th1, p1];
}

// Largest Lyapunov exponent of ONE orbit via the tangent map (Benettin):
// J = [[1+K cosθ, 1], [K cosθ, 1]], det = 1 (area-preserving). Iterate a
// tangent vector, renormalize, accumulate log-growth. Per-iteration units.
// In a Hamiltonian system λ is orbit-dependent (0 on a torus, >0 in the
// chaotic sea), so a global measure must average over an ensemble.
function lyapAt(th, p, K, iters, warmup) {
  let vx = 1, vy = 0, sum = 0, n = 0;
  for (let i = 0; i < iters + warmup; i++) {
    const cosT = Math.cos(th);
    const nx = (1 + K * cosT) * vx + vy;
    const ny = (K * cosT) * vx + vy;
    vx = nx; vy = ny;
    const norm = Math.hypot(vx, vy);
    if (i >= warmup && norm > 0) { sum += Math.log(norm); n++; }
    if (norm > 0) { vx /= norm; vy /= norm; }
    [th, p] = stdMapStep(th, p, K);
  }
  return n ? sum / n : 0;
}

// Ensemble analysis over a grid of initial conditions: the mean largest
// Lyapunov exponent (the "route to chaos"), the fraction of phase space
// that is chaotic, and the transport diagnostic — how far a chaotic orbit
// diffuses in p (units of 2π cells). Below K_c the surviving tori (last:
// the golden one) confine chaotic orbits to < 1 cell; above K_c the barrier
// is gone and p diffuses without bound. Everything is measured from the map.
export function analyze(K, { grid = 9, iters = 1300, warmup = 120, diffIters = 8000 } = {}) {
  let sum = 0, cnt = 0, chaotic = 0, maxCells = 0;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const th0 = (i + 0.5) / grid * TAU, p0 = (j + 0.5) / grid * TAU;
      const lam = lyapAt(th0, p0, K, iters, warmup);
      sum += lam; cnt++;
      if (lam > 0.02) chaotic++;
      if (lam > 0.05) {                          // a genuinely chaotic orbit: measure diffusion
        let th = th0, p = p0, pmin = p0, pmax = p0;
        for (let t = 0; t < diffIters; t++) { [th, p] = stdMapStep(th, p, K); if (p < pmin) pmin = p; if (p > pmax) pmax = p; }
        const cells = (pmax - pmin) / TAU; if (cells > maxCells) maxCells = cells;
      }
    }
  }
  return { lam: sum / cnt, frac: chaotic / cnt, cells: maxCells, broken: maxCells > 1.0 };
}

export function kamCommands(send) {
  const cmd = {
    desc: 'Hamiltonian chaos, for real: the Chirikov standard map + KAM tori',
    usage: 'kam   (Chirikov–Taylor standard map; watch the last torus break at K≈0.972)',
    run(args, ctx, piped) {
      launch(ctx);
      return send(c.gray('standard-map lab → KAM tori, the transition to global chaos, and the largest Lyapunov exponent. Esc to close.'), ctx, piped);
    },
  };
  return { kam: cmd };
}

/* ── the lab ─────────────────────────────────────────────────────── */
function launch(ctx) {
  const ov = buildOverlay();
  const $ = (s) => ov.querySelector(s);
  const att = $('#km-att'); const ax = att.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const fit = () => { const r = att.getBoundingClientRect(); att.width = Math.max(2, r.width * dpr); att.height = Math.max(2, r.height * dpr); ax.setTransform(dpr, 0, 0, dpr, 0, 0); };
  fit();
  const W = () => att.getBoundingClientRect().width, H = () => att.getBoundingClientRect().height;

  let K = 0.5, raf = 0, running = true;
  // an ensemble of orbits, each a persistent (θ,p) we keep iterating & plotting
  let orbits = [];
  const COLORS = ['#4fd6cc', '#6fe06a', '#e6a83c', '#d96fe0', '#ff5d5d', '#7aa2ff', '#4fd6cc', '#a0f0c0'];

  const setTxt = (id, v) => { const e = $('#km-' + id); if (e) e.textContent = v; };

  function seed() {
    orbits = [];
    // spread initial conditions across p; a few in the chaotic layer near θ=π
    const N = 26;
    for (let i = 0; i < N; i++) {
      const p0 = (i / (N - 1)) * TAU;
      orbits.push({ th: 0.1, p: p0, c: COLORS[i % COLORS.length] });
    }
    orbits.push({ th: Math.PI + 0.05, p: 0.05, c: '#ff5d5d' });   // the chaotic tracer
    ax.fillStyle = '#02040a'; ax.fillRect(0, 0, att.width, att.height);
  }

  let recomputeT = 0;
  function recompute() {
    setTxt('kval', K.toFixed(4));
    seed();                                      // reseed the portrait immediately (cheap, responsive)
    // the ensemble analysis is heavier — debounce so a slider drag stays smooth
    const dc = $('#km-dist'); const near = Math.abs(K - K_CRIT) < 0.01;
    dc.textContent = near ? 'AT the critical point' : (K < K_CRIT ? `${(K_CRIT - K).toFixed(3)} below K_c` : `${(K - K_CRIT).toFixed(3)} above K_c`);
    dc.style.color = near ? '#e6a83c' : (K < K_CRIT ? '#6fe06a' : '#ff5d5d');
    setTxt('lambda', '…'); setTxt('frac', '…'); setTxt('barrier', 'measuring…');
    clearTimeout(recomputeT);
    recomputeT = setTimeout(() => {
      const a = analyze(K);
      setTxt('lambda', (a.lam >= 0 ? '+' : '') + a.lam.toFixed(4));
      const [rname, rcol] = a.lam > 0.02 ? ['CHAOTIC', '#ff5d5d'] : a.lam < 0.001 ? ['REGULAR', '#6fe06a'] : ['MIXED', '#e6a83c'];
      const rEl = $('#km-regime'); rEl.textContent = rname; rEl.style.color = rcol;
      $('#km-lambda').style.color = rcol;
      setTxt('frac', (a.frac * 100).toFixed(0) + '%');
      const bEl = $('#km-barrier');
      if (a.broken) { bEl.textContent = 'BROKEN — global transport'; bEl.style.color = '#ff5d5d'; }
      else { bEl.textContent = 'INTACT — tori confine p'; bEl.style.color = '#6fe06a'; }
      setTxt('cells', a.cells.toFixed(2) + '× cells');
    }, 90);
  }

  function frame() {
    if (running) {
      const w = W(), h = H(); const sx = w / TAU, sy = h / TAU;
      // faint persistence so the portrait accumulates but breathes
      for (const o of orbits) {
        ax.fillStyle = o.c;
        for (let k = 0; k < 40; k++) {
          [o.th, o.p] = stdMapStep(o.th, o.p, K);
          const y = h - wrap(o.p) * sy;
          ax.globalAlpha = o.c === '#ff5d5d' ? 0.9 : 0.55;
          ax.fillRect(o.th * sx, y, 1.1, 1.1);
        }
      }
      ax.globalAlpha = 1;
    }
    raf = requestAnimationFrame(frame);
  }

  // controls
  const slider = $('#km-K');
  slider.value = String(K);
  slider.addEventListener('input', (e) => { K = parseFloat(e.target.value); recompute(); });
  ov.querySelectorAll('.ly-pre').forEach(b => b.addEventListener('click', () => { slider.value = b.dataset.k; K = parseFloat(b.dataset.k); slider.value = String(K); recompute(); }));
  const pauseBtn = $('#km-pause');
  pauseBtn.addEventListener('click', () => { running = !running; pauseBtn.textContent = running ? 'pause' : 'resume'; });

  const detach = () => { cancelAnimationFrame(raf); ov.remove(); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); ctx.term.focus(); ctx.shell.out(c.green('standard-map lab closed.')); ctx.shell.prompt(); };
  const onKey = (e) => { if (e.key === 'Escape' || (e.ctrlKey && e.key === ']')) { e.preventDefault(); detach(); } else if (e.key === ' ') { e.preventDefault(); pauseBtn.click(); } };
  const onResize = () => fit();
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  $('#km-close').addEventListener('click', detach);

  recompute();
  requestAnimationFrame(frame);
}

function buildOverlay() {
  const el = document.createElement('div');
  el.id = 'km-overlay';
  el.innerHTML = `
    <header id="km-top">
      <div class="ly-brand"><span class="ly-dot"></span> KAM · standard map
        <span class="ly-sub">Chirikov–Taylor · Hamiltonian chaos · the last torus</span></div>
      <span class="ly-grow"></span>
      <button id="km-close" class="ly-x">close ✕</button>
    </header>
    <div id="km-grid">
      <aside class="ly-panel">
        <div class="ly-h">kick strength <b id="km-kval" class="ly-hv">—</b></div>
        <input id="km-K" class="ly-range" type="range" min="0" max="3" step="0.0005" />
        <div class="ly-pre-row">
          <button class="ly-pre" data-k="0">0</button>
          <button class="ly-pre" data-k="0.5">0.5</button>
          <button class="ly-pre" data-k="0.971635">K_c</button>
          <button class="ly-pre" data-k="2">2.0</button>
        </div>
        <div class="ly-h">measurement <span class="ly-hv" style="font-size:9px">ensemble, 81 orbits</span></div>
        <div class="ly-metric"><span>mean Lyapunov λ̄₁</span><b id="km-lambda">—</b></div>
        <div class="ly-metric"><span>regime</span><b id="km-regime">—</b></div>
        <div class="ly-kv"><span>phase space that is chaotic</span><b id="km-frac">—</b></div>
        <div class="ly-h">the last KAM torus (golden-mean winding)</div>
        <div class="ly-metric"><span>transport barrier</span><b id="km-barrier">—</b></div>
        <div class="ly-kv"><span>chaotic orbit spread</span><b id="km-cells">—</b></div>
        <div class="ly-kv"><span>vs K_c ≈ 0.9716</span><b id="km-dist">—</b></div>
        <div class="ly-ctl"><button id="km-pause" class="ly-btn">pause</button></div>
        <div class="ly-tip">Every curve is one orbit of the real map. At <b>K=0</b> they are flat
          invariant tori; raise K and resonant tori break into island chains. The golden torus —
          the last barrier to global chaos — breaks at <b>K_c≈0.972</b>: below it a chaotic orbit
          is confined; above it, p diffuses without bound. Same bifurcation story as
          <code>lyapunov</code>, in a Hamiltonian system.</div>
      </aside>
      <main class="ly-center">
        <div class="ly-canvas-h">phase space — (θ, p) on the cylinder <span>red = a chaotic tracer near the hyperbolic point</span></div>
        <div class="ly-attwrap"><canvas id="km-att"></canvas></div>
      </main>
    </div>`;
  document.body.appendChild(el);
  return el;
}
