/* ===================================================================
   hermit — `lyapunov` : chaos as a real dynamical system.
   Integrates the Lorenz system (RK4) and computes the largest Lyapunov
   exponent live via the Benettin method (two trajectories, periodic
   renormalization). The ρ parameter drives the route to chaos:
     ρ < 1        → origin stable          (λ < 0)
     1 < ρ ≲ 24.7 → two fixed points       (λ ≈ 0⁻)
     ρ ≳ 24.74    → strange attractor       (λ > 0, sensitive dependence)
   This is the engine behind fault injection: a system tipped past its
   stability boundary, measured — not asserted.
   =================================================================== */

import { c } from './shell.js';

const SIGMA = 10, BETA = 8 / 3;

function deriv(s, rho) {
  const [x, y, z] = s;
  return [SIGMA * (y - x), x * (rho - z) - y, x * y - BETA * z];
}
function rk4(s, rho, h) {
  const a = deriv(s, rho);
  const s2 = s.map((v, i) => v + 0.5 * h * a[i]);
  const b = deriv(s2, rho);
  const s3 = s.map((v, i) => v + 0.5 * h * b[i]);
  const cc = deriv(s3, rho);
  const s4 = s.map((v, i) => v + h * cc[i]);
  const d = deriv(s4, rho);
  return s.map((v, i) => v + (h / 6) * (a[i] + 2 * b[i] + 2 * cc[i] + d[i]));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function lorenzCommands(send) {
  const cmd = {
    desc: 'chaos as a dynamical system: Lorenz attractor + live Lyapunov exponent',
    usage: 'lyapunov   (alias: attractor)',
    run(args, ctx, piped) {
      launch(ctx);
      return send(c.gray('dynamical-systems lab → Lorenz attractor + largest Lyapunov exponent. Esc to close.'), ctx, piped);
    },
  };
  return { lyapunov: cmd, attractor: { ...cmd, desc: 'alias: lyapunov' } };
}

function launch(ctx) {
  const ov = buildOverlay();
  const $ = (s) => ov.querySelector(s);
  const fitC = (cv) => { const dpr = Math.min(devicePixelRatio || 1, 2); const r = cv.getBoundingClientRect(); cv.width = Math.max(2, r.width * dpr); cv.height = Math.max(2, r.height * dpr); const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); return x; };
  const att = $('#ly-att'); const ax = att.getContext('2d');
  const sx = fitC($('#ly-sep'));
  // attractor canvas fixed resolution
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const ar = att.getBoundingClientRect(); att.width = ar.width * dpr; att.height = ar.height * dpr; ax.setTransform(dpr, 0, 0, dpr, 0, 0);
  ax.fillStyle = '#02040a'; ax.fillRect(0, 0, att.width, att.height);

  let rho = 28, running = true, raf = 0;
  let s = [1, 1, 1], sp = [1 + 1e-9, 1, 1];
  const D0 = 1e-9;
  let lsum = 0, time = 0, lam = 0, sepHist = [], prev = null;
  const h = 0.008, perFrame = 14;

  const setTxt = (id, v) => { const e = $('#ly-' + id); if (e) e.textContent = v; };
  setTxt('sigma', SIGMA.toFixed(0)); setTxt('beta', BETA.toFixed(3));
  $('#ly-rho').value = String(rho); setTxt('rhoval', rho.toFixed(1));

  const W = () => att.getBoundingClientRect().width, H = () => att.getBoundingClientRect().height;
  const proj = (st) => { const w = W(), hgt = H(); return [w / 2 + st[0] * (w / 60), hgt - (st[2]) * (hgt / 55) - 6]; };

  const regime = () => lam > 0.02 ? ['CHAOTIC', '#ff5d5d'] : lam < -0.02 ? ['STABLE', '#6fe06a'] : ['MARGINAL', '#e6a83c'];

  function frame() {
    if (running) {
      // fade attractor slightly
      ax.fillStyle = 'rgba(2,4,10,0.045)'; ax.fillRect(0, 0, att.width, att.height);
      ax.lineWidth = 1; ax.strokeStyle = 'rgba(79,214,204,0.9)';
      for (let k = 0; k < perFrame; k++) {
        const p0 = proj(s);
        s = rk4(s, rho, h);
        sp = rk4(sp, rho, h);
        const p1 = proj(s);
        ax.beginPath(); ax.moveTo(p0[0], p0[1]); ax.lineTo(p1[0], p1[1]); ax.stroke();
        // Benettin: measure, accumulate, renormalize
        const d = dist(sp, s) || D0;
        lsum += Math.log(d / D0);
        const f = D0 / d;
        sp = [s[0] + (sp[0] - s[0]) * f, s[1] + (sp[1] - s[1]) * f, s[2] + (sp[2] - s[2]) * f];
        time += h;
      }
      lam = time > 0 ? lsum / time : 0;
      // perturbed dot (shows sensitive dependence)
      const pp = proj([sp[0] / 1, sp[1], sp[2]]);
      const pm = proj(s);
      ax.fillStyle = '#ffb000'; ax.beginPath(); ax.arc(pm[0], pm[1], 2.4, 0, 7); ax.fill();

      sepHist.push(lam); if (sepHist.length > 200) sepHist.shift();
      setTxt('lambda', (lam >= 0 ? '+' : '') + lam.toFixed(4));
      const [name, col] = regime();
      const rEl = $('#ly-regime'); rEl.textContent = name; rEl.style.color = col;
      $('#ly-lambda').style.color = col;
      setTxt('time', time.toFixed(1) + 's');
      drawSep();
    }
    raf = requestAnimationFrame(frame);
  }

  function drawSep() {
    const r = $('#ly-sep').getBoundingClientRect(), w = r.width, hh = r.height;
    sx.clearRect(0, 0, w, hh);
    // zero line
    const zeroY = hh / 2;
    sx.strokeStyle = 'rgba(255,255,255,.12)'; sx.lineWidth = 1;
    sx.beginPath(); sx.moveTo(0, zeroY); sx.lineTo(w, zeroY); sx.stroke();
    sx.fillStyle = 'rgba(138,160,155,.7)'; sx.font = '9px monospace'; sx.fillText('λ=0', 2, zeroY - 3);
    if (sepHist.length < 2) return;
    const max = 1.0;  // scale ±1
    sx.beginPath();
    sepHist.forEach((v, i) => { const px = (i / (sepHist.length - 1)) * w; const py = zeroY - (Math.max(-max, Math.min(max, v)) / max) * (hh / 2 - 3); i ? sx.lineTo(px, py) : sx.moveTo(px, py); });
    sx.strokeStyle = lam > 0 ? '#ff5d5d' : '#6fe06a'; sx.lineWidth = 1.6; sx.stroke();
  }

  requestAnimationFrame(frame);

  // controls
  $('#ly-rho').addEventListener('input', (e) => {
    rho = parseFloat(e.target.value); setTxt('rhoval', rho.toFixed(1));
    // reset the estimator when the system changes
    s = [1, 1, 1]; sp = [1 + 1e-9, 1, 1]; lsum = 0; time = 0; sepHist = [];
    ax.fillStyle = '#02040a'; ax.fillRect(0, 0, att.width, att.height);
  });
  const presets = { '0.5': 0.5, '14': 14, '24.74': 24.74, '28': 28 };
  ov.querySelectorAll('.ly-pre').forEach(b => b.addEventListener('click', () => { $('#ly-rho').value = b.dataset.r; $('#ly-rho').dispatchEvent(new Event('input')); }));
  const pauseBtn = $('#ly-pause');
  pauseBtn.addEventListener('click', () => { running = !running; pauseBtn.textContent = running ? 'pause' : 'resume'; });

  const detach = () => { cancelAnimationFrame(raf); ov.remove(); document.removeEventListener('keydown', onKey, true); ctx.term.focus(); ctx.shell.out(c.green('dynamical-systems lab closed.')); ctx.shell.prompt(); };
  const onKey = (e) => { if (e.key === 'Escape' || (e.ctrlKey && e.key === ']')) { e.preventDefault(); detach(); } else if (e.key === ' ') { e.preventDefault(); pauseBtn.click(); } };
  document.addEventListener('keydown', onKey, true);
  $('#ly-close').addEventListener('click', detach);
}

