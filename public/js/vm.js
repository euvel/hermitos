/* ===================================================================
   hermit — `linux` : a real x86 Linux kernel in the browser via v86 (WASM).
   `uname -a`, `unshare`, `strace`, mount — it all works; it's a real kernel.

   The disk/state image is SELF-HOSTED: drop your files in /public/vm/
   and describe them in /public/vm/manifest.json. See public/vm/README.md.
   If no manifest is present, this degrades honestly.
   =================================================================== */

import { c } from './shell.js';

export function vmCommands(send) {
  const run = {
    desc: 'boot a real x86 Linux kernel (v86) in the browser',
    usage: 'linux',
    async run(args, ctx, piped) {
      // if a kernel is already running (backgrounded), just reopen it
      if (ctx.state.linux && ctx.state.linux.show) { ctx.state.linux.show(); return ''; }
      await bootRealLinux(ctx);
      return '';
    },
  };
  // `linux` is the canonical name; `vm` and `boot` are aliases
  return { linux: run, vm: { ...run, desc: 'alias: linux' }, boot: { ...run, desc: 'alias: linux' } };
}

const LIBV86 = 'https://cdn.jsdelivr.net/npm/v86@0.5.228/build/libv86.js';
const DEFAULTS = {
  wasm_path: 'https://cdn.jsdelivr.net/npm/v86@0.5.228/build/v86.wasm',
  bios: 'https://cdn.jsdelivr.net/npm/v86@0.5.228/bios/seabios.bin',
  vga_bios: 'https://cdn.jsdelivr.net/npm/v86@0.5.228/bios/vgabios.bin',
  memory_size: 128 * 1024 * 1024,
  vga_memory_size: 8 * 1024 * 1024,
};

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('network'));
    document.head.appendChild(s);
  });
}

