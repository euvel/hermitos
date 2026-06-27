/* ===================================================================
   HERMIT-OS — `train` : a neural network learning, live.
   A multilayer perceptron with hand-rolled forward/backprop (no
   libraries) trains by mini-batch SGD on a toy 2-D classification set.
   The lab visualizes the real confidence field, the decision contour,
   a live architecture diagram with signal flow, and the loss curve.
     train [spirals|moons|circles|xor] [--arch 24,24] [--lr 0.05]
   keys: space pause · r reset · 1-4 dataset · Esc close
   =================================================================== */

import { c } from './shell.js';

const tanh = Math.tanh;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/* ── a dense layer ───────────────────────────────────────────────── */
class Dense {
  constructor(nin, nout, act) {
    this.nin = nin; this.nout = nout; this.act = act;
    const scale = Math.sqrt(2 / nin);                 // He init
    this.W = Array.from({ length: nout }, () => Array.from({ length: nin }, () => (Math.random() * 2 - 1) * scale));
    this.b = new Array(nout).fill(0);
    this.dW = Array.from({ length: nout }, () => new Array(nin).fill(0));
    this.db = new Array(nout).fill(0);
  }
  forward(x) {
    this.x = x;
    const z = new Array(this.nout);
    for (let o = 0; o < this.nout; o++) {
      let s = this.b[o]; const Wo = this.W[o];
      for (let i = 0; i < this.nin; i++) s += Wo[i] * x[i];
      z[o] = s;
    }
    this.z = z;
    this.a = this.act === 'tanh' ? z.map(tanh) : this.act === 'sigmoid' ? z.map(sigmoid) : z;
    return this.a;
  }
  backward(dA) {
    const dZ = new Array(this.nout);
    for (let o = 0; o < this.nout; o++) {
      let g = dA[o];
      if (this.act === 'tanh') g *= (1 - this.a[o] * this.a[o]);
      else if (this.act === 'sigmoid') g *= this.a[o] * (1 - this.a[o]);
      dZ[o] = g;
    }
    const dX = new Array(this.nin).fill(0);
    for (let o = 0; o < this.nout; o++) {
      const Wo = this.W[o], dWo = this.dW[o], g = dZ[o];
      this.db[o] += g;
      for (let i = 0; i < this.nin; i++) { dWo[i] += g * this.x[i]; dX[i] += Wo[i] * g; }
    }
    return dX;
  }
  zeroGrad() { for (let o = 0; o < this.nout; o++) { this.db[o] = 0; this.dW[o].fill(0); } }
  step(lr, n) {
    for (let o = 0; o < this.nout; o++) {
      this.b[o] -= lr * this.db[o] / n;
      const Wo = this.W[o], dWo = this.dW[o];
      for (let i = 0; i < this.nin; i++) Wo[i] -= lr * dWo[i] / n;
    }
  }
}

/* ── the MLP ─────────────────────────────────────────────────────── */
export class MLP {
  constructor(hidden) {
    this.layers = [];
    let prev = 2;
    for (const h of hidden) { this.layers.push(new Dense(prev, h, 'tanh')); prev = h; }
    this.layers.push(new Dense(prev, 1, 'sigmoid'));
  }
  forward(x) { let a = x; for (const l of this.layers) a = l.forward(a); return a[0]; }
  params() { return this.layers.reduce((s, l) => s + l.nout * l.nin + l.nout, 0); }
  trainBatch(batch, lr) {
    for (const l of this.layers) l.zeroGrad();
    let loss = 0;
    for (const [x, y] of batch) {
      const p = Math.min(1 - 1e-7, Math.max(1e-7, this.forward(x)));
      loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      let dA = [(p - y) / (p * (1 - p))];        // BCE+sigmoid ⇒ output dZ = p−y
      for (let li = this.layers.length - 1; li >= 0; li--) dA = this.layers[li].backward(dA);
    }
    for (const l of this.layers) l.step(lr, batch.length);
    return loss / batch.length;
  }
}