function buildOverlay() {
  const el = document.createElement('div');
  el.id = 'ly-overlay';
  el.innerHTML = `
    <header id="ly-top">
      <div class="ly-brand"><span class="ly-dot"></span> dynamical systems
        <span class="ly-sub">Lorenz attractor · largest Lyapunov exponent (Benettin)</span></div>
      <span class="ly-grow"></span>
      <button id="ly-close" class="ly-x">close ✕</button>
    </header>
    <div id="ly-grid">
      <aside class="ly-panel">
        <div class="ly-h">parameters</div>
        <div class="ly-kv"><span>σ (Prandtl)</span><b id="ly-sigma">—</b></div>
        <div class="ly-kv"><span>β</span><b id="ly-beta">—</b></div>
        <div class="ly-h">ρ (Rayleigh) <b id="ly-rhoval" class="ly-hv">—</b></div>
        <input id="ly-rho" class="ly-range" type="range" min="0.5" max="40" step="0.1" />
        <div class="ly-pre-row">
          <button class="ly-pre" data-r="0.5">0.5</button>
          <button class="ly-pre" data-r="14">14</button>
          <button class="ly-pre" data-r="24.74">24.74</button>
          <button class="ly-pre" data-r="28">28</button>
        </div>
        <div class="ly-h">measurement</div>
        <div class="ly-metric"><span>largest Lyapunov λ₁</span><b id="ly-lambda">—</b></div>
        <div class="ly-metric"><span>regime</span><b id="ly-regime">—</b></div>
        <div class="ly-kv"><span>integrated</span><b id="ly-time">—</b></div>
        <div class="ly-h">λ₁ estimate over time</div>
        <canvas id="ly-sep" class="ly-chart"></canvas>
        <div class="ly-ctl"><button id="ly-pause" class="ly-btn">pause</button></div>
        <div class="ly-tip">λ&gt;0 ⇒ nearby trajectories diverge exponentially: deterministic, yet
          unpredictable. Push ρ past ~24.74 and the system tips into chaos — the same
          boundary an SLO crosses under fault injection.</div>
      </aside>
      <main class="ly-center">
        <div class="ly-canvas-h">phase space — Lorenz (x, z) projection <span>amber dot = a trajectory 10⁻⁹ away, diverging</span></div>
        <div class="ly-attwrap"><canvas id="ly-att"></canvas></div>
      </main>
    </div>`;
  document.body.appendChild(el);
  return el;
}
