/* ===================================================================
   HERMIT-OS — boot & wiring
   Brings up the orbifold, the CRT terminal, the shell, and the
   raw kernel stream, then attaches the external observer.
   =================================================================== */

import { Bus } from './bus.js';
import { Orbifold } from './orbifold.js';
import { Shell, c } from './shell.js';
import { buildRegistry } from './commands.js';
import { initObserver } from './observer.js';

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

/* ── cinematic entry ─────────────────────────────────────────────────
   No fake boot logs (that was chest-beating). The mark resolves from dark,
   an understated wordmark + one humble line fade in, then it lifts — on a
   keypress, a click, the "enter" button, or after a short beat. */
const CINE_TAG = 'a working terminal — not a page. look around.';

function boot() {
  return new Promise((resolve) => {
    const el = $('boot');
    $('cine-tag').textContent = CINE_TAG;
    requestAnimationFrame(() => el.classList.add('reveal'));
    const enterBtn = $('cine-enter');
    setTimeout(() => { enterBtn.hidden = false; }, 1300);

    let done = false;
    const finish = () => {
      if (done) return; done = true;
      window.removeEventListener('keydown', finish);
      window.removeEventListener('pointerdown', finish);
      el.classList.add('gone');
      setTimeout(() => el.remove(), 1050);
      $('shell').hidden = false;
      resolve();
    };
    enterBtn.addEventListener('click', finish);
    // let the reveal breathe before a stray click/keypress can skip it
    setTimeout(() => {
      window.addEventListener('keydown', finish);
      window.addEventListener('pointerdown', finish);
    }, 700);
    setTimeout(finish, 4400);   // auto-advance if they just watch
  });
}

/* ── terminal ────────────────────────────────────────────────────── */
function makeTerminal() {
  const term = new window.Terminal({
    fontFamily: '"JetBrains Mono", "SF Mono", "DejaVu Sans Mono", Menlo, monospace',
    fontSize: 14,
    lineHeight: 1.25,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    allowProposedApi: true,
    theme: {
      background: 'rgba(0,0,0,0)',
      foreground: '#d6ddda',
      cursor: '#57d6cc',
      cursorAccent: '#050708',
      selectionBackground: 'rgba(87,214,204,0.24)',
      black: '#050708', red: '#ff6b6b', green: '#74dd6f', yellow: '#e3a94a',
      blue: '#57d6cc', magenta: '#cf8fd6', cyan: '#57d6cc', white: '#d6ddda',
      brightBlack: '#86988f',
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
  const sInfo = $('status-info');       // ctx slot: the kernel mode (𝑖 / ℝ / ℂ / kernel)
  const sEdge = $('status-edge');       // real Cloudflare PoP, independent of mode
  const sLoad = $('status-load');
  const fpsEl = $('fps');

  // the mode readout, kept in one place so events don't clobber the edge PoP
  const paintMode = () => {
    if (state.elevated) { sInfo.textContent = 'kernel'; sInfo.style.color = '#ff6b6b'; return; }
    sInfo.style.color = '';
    sInfo.textContent = state.mode === 'real'
      ? 'ℝ real'
      : (state.published ? 'ℂ complex' : '𝑖 imaginary');
  };
  paintMode();

  bus.on('fps', ({ fps }) => { fpsEl.textContent = fps + ' fps'; });

  // complex-terminal mode indicator (ℝ real Linux · 𝑖 imaginary résumé kernel)
  bus.on('mode', ({ mode }) => { state.mode = mode; paintMode(); });

  // the observer field owns the single /api/whereami fetch; when the instance
  // collapses, surface the real PoP and a quiet instance signature in the bar
  const sInst = $('status-inst');
  bus.on('observer:ready', ({ instance }) => {
    if (instance.edge && instance.edge.colo) sEdge.textContent = instance.edge.colo;
    if (sInst && instance.id) sInst.textContent = '#' + instance.id;
  });

  bus.on('turbulence', ({ on }) => {
    led.classList.toggle('unstable', on);
    sMetric.textContent = on ? 'turbulent' : 'nominal';
    sMetric.style.color = on ? 'var(--red)' : '';
    $('shell').classList.toggle('turbulent', on);
  });
  bus.on('elevate', ({ on }) => {
    state.elevated = on; paintMode();
    document.documentElement.style.setProperty('--led', on ? '#ff6b6b' : '');
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

/* ── the greeter: AIWASS meets the observer (humble, guiding) ─────── */
async function greet(shell) {
  const t = shell.term;
  const line = (s = '') => t.write(s.replace(/\n/g, '\r\n') + '\r\n');
  t.write('\r\n');
  t.write(c.mag('  ◍ aiwass')); await sleep(220);
  const lines = [
    '',
    c.white("  Welcome. I look after this place — I'll point, you explore."),
    c.gray('  Behind it is the work of a systems engineer: things you can read,'),
    c.gray('  run, and push on until they bend. Nothing here is a picture of itself.'),
    '',
    c.gray('  ▸ want the tour?    ') + c.green('aiwass guide') + c.gray('   — or the buttons below, no typing needed'),
    c.gray('  ▸ rather wander?    ') + c.green('help') + c.gray('  ·  ') + c.green('ls /skills') + c.gray('  ·  ') + c.green('whoami'),
    '',
  ];
  for (const l of lines) { line(l); await sleep(75); }
}

/* clickable quick-actions bar → run a command as if typed (the no-typing path) */
function wireQuickbar(shell, term) {
  const bar = $('quickbar');
  if (!bar) return;
  const run = (cmd) => {
    if (shell.busy || shell.liveMode || shell.secretMode || shell.submode || shell.mode === 'real') return;
    term.focus();
    shell.write(cmd + '\r\n');
    shell.run(cmd);
  };
  bar.querySelectorAll('.qb').forEach((b) => b.addEventListener('click', () => run(b.dataset.cmd)));
  // the click-only path is for the imaginary kernel; hide it inside real Linux
  bus.on('mode', ({ mode }) => bar.classList.toggle('hidden', mode === 'real'));
}

/* ── go ──────────────────────────────────────────────────────────── */
async function main() {
  // 3D first so it's warming up during boot text
  new Orbifold($('orbifold'), bus, state);
  wireStatus();
  startKernelStream();
  // the observer field starts watching immediately — dwell counts from the
  // entry screen — and collapses this instance's seed (fed to the attractor)
  initObserver({ bus, state });

  await boot();

  // ensure the real typeface is loaded before xterm measures cell metrics
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load('400 14px "JetBrains Mono"'),
        document.fonts.load('700 14px "JetBrains Mono"'),
      ]);
      await document.fonts.ready;
    }
  } catch (_) {}

  const { term, fit } = makeTerminal();
  const ctx = { bus, state, term };
  const registry = buildRegistry(ctx);
  const shell = new Shell(term, registry, ctx);
  ctx.shell = shell;
  ctx.term = term;

  window.__hermit = { shell, term, fit, bus, state, ctx };

  term.onData((d) => shell.onKey(d));
  wireQuickbar(shell, term);
  await greet(shell);
  shell.prompt();
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