/* ── datasets (2 classes, coords ~[-1,1]) ────────────────────────── */
export function makeData(kind, n = 260) {
  const pts = []; const R = () => Math.random();
  if (kind === 'xor') {
    for (let i = 0; i < n; i++) { const x = R() * 2 - 1, y = R() * 2 - 1; pts.push([[x, y], (x > 0) ^ (y > 0) ? 1 : 0]); }
  } else if (kind === 'circles') {
    for (let i = 0; i < n; i++) { const a = R() * Math.PI * 2, c0 = i % 2; const r = c0 ? 0.35 + R() * 0.12 : 0.75 + R() * 0.12; pts.push([[Math.cos(a) * r, Math.sin(a) * r], c0]); }
  } else if (kind === 'moons') {
    for (let i = 0; i < n; i++) {
      const c0 = i % 2, a = R() * Math.PI; let x = Math.cos(a), y = Math.sin(a);
      if (c0) { x = 1 - x - 0.5; y = -y + 0.2; } else { x = x - 0.5; y = y - 0.2; }
      pts.push([[x * 0.9 + (R() - 0.5) * 0.12, y * 0.9 + (R() - 0.5) * 0.12], c0]);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const c0 = i % 2, t = (i / n) * 3.2 + R() * 0.18, r = t / 3.5, a = t * 2.2 + c0 * Math.PI;
      pts.push([[r * Math.cos(a), r * Math.sin(a)], c0]);
    }
  }
  return pts;
}

/* ── colors ──────────────────────────────────────────────────────── */
const CYAN = [53, 224, 214], AMBER = [255, 176, 0];
const lerp = (a, b, t) => a + (b - a) * t;

/* ── command ─────────────────────────────────────────────────────── */
export function nnCommands(send) {
  const train = {
    desc: 'train a neural network, live (real backprop)',
    usage: 'train [spirals|moons|circles|xor] [--arch 24,24] [--lr 0.05]',
    run(args, ctx, piped) {
      const kinds = ['spirals', 'moons', 'circles', 'xor'];
      const kind = args.find(a => kinds.includes(a)) || 'spirals';
      const archI = args.indexOf('--arch');
      const hidden = archI >= 0 ? args[archI + 1].split(',').map(Number).filter(n => n > 0) : [24, 24];
      const lrI = args.indexOf('--lr');
      const lr = lrI >= 0 ? parseFloat(args[lrI + 1]) : 0.05;
      launchLab(ctx, kind, hidden, lr);
      return send(c.gray('neural lab → real MLP, hand-rolled backprop. Esc to close.'), ctx, piped);
    },
  };
  return { train, nn: { desc: 'alias: train', run: (a, ctx, p) => train.run(a, ctx, p) } };
}