export async function bootRealLinux(ctx) {
  const out = (s) => ctx.shell.out(s);

  // 1. self-hosted manifest
  let manifest;
  try {
    const r = await fetch('/vm/manifest.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('no manifest');
    manifest = await r.json();
  } catch (_) {
    out(instructions());
    return;
  }

  out(c.gray('boot: real-Linux manifest found. loading v86 (x86 emulator, WASM) …'));
  try {
    if (!window.V86 && !window.V86Starter) await loadScript(manifest.libv86 || LIBV86);
  } catch (e) {
    out(c.red('boot: could not load the v86 emulator (offline?). the real kernel needs the v86 runtime.'));
    return;
  }
  const V86 = window.V86 || window.V86Starter;
  if (!V86) { out(c.red('boot: v86 runtime global not found.')); return; }

  // 2. full-screen console: the serial terminal is the star; a sidebar gives a
  //    professional MOTD, live status, and one-click real commands.
  const overlay = buildOverlay(manifest);

  // 3. assemble v86 options from the manifest. We render the serial console only
  //    (the VGA framebuffer is headless here); set manifest.show_vga to surface it.
  const opt = {
    wasm_path: manifest.wasm_path || DEFAULTS.wasm_path,
    memory_size: manifest.memory_size || DEFAULTS.memory_size,
    vga_memory_size: manifest.vga_memory_size || DEFAULTS.vga_memory_size,
    autostart: true,
    disable_mouse: true,
    screen_container: overlay.querySelector('#vm-screen'),        // VGA boot logs
    serial_container_xtermjs: overlay.querySelector('#vm-serial'), // interactive shell
  };
  if (manifest.bios !== null) opt.bios = { url: manifest.bios || DEFAULTS.bios };
  if (manifest.vga_bios !== null) opt.vga_bios = { url: manifest.vga_bios || DEFAULTS.vga_bios };
  for (const k of ['cdrom', 'hda', 'hdb', 'fda']) {
    if (manifest[k]) opt[k] = typeof manifest[k] === 'string' ? { url: manifest[k] } : manifest[k];
  }
  if (manifest.bzimage) opt.bzimage = { url: manifest.bzimage };
  if (manifest.initrd) opt.initrd = { url: manifest.initrd };
  if (manifest.initial_state) opt.initial_state = { url: manifest.initial_state };
  if (manifest.bzimage_initrd_from_filesystem) opt.bzimage_initrd_from_filesystem = true;
  if (manifest.filesystem) opt.filesystem = manifest.filesystem;
  if (manifest.cmdline) opt.cmdline = manifest.cmdline;

  let emulator;
  try { emulator = new V86(opt); }
  catch (e) { out(c.red('boot: v86 init failed: ' + e)); overlay.remove(); return; }

  // ── live status, statistics, boot→shell transition ───────────────
  const pane = overlay.querySelector('#vm-pane');
  const stateEl = overlay.querySelector('#vm-state');
  const setState = (txt, cls) => { stateEl.textContent = txt; stateEl.className = 'vm-chip ' + (cls || ''); };
  const focusShell = () => {
    const s = overlay.querySelector('#vm-serial .xterm-helper-textarea');
    s && s.focus && s.focus();
  };
  const showShell = () => { pane.classList.add('show-shell'); viewBtn.textContent = 'view: shell'; focusShell(); };
  const showBoot  = () => { pane.classList.remove('show-shell'); viewBtn.textContent = 'view: boot log'; };

  const viewBtn = overlay.querySelector('#vm-view');
  viewBtn.addEventListener('click', () => pane.classList.contains('show-shell') ? showBoot() : showShell());

  // statistics: uptime, instructions retired, emulated speed (MIPS)
  const t0 = Date.now();
  const counter = () => { try { return emulator.get_instruction_counter() >>> 0; } catch (_) { return null; } };
  let lastC = counter(), lastT = performance.now();
  const setStat = (id, v) => { const e = overlay.querySelector('#vm-' + id); if (e) e.textContent = v; };
  const statTimer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    setStat('uptime', `${String((s / 60) | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
    const cNow = counter(), tNow = performance.now();
    if (cNow != null && lastC != null) {
      const dC = (cNow - lastC + 0x100000000) % 0x100000000;     // unsigned wrap
      const mips = (dC / ((tNow - lastT) / 1000)) / 1e6;
      if (isFinite(mips)) setStat('mips', mips.toFixed(1) + ' MIPS');
      setStat('insn', formatBig(cNow));
    }
    lastC = cNow; lastT = tNow;
  }, 1000);

  // a handle other subsystems (the AIWASS agent) can drive — a real shell
  // on a real kernel. Populated once, cleared on detach.
  const linux = { emulator, ready: false, exec: null };
  ctx.state.linux = linux;

  // watch the real serial stream: boot → prompt, optional auto-login
  let started = false, sbuf = '', cap = null;
  const onByte = (byte) => {
    const ch = typeof byte === 'number' ? String.fromCharCode(byte) : String(byte);
    sbuf = (sbuf + ch).slice(-200);
    if (cap) { cap.buf += ch; cap.check(); }
    if (!started) { started = true; setState('booting', 'warn'); }
    if (/login:\s*$/i.test(sbuf)) { sbuf = ''; emulator.serial0_send('root\n'); }
    else if (!linux.ready && /[#$%>]\s$/.test(sbuf)) {
      linux.ready = true; setState('shell ready', 'ok');
      setTimeout(showShell, 400);   // let the last boot lines settle, then reveal the shell
    }
  };
  try { emulator.add_listener('serial0-output-byte', onByte); } catch (_) {}

  // ── programmatic exec over the serial line ───────────────────────
  // Sentinel-framed so capture is unambiguous even with the shell's echo
  // ON (so the command is VISIBLE in the pane): the boundary markers are
  // matched only on their OUTPUT form (start followed by a newline; end
  // followed by digits), which the echoed input line never satisfies.
  // Commands are queued (one at a time on the single serial line).
  let execChain = Promise.resolve(), execSeq = 0;
  linux.exec = (cmd, { timeout = 7000 } = {}) => {
    const run = () => new Promise((resolve) => {
      if (!linux.ready) { resolve({ stdout: '', code: null, error: 'shell not ready' }); return; }
      const id = (++execSeq).toString(36) + Math.random().toString(36).slice(2, 6);
      const HB = `__HB_${id}__`, HE = `__HE_${id}__`;
      const startRe = new RegExp(HB + '\\r?\\n');
      const endRe = new RegExp(HE + ':(\\d+)');
      let done = false;
      const finish = (res) => { if (done) return; done = true; clearTimeout(tm); cap = null; resolve(res); };
      const tm = setTimeout(() => finish({ stdout: cap ? cleanOut(cap.buf) : '', code: null, timedout: true }), timeout);
      cap = {
        buf: '',
        check() {
          const sm = this.buf.match(startRe); if (!sm) return;
          const outStart = sm.index + sm[0].length;
          const em = this.buf.slice(outStart).match(endRe); if (!em) return;
          finish({ stdout: cleanOut(this.buf.slice(outStart, outStart + em.index)), code: parseInt(em[1], 10) });
        },
      };
      emulator.serial0_send(`echo ${HB}; ${cmd} 2>&1; echo ${HE}:$?\n`);
    });
    execChain = execChain.then(run, run);
    return execChain;
  };

  // background = keep the kernel running but hidden (so you can drive it
  // from the main terminal / the AIWASS agent); halt = actually free it.
  linux.show = () => { overlay.style.display = ''; setTimeout(focusShell, 60); };
  linux.hide = () => { overlay.style.display = 'none'; };
  const background = () => {
    linux.hide();                                   // keep the kernel + onKey alive; just hide it
    ctx.term.focus();
    ctx.shell.out(c.gray('linux backgrounded — still running. ') + c.green('linux') + c.gray(' reopens it; ') + c.green('aiwass agent') + c.gray(' can run commands on it. (halt it in-panel to free memory.)'));
    ctx.shell.prompt();
  };
  const halt = () => {
    clearInterval(statTimer);
    try { emulator && emulator.destroy && emulator.destroy(); } catch (_) {}
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    ctx.state.linux = null;
    ctx.term.focus();
    ctx.shell.out(c.green('kernel halted. the projection resumes.'));
    ctx.shell.prompt();
  };
  linux.halt = halt;
  const onKey = (e) => {
    if (e.ctrlKey && (e.key === ']' || e.code === 'BracketRight')) { e.preventDefault(); background(); }
  };
  document.addEventListener('keydown', onKey, true);
  overlay.querySelector('#vm-detach').addEventListener('click', background);
  const haltBtn = overlay.querySelector('#vm-halt'); if (haltBtn) haltBtn.addEventListener('click', halt);
  ctx.state.vmDetach = background;
  setState('booting', 'warn');

  out(c.gray('kernel booting — watch the log; the shell opens when it settles. Ctrl-] to background (keeps it running).'));
}

function buildOverlay(manifest) {
  const mem = Math.round((manifest.memory_size || DEFAULTS.memory_size) / (1024 * 1024));
  const img = manifest.cdrom || manifest.bzimage || manifest.initial_state || 'image';
  const imgName = String(img).split('/').pop();

  // abstract nudges toward interesting territory — no claims, just invitations
  const TRY = [
    'uname -a', 'cat /proc/cpuinfo', 'cat /proc/meminfo', 'ls /proc',
    'unshare -U -r whoami', 'mount', 'top', 'cat /proc/1/status',
  ];

  const el = document.createElement('div');
  el.id = 'vm-overlay';
  el.innerHTML = `
    <div id="vm-bar">
      <span class="vm-led"></span>
      <span class="vm-title">HERMIT-OS&nbsp;&nbsp;·&nbsp;&nbsp;kernel</span>
      <span id="vm-state" class="vm-chip warn">booting</span>
      <span class="vm-grow"></span>
      <button id="vm-view" class="vm-toggle">view: boot log</button>
      <span class="vm-hint">Ctrl-] background</span>
      <button id="vm-detach">background ⇲</button>
      <button id="vm-halt">halt ✕</button>
    </div>
    <div id="vm-stage">
      <aside id="vm-side">
        <div class="vm-side-h">kernel statistics</div>
        <div class="vm-stats">
          <div><span>state</span><b id="vm-statetxt">—</b></div>
          <div><span>uptime</span><b id="vm-uptime">00:00</b></div>
          <div><span>instructions</span><b id="vm-insn">—</b></div>
          <div><span>emulated speed</span><b id="vm-mips">—</b></div>
          <div><span>arch</span><b>i686 (32-bit)</b></div>
          <div><span>memory</span><b>${mem} MiB</b></div>
          <div><span>image</span><b title="${imgName}">${imgName}</b></div>
        </div>
        <div class="vm-side-h">things to try, once the shell opens</div>
        <ul class="vm-try">
          ${TRY.map(cmd => `<li><code>${cmd}</code></li>`).join('')}
        </ul>
        <div class="vm-tip vm-dim">click the console to type · <code>Ctrl-]</code> or “detach” to return.</div>
      </aside>
      <main id="vm-pane" class="vm-pane">
        <div class="vm-conlabel"><span class="vm-lbl-boot">boot log · kernel console</span><span class="vm-lbl-shell">shell · ttyS0</span></div>
        <div id="vm-serial"></div>
        <div id="vm-boot">
          <div id="vm-screen"><div class="vm-text"></div><canvas class="vm-canvas"></canvas></div>
          <div class="vm-booting"><span class="vm-spin"></span> bringing the kernel up…</div>
        </div>
      </main>
    </div>`;
  document.body.appendChild(el);
  // mirror the state chip text into the stats panel
  const obs = new MutationObserver(() => {
    const s = el.querySelector('#vm-state'); const t = el.querySelector('#vm-statetxt');
    if (s && t) t.textContent = s.textContent.replace(/^[●\s]+/, '');
  });
  obs.observe(el.querySelector('#vm-state'), { childList: true });
  return el;
}

// strip ANSI escapes and CRs from captured stdout (the sentinel capture
// already stops before the next prompt, so there is none to remove)
function cleanOut(s) {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').trim();
}

function formatBig(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  return String(n);
}

function instructions() {
  return [
    c.amber('boot: no real-Linux image installed yet.') + c.gray('  HERMIT-OS will not fake a kernel.'),
    '',
    c.gray('  `linux` runs a GENUINE x86 Linux kernel in the browser via v86.'),
    c.gray('  To enable it, self-host a small image (a few MB) and a manifest:'),
    '',
    c.gray('   1. put a v86-compatible image in ') + c.cyan('public/vm/') + c.gray('  (ISO, bzImage+initrd, or a saved state)'),
    c.gray('   2. create ') + c.cyan('public/vm/manifest.json') + c.gray('  — see ') + c.cyan('public/vm/README.md') + c.gray(' for ready-to-copy examples'),
    c.gray('   3. redeploy. `linux` will then boot it full-screen.'),
    '',
    c.gray('  See public/vm/README.md to add an image.'),
  ].join('\n');
}
