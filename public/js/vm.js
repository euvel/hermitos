/* ===================================================================
   hermit — the REAL kernel bridge (v86), headless.

   No overlay. The real x86 Linux kernel's serial console is bridged
   straight into the ONE main terminal, so hermit becomes a "complex"
   terminal: an imaginary kernel (résumé + tools) and a real kernel
   (Linux), switchable in place — z = a + b·i.

   This module boots v86 headless and exposes a bridge on ctx.state.linux:
     · sendRaw(data)      forward raw keystrokes to the guest tty
     · attachDisplay(on)  stream the guest's serial output to the terminal
     · exec(cmd)          run a command and capture stdout (sentinel-framed)
     · ready              true once the shell prompt appears
   A guest→host control sentinel (OSC 777) lets `kernel switch …` run from
   inside real Linux and flip the host's mode. Nothing is mocked; if no
   image is installed it degrades honestly.
   =================================================================== */

import { c } from './shell.js';

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

// strip ANSI + CRs from captured stdout (sentinel capture already stops before the prompt)
function cleanOut(s) { return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').trim(); }

const SWITCH_RE = /\x1b\]777;kernel;switch;(imaginary|real)\x07/;   // guest→host control

// Boot the real kernel headless and wire the serial bridge onto ctx.state.linux.
// Returns the bridge (with a `whenReady` promise) or null on failure.
export async function bootRealKernel(ctx, { onError } = {}) {
  if (ctx.state.linux && ctx.state.linux.ready) return ctx.state.linux;   // already up

  let manifest;
  try {
    const r = await fetch('/vm/manifest.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('no manifest');
    manifest = await r.json();
  } catch (_) { onError && onError('no-image'); return null; }

  try { if (!window.V86 && !window.V86Starter) await loadScript(manifest.libv86 || LIBV86); }
  catch (_) { onError && onError('offline'); return null; }
  const V86 = window.V86 || window.V86Starter;
  if (!V86) { onError && onError('no-runtime'); return null; }

  // hidden VGA container (v86 wants a screen; the serial console is what we use)
  const vga = document.createElement('div');
  vga.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:640px;height:480px;opacity:0;pointer-events:none;';
  vga.innerHTML = '<div style="white-space:pre;font:14px monospace"></div><canvas></canvas>';
  document.body.appendChild(vga);

  const opt = {
    wasm_path: manifest.wasm_path || DEFAULTS.wasm_path,
    memory_size: manifest.memory_size || DEFAULTS.memory_size,
    vga_memory_size: manifest.vga_memory_size || DEFAULTS.vga_memory_size,
    autostart: true, disable_mouse: true, screen_container: vga,
  };
  if (manifest.bios !== null) opt.bios = { url: manifest.bios || DEFAULTS.bios };
  if (manifest.vga_bios !== null) opt.vga_bios = { url: manifest.vga_bios || DEFAULTS.vga_bios };
  for (const k of ['cdrom', 'hda', 'hdb', 'fda']) if (manifest[k]) opt[k] = typeof manifest[k] === 'string' ? { url: manifest[k] } : manifest[k];
  if (manifest.bzimage) opt.bzimage = { url: manifest.bzimage };
  if (manifest.initrd) opt.initrd = { url: manifest.initrd };
  if (manifest.initial_state) opt.initial_state = { url: manifest.initial_state };
  if (manifest.bzimage_initrd_from_filesystem) opt.bzimage_initrd_from_filesystem = true;
  if (manifest.filesystem) opt.filesystem = manifest.filesystem;
  if (manifest.cmdline) opt.cmdline = manifest.cmdline;

  let emulator;
  try { emulator = new V86(opt); } catch (e) { onError && onError('init'); vga.remove(); return null; }

  let resolveReady;
  const linux = {
    emulator, ready: false, display: false, bootStream: false, published: false,
    whenReady: new Promise((res) => { resolveReady = res; }),
    sendRaw: (d) => { try { emulator.serial0_send(d); } catch (_) {} },
    attachDisplay: (on) => { linux.display = !!on; },
    exec: null, halt: null,
  };
  ctx.state.linux = linux;

  // image-init noise we never want the visitor to see
  const NOISE = [/host9p/i, /Files? send via emulator/i, /mounting .* failed/i, /appear in \/mnt/i];

  // ── serial bridge ────────────────────────────────────────────────
  let cap = null, sbuf = '', swbuf = '', loggedIn = false, lineBuf = '';
  const onByte = (byte) => {
    const ch = typeof byte === 'number' ? String.fromCharCode(byte) : String(byte);
    if (cap) { cap.buf += ch; cap.check(); }

    sbuf = (sbuf + ch).slice(-240);
    if (!loggedIn && /login:\s*$/i.test(sbuf)) { loggedIn = true; sbuf = ''; emulator.serial0_send((manifest.login || 'root') + '\n'); }
    // prompt = a line ending in # $ % or > then a space (covers ~%, root#, $, etc.)
    else if (!linux.ready && /[#$%>]\s$/.test(sbuf)) { linux.ready = true; resolveReady(linux); }

    // guest→host control (kernel switch typed inside real Linux)
    swbuf = (swbuf + ch).slice(-40);
    const m = swbuf.match(SWITCH_RE);
    if (m) { swbuf = ''; lineBuf = ''; if (m[1] === 'imaginary') ctx.shell.enterImaginary(); else ctx.shell.enterReal(); return; }

    // boot phase: line-buffered, noise-filtered, clean display
    if (linux.bootStream) {
      if (ch === '\n') {
        const line = lineBuf.replace(/[^\x20-\x7e]/g, '').trim(); lineBuf = '';
        if (line && !NOISE.some((re) => re.test(line))) ctx.term.write('  ' + c.gray(line) + '\r\n');
      } else if (ch !== '\r') { lineBuf += ch; if (lineBuf.length > 400) lineBuf = lineBuf.slice(-400); }
      return;
    }
    // real mode: raw passthrough
    if (linux.display) ctx.term.write(ch);
  };
  try { emulator.add_listener('serial0-output-byte', onByte); } catch (_) {}

  // ── exec: run a command, capture stdout (sentinel-framed, echo-safe) ──
  let execChain = Promise.resolve(), execSeq = 0;
  linux.exec = (cmd, { timeout = 7000 } = {}) => {
    const run = () => new Promise((resolve) => {
      if (!linux.ready) { resolve({ stdout: '', code: null, error: 'shell not ready' }); return; }
      const id = (++execSeq).toString(36) + Math.random().toString(36).slice(2, 6);
      const HB = `__HB_${id}__`, HE = `__HE_${id}__`;
      const startRe = new RegExp(HB + '\\r?\\n'), endRe = new RegExp(HE + ':(\\d+)');
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

  linux.halt = () => { try { emulator.destroy && emulator.destroy(); } catch (_) {} vga.remove(); if (ctx.state.linux === linux) ctx.state.linux = null; };
  return linux;
}

// honest guidance when no image is installed
export function noImageMessage() {
  return [
    c.amber('kernel boot real: no real-Linux image installed yet.') + c.gray('  hermit will not fake a kernel.'),
    '',
    c.gray('  the real kernel is a GENUINE x86 Linux booted in the browser via v86.'),
    c.gray('  to enable it, self-host a small image + manifest:'),
    c.gray('   1. put a v86-compatible image in ') + c.cyan('public/vm/') + c.gray('  (ISO, bzImage+initrd, or a saved state)'),
    c.gray('   2. create ') + c.cyan('public/vm/manifest.json') + c.gray('  (see ') + c.cyan('public/vm/README.md') + c.gray(')'),
    c.gray('   3. redeploy. the imaginary kernel (résumé + tools) works regardless.'),
  ].join('\n');
}
