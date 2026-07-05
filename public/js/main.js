/* ===================================================================
   HERMIT-OS — boot & wiring
   Brings up the orbifold, the CRT terminal, the shell, and the
   raw kernel stream, then attaches the external observer.
   =================================================================== */

import { Bus } from './bus.js';
import { Orbifold } from './orbifold.js';
import { Shell, c } from './shell.js';
import { buildRegistry } from './commands.js';

const $ = (id) => document.getElementById(id);

/* ── shared context ──────────────────────────────────────────────── */
const bus = new Bus();
const state = {
  bootTime: Date.now(),
  turbulence: false,
  dissociated: false,
  elevated: false,
  metricDegen: 0.55,
  kam: 0,
  // no secret is stored client-side; kernel auth uses an HttpOnly session cookie
};

/* ── boot splash ─────────────────────────────────────────────────── */
const BOOT_LINES = [
  ['', 0],
  ['<span class="ok">hermit</span>  ·  interactive systems terminal  ·  booting', 40],
  ['[<span class="ok">  OK  </span>] Mounted virtual filesystem', 80],
  ['[<span class="ok">  OK  </span>] Initialized WebGL field renderer', 80],
  ['[<span class="ok">  OK  </span>] Loaded shell — pipes · history · completion', 80],
  ['[<span class="ok">  OK  </span>] Registered command set', 70],
  ['[<span class="ok">  OK  </span>] Probed edge API', 80],
  ['[<span class="ok">  OK  </span>] Subsystems: python (wasm) · sql (d1) · linux (v86) · neural lab', 110],
  ['[<span class="ok">  OK  </span>] Reached target <span class="ok">Ready</span>', 110],
  ['', 60],
  ['<span class="dim">ready. type `help` to begin.</span>', 200],
];

async function boot() {
  const log = $('boot-log');
  for (const [line, delay] of BOOT_LINES) {
    log.innerHTML += line + '\n';
    await sleep(delay);
  }
  await sleep(280);
  $('boot').classList.add('gone');
  setTimeout(() => { $('boot').remove(); }, 900);
  $('shell').hidden = false;
}

/* ── terminal ────────────────────────────────────────────────────── */
function makeTerminal() {
  const term = new window.Terminal({
    fontFamily: 'DejaVu Sans Mono, JetBrains Mono, Menlo, monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowProposedApi: true,
    theme: {
      background: 'rgba(0,0,0,0)',
      foreground: '#cdd9d5',
      cursor: '#4fd6cc',
      cursorAccent: '#010204',
      selectionBackground: 'rgba(79,214,204,0.22)',
      black: '#010204', red: '#ff5d5d', green: '#6fe06a', yellow: '#e6a83c',
      blue: '#4fd6cc', magenta: '#d96fe0', cyan: '#4fd6cc', white: '#cdd9d5',
      brightBlack: '#8aa09b',
    },
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  try { term.loadAddon(new window.WebLinksAddon.WebLinksAddon()); } catch (_) {}
  term.open($('terminal'));
  // transparent background so the orbifold shows through
  const xtermEl = $('terminal').querySelector('.xterm-viewport');
  if (xtermEl) xtermEl.style.background = 'transparent';
  const fontFor = (w) => (w < 480 ? 10 : w < 700 ? 12 : 14);
  const refit = () => {
    const fs = fontFor(window.innerWidth);
    if (term.options.fontSize !== fs) term.options.fontSize = fs;
    try { fit.fit(); } catch (_) {}
  };
  term.options.fontSize = fontFor(window.innerWidth);
  fit.fit();
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(refit, 120); });
  return { term, fit };
}

/* ── interior telemetry stream (right pane when dissociated) ──────
   Real introspection of the running app: live event-bus traffic plus
   sampled scheduler lag, render rate and JS heap. Nothing invented. */
function startKernelStream() {
  const el = $('kernel-stream');
  const buf = [];
  let fps = 0;
  bus.on('fps', ({ fps: f }) => { fps = f; });

  const push = (line) => {
    if (!state.dissociated) return;
    const ts = ((performance.now()) / 1000).toFixed(3);
    buf.push(`[${ts}] ${line}`);
    while (buf.length > 80) buf.shift();
    el.textContent = buf.join('\n');
    el.scrollTop = el.scrollHeight;
  };

  const compact = (p) => {
    if (p == null) return '';
    if (typeof p !== 'object') return String(p);
    return Object.entries(p).map(([k, v]) => `${k}=${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : v}`).join(' ');
  };

  // real event-bus traffic — every emit the app makes, as it happens
  bus.onAny((ev, p) => push(`bus.emit  ${ev}${p ? '  ' + compact(p) : ''}`));

  // real periodic metrics: main-thread scheduler lag, render rate, heap, live state
  let expected = performance.now() + 700;
  setInterval(() => {
    if (!state.dissociated) { expected = performance.now() + 700; return; }
    const now = performance.now();
    const lag = Math.max(0, now - expected); expected = now + 700;
    const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + 'MiB' : 'n/a';
    push(`sched.lag=${lag.toFixed(1)}ms  render=${fps || '--'}fps  heap=${mem}`);
    const ch = state.chaos;
    push(`state  turbulence=${!!state.turbulence}  elevated=${!!state.elevated}  chaos=${ch && Date.now() < ch.until ? ch.kind : 'none'}`);
  }, 700);
}