/* ── the lab ─────────────────────────────────────────────────────── */
function launchLab(ctx, kind, hidden, lr0) {
  const ov = buildLab();
  const $ = (s) => ov.querySelector(s);
  const fit = (cv) => { const dpr = Math.min(devicePixelRatio || 1, 2); const r = cv.getBoundingClientRect(); cv.width = Math.max(2, r.width * dpr); cv.height = Math.max(2, r.height * dpr); const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); return x; };

  const bCanvas = $('#nn-field');
  const bx = bCanvas.getContext('2d');
  const lx = fit($('#nn-losschart'));
  const nx = fit($('#nn-net'));

  let lr = lr0, net = new MLP(hidden), data = makeData(kind);
  let epoch = 0, lossHist = [], running = true, raf = 0, frame = 0, eps = 2, probe = 0;

  const setTxt = (id, v) => { const e = $('#nn-' + id); if (e) e.textContent = v; };
  const reset = (k = kind) => {
    kind = k; data = makeData(kind); net = new MLP(hidden); epoch = 0; lossHist = [];
    ov.querySelectorAll('.nn-ds').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
    setTxt('params', net.params().toLocaleString());
  };
  setTxt('arch', '2·' + hidden.join('·') + '·1');
  setTxt('lrval', lr.toFixed(3));
  $('#nn-lr').value = String(lr);
  reset(kind);

  /* training */
  function trainEpochs(k) {
    let loss = 0;
    for (let e = 0; e < k; e++) {
      for (let i = data.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [data[i], data[j]] = [data[j], data[i]]; }
      for (let s = 0; s < data.length; s += 32) loss = net.trainBatch(data.slice(s, s + 32), lr);
      epoch++;
    }
    return loss;
  }
  const accuracy = () => { let ok = 0; for (const [x, y] of data) if ((net.forward(x) > 0.5 ? 1 : 0) === y) ok++; return ok / data.length; };

  /* ── decision field (bilinear-smooth confidence + contour + points) */
  const EXT = 1.25, FW = bCanvas.width, FH = bCanvas.height;
  const toPx = (x, y) => [((x + EXT) / (2 * EXT)) * FW, ((EXT - y) / (2 * EXT)) * FH];
  function drawField() {
    const G = 64, grid = new Float32Array(G * G);
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const wx = (gx / (G - 1)) * 2 * EXT - EXT, wy = EXT - (gy / (G - 1)) * 2 * EXT;
      grid[gy * G + gx] = net.forward([wx, wy]);
    }
    const img = bx.createImageData(FW, FH), d = img.data;
    for (let py = 0; py < FH; py++) for (let px = 0; px < FW; px++) {
      const fx = (px / (FW - 1)) * (G - 1), fy = (py / (FH - 1)) * (G - 1);
      const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(G - 1, x0 + 1), y1 = Math.min(G - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const p = lerp(lerp(grid[y0 * G + x0], grid[y0 * G + x1], tx), lerp(grid[y1 * G + x0], grid[y1 * G + x1], tx), ty);
      const conf = Math.abs(p - 0.5) * 2;
      const bright = 0.12 + 0.52 * conf;
      let r = lerp(CYAN[0], AMBER[0], p) * bright, g = lerp(CYAN[1], AMBER[1], p) * bright, b = lerp(CYAN[2], AMBER[2], p) * bright;
      if (conf < 0.035) { const m = 1 - conf / 0.035; r = lerp(r, 235, m); g = lerp(g, 245, m); b = lerp(b, 255, m); } // contour
      const i = (py * FW + px) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
    bx.putImageData(img, 0, 0);
    bx.shadowBlur = 8;
    for (const [pt, label] of data) {
      const [cx, cy] = toPx(pt[0], pt[1]);
      bx.beginPath(); bx.arc(cx, cy, FW / 150, 0, 7);
      const col = label ? AMBER : CYAN;
      bx.shadowColor = `rgb(${col[0]},${col[1]},${col[2]})`;
      bx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; bx.fill();
      bx.shadowBlur = 0; bx.lineWidth = FW / 460; bx.strokeStyle = 'rgba(2,6,12,.85)'; bx.stroke(); bx.shadowBlur = 8;
    }
    bx.shadowBlur = 0;
  }

  /* ── loss chart (grid + area fill + current) ─────────────────────── */
  function drawLoss() {
    const r = $('#nn-losschart').getBoundingClientRect(), w = r.width, h = r.height;
    lx.clearRect(0, 0, w, h);
    lx.strokeStyle = 'rgba(255,255,255,.05)'; lx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = (i / 4) * h; lx.beginPath(); lx.moveTo(0, y); lx.lineTo(w, y); lx.stroke(); }
    if (lossHist.length < 2) return;
    const max = Math.max(...lossHist), min = Math.min(...lossHist), rng = max - min + 1e-9;
    const X = (i) => (i / (lossHist.length - 1)) * w, Y = (v) => h - ((v - min) / rng) * (h - 6) - 3;
    const grad = lx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(124,255,107,.28)'); grad.addColorStop(1, 'rgba(124,255,107,0)');
    lx.beginPath(); lx.moveTo(0, h);
    lossHist.forEach((v, i) => lx.lineTo(X(i), Y(v))); lx.lineTo(w, h); lx.closePath();
    lx.fillStyle = grad; lx.fill();
    lx.beginPath(); lossHist.forEach((v, i) => i ? lx.lineTo(X(i), Y(v)) : lx.moveTo(X(i), Y(v)));
    lx.strokeStyle = '#7CFF6B'; lx.lineWidth = 1.6; lx.stroke();
    const last = lossHist[lossHist.length - 1];
    lx.beginPath(); lx.arc(w, Y(last), 2.6, 0, 7); lx.fillStyle = '#caffbd'; lx.fill();
  }

  /* ── architecture diagram with live signal flow ──────────────────── */
  function drawNet() {
    const r = $('#nn-net').getBoundingClientRect(), w = r.width, h = r.height;
    nx.clearRect(0, 0, w, h);
    const px = 0.6 * Math.cos(probe), py = 0.6 * Math.sin(probe);
    net.forward([px, py]);                                   // populate activations
    const cols = [2, ...hidden, 1];
    const acts = [[px, py], ...net.layers.map(l => l.a)];
    const padX = 26, padY = 16;
    const colX = (ci) => padX + (w - 2 * padX) * (cols.length === 1 ? 0.5 : ci / (cols.length - 1));
    const nodeY = (ci, ni) => { const n = cols[ci]; const span = h - 2 * padY; return n === 1 ? h / 2 : padY + span * (ni / (n - 1)); };
    // edges
    for (let ci = 0; ci < net.layers.length; ci++) {
      const L = net.layers[ci];
      for (let o = 0; o < L.nout; o++) for (let i = 0; i < L.nin; i++) {
        const wgt = L.W[o][i], a = Math.min(0.5, Math.abs(wgt) * 0.5);
        if (a < 0.03) continue;
        nx.strokeStyle = wgt >= 0 ? `rgba(53,224,214,${a})` : `rgba(255,176,0,${a})`;
        nx.lineWidth = Math.min(1.6, Math.abs(wgt) * 0.9);
        nx.beginPath(); nx.moveTo(colX(ci), nodeY(ci, i)); nx.lineTo(colX(ci + 1), nodeY(ci + 1, o)); nx.stroke();
      }
    }
    // nodes
    for (let ci = 0; ci < cols.length; ci++) for (let ni = 0; ni < cols[ci]; ni++) {
      const a = acts[ci][ni] ?? 0, mag = Math.min(1, Math.abs(a));
      const col = ci === cols.length - 1 ? [124, 255, 107] : a >= 0 ? CYAN : AMBER;
      nx.beginPath(); nx.arc(colX(ci), nodeY(ci, ni), cols[ci] > 16 ? 3.2 : 5, 0, 7);
      nx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.18 + 0.8 * mag})`;
      nx.shadowBlur = 8 * mag; nx.shadowColor = `rgb(${col[0]},${col[1]},${col[2]})`; nx.fill(); nx.shadowBlur = 0;
      nx.lineWidth = 1; nx.strokeStyle = 'rgba(255,255,255,.12)'; nx.stroke();
    }
    probe += 0.05;
  }

  /* ── loop ────────────────────────────────────────────────────────── */
  function loop() {
    if (running) {
      const loss = trainEpochs(eps);
      lossHist.push(loss); if (lossHist.length > 200) lossHist.shift();
      setTxt('epoch', epoch.toLocaleString());
      setTxt('loss', loss.toFixed(4));
      if (frame % 2 === 0) {
        const acc = accuracy();
        setTxt('acc', (acc * 100).toFixed(1) + '%');
        $('#nn-ring').style.setProperty('--p', (acc * 100).toFixed(1));
        drawField(); drawLoss();
      }
      frame++;
    }
    drawNet();
    raf = requestAnimationFrame(loop);
  }
  requestAnimationFrame(() => loop());

  /* ── controls ────────────────────────────────────────────────────── */
  ov.querySelectorAll('.nn-ds').forEach(b => b.addEventListener('click', () => reset(b.dataset.k)));
  const pauseBtn = $('#nn-pause');
  const togglePause = () => { running = !running; pauseBtn.innerHTML = running ? '❚❚ pause' : '▶ resume'; pauseBtn.classList.toggle('on', !running); $('#nn-status').textContent = running ? 'training' : 'paused'; $('#nn-status').className = 'nn-pill ' + (running ? 'live' : 'idle'); };
  pauseBtn.addEventListener('click', togglePause);
  $('#nn-reset').addEventListener('click', () => reset());
  $('#nn-lr').addEventListener('input', (e) => { lr = parseFloat(e.target.value); setTxt('lrval', lr.toFixed(3)); });
  ov.querySelectorAll('.nn-speed').forEach(b => b.addEventListener('click', () => {
    eps = +b.dataset.s; ov.querySelectorAll('.nn-speed').forEach(x => x.classList.toggle('on', x === b));
  }));

  const detach = () => { cancelAnimationFrame(raf); ov.remove(); document.removeEventListener('keydown', onKey, true); ctx.term.focus(); ctx.shell.out(c.green('neural lab closed.')); ctx.shell.prompt(); };
  const onKey = (e) => {
    if (e.key === 'Escape' || (e.ctrlKey && e.key === ']')) { e.preventDefault(); detach(); }
    else if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 'r') reset();
    else if (['1', '2', '3', '4'].includes(e.key)) reset(['spirals', 'moons', 'circles', 'xor'][+e.key - 1]);
  };
  document.addEventListener('keydown', onKey, true);
  $('#nn-close').addEventListener('click', detach);
}

/* ── markup ──────────────────────────────────────────────────────── */
function buildLab() {
  const el = document.createElement('div');
  el.id = 'nn-overlay';
  const ds = ['spirals', 'moons', 'circles', 'xor'];
  el.innerHTML = `
    <header id="nn-top">
      <div class="nn-brand"><span class="nn-dot"></span> neural lab
        <span class="nn-sub">multilayer perceptron · backprop from scratch</span></div>
      <span class="nn-grow"></span>
      <span id="nn-status" class="nn-pill live">training</span>
      <button id="nn-close" class="nn-x">close ✕</button>
    </header>

    <div id="nn-grid">
      <aside class="nn-panel nn-left">
        <div class="nn-h">dataset</div>
        <div class="nn-seg">${ds.map(k => `<button class="nn-ds" data-k="${k}">${k}</button>`).join('')}</div>

        <div class="nn-h">learning rate <b id="nn-lrval" class="nn-h-v">—</b></div>
        <input id="nn-lr" class="nn-range" type="range" min="0.005" max="0.4" step="0.005" />

        <div class="nn-h">speed</div>
        <div class="nn-seg nn-seg-sm">
          <button class="nn-speed on" data-s="2">1×</button>
          <button class="nn-speed" data-s="4">2×</button>
          <button class="nn-speed" data-s="8">4×</button>
        </div>

        <div class="nn-ctl">
          <button id="nn-pause" class="nn-btn">❚❚ pause</button>
          <button id="nn-reset" class="nn-btn">↻ reset</button>
        </div>

        <div class="nn-h">architecture</div>
        <div class="nn-kv"><span>topology</span><b id="nn-arch">—</b></div>
        <div class="nn-kv"><span>parameters</span><b id="nn-params">—</b></div>
        <div class="nn-kv"><span>activation</span><b>tanh · σ</b></div>
        <div class="nn-kv"><span>optimizer</span><b>mini-batch SGD</b></div>
        <div class="nn-tip">cyan = class 0 · amber = class 1. the field is the network's
          confidence; the bright seam is its decision boundary.</div>
      </aside>

      <main class="nn-center">
        <div class="nn-canvas-h">decision boundary <span>input space ∈ [-1.25, 1.25]²</span></div>
        <div class="nn-fieldwrap"><canvas id="nn-field" width="520" height="520"></canvas></div>
      </main>

      <aside class="nn-panel nn-right">
        <div class="nn-cards">
          <div class="nn-card"><span>epoch</span><b id="nn-epoch">0</b></div>
          <div class="nn-card"><span>loss · BCE</span><b id="nn-loss">—</b></div>
        </div>
        <div class="nn-acc">
          <div id="nn-ring" class="nn-ring" style="--p:0"><div class="nn-ring-in"><b id="nn-acc">—</b><span>accuracy</span></div></div>
        </div>
        <div class="nn-h">loss</div>
        <canvas id="nn-losschart" class="nn-chart"></canvas>
        <div class="nn-h">signal flow</div>
        <canvas id="nn-net" class="nn-chart nn-net"></canvas>
        <div class="nn-foot">space pause · r reset · 1-4 dataset · Esc close</div>
      </aside>
    </div>`;
  document.body.appendChild(el);
  return el;
}
