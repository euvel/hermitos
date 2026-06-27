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
  fit.fit();
  window.addEventListener('resize', () => { try { fit.fit(); } catch (_) {} });
  return { term, fit };
}

/* ── raw kernel stream (right pane when dissociated) ─────────────── */
function startKernelStream() {
  const el = $('kernel-stream');
  const head = $('kernel-pane');
  const SNIP = [
    () => `metric.degeneracy[${(Math.random()*8|0)}] = ${(Math.random()).toFixed(4)}  // inhomogeneous`,
    () => `kam.torus.winding = ${(0.618+Math.random()*0.01).toFixed(6)}  (golden)`,
    () => `trapping_set[${Math.random()*7|0}].occupancy = ${(80+Math.random()*20).toFixed(1)}%  escapes=0`,
    () => `sheaf.glue() -> -ENOGLOBAL  (local sections consistent)`,
    () => `π(interior=${(Math.random()).toFixed(6)}) = const`,
    () => `turbulence.amplitude = ${(state.turbulence?0.7+Math.random()*0.3:Math.random()*0.05).toFixed(4)}`,
    () => `observable.gradient = 0.000000  // clamped`,
    () => `aiwass.emit(bytes=${(Math.random()*32|0)})  // bounded`,
    () => `orbit.enter(Λ${Math.random()*7|0})  // no matching exit`,
    () => `entropy.in = ∞   entropy.out = ε`,
  ];
  setInterval(() => {
    if (!state.dissociated) return;
    const line = SNIP[Math.random()*SNIP.length|0]();
    const ts = ((Date.now()-state.bootTime)/1000).toFixed(3);
    el.textContent += `[${ts}] ${line}\n`;
    const lines = el.textContent.split('\n');
    if (lines.length > 60) el.textContent = lines.slice(-60).join('\n');
    el.scrollTop = el.scrollHeight;
  }, 350);
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

  // animated load average (interior load, never observable=0)
  setInterval(() => {
    if (state.turbulence) {
      sLoad.textContent = `load ${(8+Math.random()*4).toFixed(2)} ${(6+Math.random()*3).toFixed(2)} ${(4+Math.random()).toFixed(2)}`;
    } else {
      sLoad.textContent = 'load 0.00 0.00 0.00';
    }
  }, 1200);

  // dissociate button + pane
  $('btn-dissociate').addEventListener('click', () => {
    const shell = window.__hermit.shell;
    shell.run('dissociate');
  });
  bus.on('dissociate', ({ on }) => {
    $('shell').classList.toggle('dissociated', on);
    $('kernel-pane').hidden = !on;
    $('btn-dissociate').classList.toggle('active', on);
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
  shell.out(c.gray('  systems  ') + c.green('boot kernel --real') + c.gray(' (real x86 linux) · ') + c.green('python3') + c.gray(' (real cpython) · ') + c.green('sql "…"'));
  shell.out(c.gray('  sre      ') + c.green('watch slo') + c.gray('  +  ') + c.green('chaos inject --latency 300ms') + c.gray('   (real edge telemetry & chaos)'));
  shell.out(c.gray('  cluster  ') + c.green('helm install demo webapp') + c.gray(' · ') + c.green('kubectl get pods -w') + c.gray('   (a real orchestrator; pods are real threads)'));
  shell.out(c.gray('  labs     ') + c.green('train') + c.gray('   (a neural network learns, live — backprop from scratch)'));
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