/* ── topbar / status wiring ──────────────────────────────────────── */
function wireStatus() {
  const led = $('led-power');
  const sMetric = $('status-metric');
  const sInfo = $('status-info');
  const sLoad = $('status-load');
  const fpsEl = $('fps');

  bus.on('fps', ({ fps }) => { fpsEl.textContent = fps + ' fps'; });

  // show the real Cloudflare PoP serving this request, once known
  fetch('/api/whereami').then(r => r.ok ? r.json() : null).then(d => {
    if (d && d.edge && d.colo && !state.elevated) sInfo.textContent = `edge: ${d.colo}`;
  }).catch(() => {});

  bus.on('turbulence', ({ on }) => {
    led.classList.toggle('unstable', on);
    sMetric.textContent = on ? 'systems: turbulent' : 'systems: nominal';
    $('shell').classList.toggle('turbulent', on);
  });
  bus.on('elevate', ({ on }) => {
    sInfo.textContent = on ? 'mode: kernel' : 'edge: ready';
    sInfo.style.color = on ? '#ff4d4d' : '';
    document.documentElement.style.setProperty('--led', on ? '#ff4d4d' : '');
  });

  // REAL main-thread load average: three EMAs of measured event-loop
  // saturation (~3s/15s/60s constants). Rises when the render or a lab
  // actually saturates the thread; ~0 at idle. Measured, never faked.
  let l1 = 0, l5 = 0, l15 = 0; const SAMPLE = 250; let expect = performance.now() + SAMPLE;
  setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, now - expect); expect = now + SAMPLE;
    const inst = Math.min(4, lag / SAMPLE);                 // event-loop busy fraction
    l1 += (SAMPLE / 3000) * (inst - l1);
    l5 += (SAMPLE / 15000) * (inst - l5);
    l15 += (SAMPLE / 60000) * (inst - l15);
    sLoad.textContent = `load ${l1.toFixed(2)} ${l5.toFixed(2)} ${l15.toFixed(2)}`;
  }, SAMPLE);

  // dissociate button + pane
  $('btn-dissociate').addEventListener('click', () => {
    const shell = window.__hermit.shell;
    shell.run('dissociate');
  });
  bus.on('dissociate', ({ on }) => {
    $('shell').classList.toggle('dissociated', on);
    document.body.classList.toggle('dissociated', on);
    $('kernel-pane').hidden = !on;
    $('btn-dissociate').classList.toggle('active', on);
    // one-shot fracture glitch
    if (on) {
      $('shell').classList.add('fracturing');
      setTimeout(() => $('shell').classList.remove('fracturing'), 1100);
    }
    // the 3D field churns while dissociated
    bus.emit('orbifold:stress', { v: on ? 0.45 : 0 });
    bus.emit('orbifold:pulse', {});
    try { window.__hermit.fit.fit(); } catch (_) {}
  });
}

/* ── welcome banner ──────────────────────────────────────────────── */
function welcome(shell) {
  shell.out('');
  shell.out(c.amber('  ╦ ╦╔═╗╦═╗╔╦╗╦╔╦╗'));
  shell.out(c.amber('  ╠═╣║╣ ╠╦╝║║║║ ║ ') + c.gray('   an interactive systems terminal'));
  shell.out(c.amber('  ╩ ╩╚═╝╩╚═╩ ╩╩ ╩ '));
  shell.out('');
  shell.out(c.gray('  a real shell with real tools — nothing here is a slideshow. try things.'));
  shell.out('');
  shell.out(c.gray('  start    ') + c.green('help') + c.gray(' · ') + c.green('ls /skills') + c.gray(' · ') + c.green('whoami'));
  shell.out(c.gray('  systems  ') + c.green('linux') + c.gray(' (real x86 linux) · ') + c.green('python3') + c.gray(' (real cpython) · ') + c.green('sql "…"'));
  shell.out(c.gray('  sre      ') + c.green('watch slo') + c.gray('  +  ') + c.green('chaos inject --model lorenz --rho 28') + c.gray('  ·  ') + c.green('chaos inject --ramp') + c.gray(' (tipping-point early warning)'));
  shell.out(c.gray('  cluster  ') + c.green('helm install demo webapp') + c.gray(' · ') + c.green('kubectl get pods -w') + c.gray('   (a real orchestrator; pods are real threads)'));
  shell.out(c.gray('  chaos    ') + c.green('lyapunov') + c.gray(' (Lorenz) · ') + c.green('kam') + c.gray(' (KAM tori, standard map) · ') + c.green('induce turbulence') + c.gray(' (measured λ)'));
  shell.out(c.gray('  labs     ') + c.green('train') + c.gray(' (a neural net learns, live) · ') + c.green('sheaf') + c.gray(' + ') + c.green('glue') + c.gray(' (a real CRDT: diverge, then converge)'));
  shell.out(c.gray('  code     ') + c.green('source shell.js') + c.gray(' (this site\'s own source) · ') + c.green('git log') + c.gray(' · ') + c.green('edge'));
  shell.out('');
}

/* ── go ──────────────────────────────────────────────────────────── */
async function main() {
  // 3D first so it's warming up during boot text
  new Orbifold($('orbifold'), bus, state);
  wireStatus();
  startKernelStream();

  await boot();

  const { term, fit } = makeTerminal();
  const ctx = { bus, state, term };
  const registry = buildRegistry(ctx);
  const shell = new Shell(term, registry, ctx);
  ctx.shell = shell;
  ctx.term = term;

  window.__hermit = { shell, term, fit, bus, state, ctx };

  welcome(shell);
  shell.prompt();
  term.onData((d) => shell.onKey(d));
  term.focus();

  // try to hydrate kernel content from KV (read-only is public)
  try {
    const res = await fetch('/api/content');
    if (res.ok) {
      const data = await res.json();
      state.entries = data.entries || [];
      state.aiwassDirectives = data.directives || [];
      state.nextId = (state.entries || []).reduce((m, e) => Math.max(m, e.id), 0);
    }
  } catch (_) {}

  // click anywhere refocuses the terminal (except UI buttons/links)
  document.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('#kernel-pane') || e.target.closest('#vm-overlay')) return;
    term.focus();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
main();
