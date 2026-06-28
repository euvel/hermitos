/* ===================================================================
   HERMIT-OS — shell core
   Line editing, history, tab-completion, dispatch.
   The prompt is, by mathematical decree, always:
       observer@projection:~$
   =================================================================== */

import { normalize, resolve } from './filesystem.js';

/* ── ANSI truecolor helpers (amber/cyan/green minimalism) ─────────── */
const E = '\x1b[';
export const c = {
  reset: E + '0m',
  bold:  E + '1m',
  dim:   E + '2m',
  amber: (s) => `${E}38;2;230;168;60m${s}${E}0m`,
  cyan:  (s) => `${E}38;2;90;214;204m${s}${E}0m`,
  green: (s) => `${E}38;2;111;224;106m${s}${E}0m`,
  red:   (s) => `${E}38;2;255;100;100m${s}${E}0m`,
  mag:   (s) => `${E}38;2;205;120;220m${s}${E}0m`,
  gray:  (s) => `${E}38;2;140;162;156m${s}${E}0m`,   // brighter: readable hint text
  white: (s) => `${E}38;2;215;226;222m${s}${E}0m`,
  on:    (s) => `${E}48;2;16;26;24m${s}${E}0m`,
};

export class Shell {
  constructor(term, registry, ctx) {
    this.term = term;
    this.registry = registry;
    this.ctx = ctx;            // shared HERMIT context (bus, state, etc.)
    this.cwd = '/home/euvel';
    this.buf = '';
    this.cursor = 0;
    this.history = [];
    this.histIdx = 0;
    this.busy = false;         // command running
    this.liveMode = null;      // active full-screen live dashboard, if any
    this._liveTimer = null;
    this.env = {
      USER: 'observer', HOME: '/home/euvel', SHELL: '/bin/hermit-sh',
      HOST: 'projection', TERM: 'xterm-256color', LANG: 'en_US.UTF-8',
      PATH: '/bin:/sbin:/usr/bin', PS1: 'observer@projection:~$',
    };
    ctx.shell = this;
  }

  /* prompt always reflects the decree; ~ collapses home */
  promptStr() {
    if (this.submode) return this.submode.prompt;
    let p = this.cwd;
    if (p === '/home/euvel') p = '~';
    else if (p.startsWith('/home/euvel/')) p = '~' + p.slice('/home/euvel'.length);
    const tag = this.ctx.state.elevated ? c.red('kernel') : c.green('observer');
    const host = this.ctx.state.elevated ? c.red('orbifold') : c.cyan('projection');
    const sigil = this.ctx.state.elevated ? c.red('#') : c.gray('$');   // # = ring-0, like root
    return `${tag}${c.gray('@')}${host}${c.gray(':')}${c.amber(p)}${sigil} `;
  }

  out(line = '') { this.term.write(line.replace(/\n/g, '\r\n') + '\r\n'); }
  write(s) { this.term.write(s); }

  prompt() {
    this.buf = ''; this.cursor = 0; this.histIdx = this.history.length;
    this.write('\r\n' + this.promptStr());
  }

  redraw() {
    // rewrite current line: CR, clear to EOL, prompt + buffer, reposition
    this.write('\r' + E + 'K' + this.promptStr() + this.buf);
    const back = this.buf.length - this.cursor;
    if (back > 0) this.write(E + back + 'D');
  }

  /* a REPL sub-mode (e.g. python3): lines route to onLine instead of dispatch */
  enterSubmode(sm) { this.submode = sm; }   // { prompt, onLine(line), onExit? }
  exitSubmode() { const sm = this.submode; this.submode = null; if (sm && sm.onExit) sm.onExit(); }

  async run(line) {
    if (this.submode) {
      if (line.trim()) this.history.push(line);
      this.histIdx = this.history.length;
      this.busy = true;
      try { await this.submode.onLine(line); } catch (e) { this.out(c.red(String(e))); }
      this.busy = false;
      this.prompt();
      return;
    }
    const trimmed = line.trim();
    if (trimmed) this.history.push(trimmed);
    this.histIdx = this.history.length;
    if (!trimmed) { this.prompt(); return; }

    // support ';' sequencing and basic '|' to grep/less are handled in-command
    const segments = splitTop(trimmed, ';');
    this.busy = true;
    for (const seg of segments) {
      await this.execOne(seg.trim());
    }
    this.busy = false;
    // a live command (e.g. `watch slo`) may have taken over the screen; in that
    // case it owns the prompt and will restore it on exit.
    if (!this.liveMode) this.prompt();
  }

  /* ── live full-screen mode (real-time dashboards: `watch slo`) ───── */
  // opts: { render():string|Promise<string>, intervalMs, onExitMsg, onKeyExtra(d,stop) }
  runLive(opts) {
    const { render, intervalMs = 1000, onExitMsg, onKeyExtra } = opts;
    this.write('\x1b[?25l'); // hide cursor
    const stop = () => {
      if (this._liveTimer) clearInterval(this._liveTimer);
      this._liveTimer = null;
      this.liveMode = null;
      this.write('\x1b[?25h'); // show cursor
      this.write('\x1b[2J\x1b[H');
      if (onExitMsg) this.out(onExitMsg);
      this.prompt();
    };
    const frame = async () => {
      let txt = '';
      try { txt = await render(); } catch (e) { txt = c.red('live render error: ' + e); }
      // home, clear, draw
      this.write('\x1b[H\x1b[2J' + String(txt).replace(/\n/g, '\r\n'));
    };
    this.liveMode = {
      stop,
      onKey: (d) => {
        if (d === 'q' || d === '\x03' || d === '\r' || d === '\x1b') { stop(); return; }
        if (onKeyExtra) onKeyExtra(d, stop);
      },
    };
    frame();
    this._liveTimer = setInterval(frame, intervalMs);
  }

  async execOne(seg) {
    if (!seg) return;
    // pipe support: cmd | grep x | head
    const stages = splitTop(seg, '|').map(s => s.trim());
    let input = null;
    for (let i = 0; i < stages.length; i++) {
      const { name, args } = parse(stages[i]);
      const cmd = this.registry[name];
      const isLast = i === stages.length - 1;
      if (!cmd) {
        this.out(c.red(`hermit-sh: command not found: ${name}`) +
                 c.gray(`  — try `) + c.green('help') + c.gray(' or ') + c.green(`aiwass ask "what is ${name}"`));
        return;
      }
      const piped = { stdin: input, piped: !isLast };
      try {
        const result = await cmd.run(args, this.ctx, piped);
        if (!isLast) {
          // capture stdout for next stage
          input = (typeof result === 'string') ? result : (cmd._captured || '');
        }
      } catch (err) {
        this.out(c.red(`hermit-sh: ${name}: ${err && err.message ? err.message : err}`));
        return;
      }
    }
  }

  /* ── tab completion ─────────────────────────────────────────────── */
  complete() {
    const left = this.buf.slice(0, this.cursor);
    const tokens = left.split(/\s+/);
    const isFirst = tokens.length === 1;
    const frag = tokens[tokens.length - 1] || '';
    let options = [];

    if (isFirst) {
      options = Object.keys(this.registry).filter(k => k.startsWith(frag)).sort();
    } else {
      // path completion
      let dir, partial;
      const slash = frag.lastIndexOf('/');
      if (slash >= 0) { dir = frag.slice(0, slash) || '/'; partial = frag.slice(slash + 1); }
      else { dir = '.'; partial = frag; }
      const abs = normalize(this.cwd, dir);
      const node = resolve(abs);
      if (node && node.type === 'dir') {
        const base = slash >= 0 ? frag.slice(0, slash + 1) : '';
        options = Object.entries(node.children)
          .filter(([n]) => n.startsWith(partial))
          .map(([n, nn]) => base + n + (nn.type === 'dir' ? '/' : ''))
          .sort();
      }
    }

    if (options.length === 0) return;
    if (options.length === 1) {
      const completion = options[0].slice(frag.length);
      this.insert(completion + (isFirst ? ' ' : ''));
    } else {
      const common = longestCommonPrefix(options);
      if (common.length > frag.length) {
        this.insert(common.slice(frag.length));
      } else {
        this.write('\r\n' + options.map(o => c.cyan(o)).join('   ') + '\r\n');
        this.redraw();
      }
    }
  }

  insert(text) {
    this.buf = this.buf.slice(0, this.cursor) + text + this.buf.slice(this.cursor);
    this.cursor += text.length;
    this.redraw();
  }

  /* ── masked secret entry (passwords/tokens: never echoed, never in history) */
  readSecret(label) {
    return new Promise((resolve) => {
      this.write('\r\n' + label);
      this.secretMode = { buf: '', resolve };
    });
  }
  onSecretKey(data) {
    const sm = this.secretMode;
    if (data === '\r') { this.write('\r\n'); this.secretMode = null; sm.resolve(sm.buf); return; }
    if (data === '\x03' || data === '\x1b') { this.write('\r\n'); this.secretMode = null; sm.resolve(null); return; } // Ctrl-C / Esc cancels
    if (data === '\x7f') { if (sm.buf) sm.buf = sm.buf.slice(0, -1); return; }                                        // backspace, silent
    if (data.charCodeAt(0) >= 32) sm.buf += data;                                                                     // accept, no echo
  }

  /* ── key handling ───────────────────────────────────────────────── */
  onKey(data) {
    if (this.liveMode) { this.liveMode.onKey(data); return; } // live dashboard owns keys
    if (this.secretMode) { this.onSecretKey(data); return; }  // masked password entry
    if (this.busy) return;             // ignore input while a command runs
    const code = data.charCodeAt(0);

    // Enter
    if (data === '\r') {
      this.write('\r\n');
      this.run(this.buf);
      return;
    }
    // Ctrl-D (EOF): leave a REPL sub-mode when the line is empty
    if (data === '\x04') {
      if (this.submode && this.buf === '') { this.write('\r\n'); this.exitSubmode(); this.prompt(); }
      return;
    }
    // Ctrl-C
    if (data === '\x03') {
      if (this.submode) { this.write('^C'); this.prompt(); return; }   // stay in REPL
      this.write('^C'); this.prompt(); return;
    }
    // Ctrl-L  (clear)
    if (data === '\x0c') { this.term.clear(); this.write('\r' + E + 'K'); this.redraw(); return; }
    // Ctrl-U (kill line)
    if (data === '\x15') { this.buf = ''; this.cursor = 0; this.redraw(); return; }
    // Ctrl-A / Ctrl-E
    if (data === '\x01') { this.cursor = 0; this.redraw(); return; }
    if (data === '\x05') { this.cursor = this.buf.length; this.redraw(); return; }
    // Ctrl-W (kill word)
    if (data === '\x17') {
      const left = this.buf.slice(0, this.cursor).replace(/\s*\S+\s*$/, '');
      this.buf = left + this.buf.slice(this.cursor);
      this.cursor = left.length; this.redraw(); return;
    }
    // Tab
    if (data === '\t') { this.complete(); return; }
    // Backspace
    if (data === '\x7f') {
      if (this.cursor > 0) {
        this.buf = this.buf.slice(0, this.cursor - 1) + this.buf.slice(this.cursor);
        this.cursor--; this.redraw();
      }
      return;
    }
    // Escape sequences (arrows, home/end, delete)
    if (data === '\x1b[A' || data === '\x1bOA') { this.histPrev(); return; }
    if (data === '\x1b[B' || data === '\x1bOB') { this.histNext(); return; }
    if (data === '\x1b[C' || data === '\x1bOC') { if (this.cursor < this.buf.length) { this.cursor++; this.redraw(); } return; }
    if (data === '\x1b[D' || data === '\x1bOD') { if (this.cursor > 0) { this.cursor--; this.redraw(); } return; }
    if (data === '\x1b[H' || data === '\x1bOH' || data === '\x1b[1~') { this.cursor = 0; this.redraw(); return; }
    if (data === '\x1b[F' || data === '\x1bOF' || data === '\x1b[4~') { this.cursor = this.buf.length; this.redraw(); return; }
    if (data === '\x1b[3~') { // delete
      if (this.cursor < this.buf.length) {
        this.buf = this.buf.slice(0, this.cursor) + this.buf.slice(this.cursor + 1);
        this.redraw();
      }
      return;
    }
    if (data.startsWith('\x1b')) return; // swallow other escapes

    // printable
    if (code >= 32) this.insert(data);
  }

  histPrev() {
    if (this.history.length === 0) return;
    if (this.histIdx > 0) this.histIdx--;
    this.buf = this.history[this.histIdx] || '';
    this.cursor = this.buf.length; this.redraw();
  }
  histNext() {
    if (this.histIdx < this.history.length) this.histIdx++;
    this.buf = this.history[this.histIdx] || '';
    this.cursor = this.buf.length; this.redraw();
  }
}

/* ── parsing helpers ─────────────────────────────────────────────── */
export function parse(line) {
  const tokens = tokenize(line);
  return { name: tokens[0] || '', args: tokens.slice(1) };
}

function tokenize(line) {
  const out = []; let cur = ''; let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === q) q = null; else cur += ch;
    } else if (ch === '"' || ch === "'") { q = ch; }
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// split on a separator but not inside quotes
function splitTop(s, sep) {
  const out = []; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q) q = null; }
    else if (ch === '"' || ch === "'") { q = ch; cur += ch; }
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function longestCommonPrefix(arr) {
  if (!arr.length) return '';
  let p = arr[0];
  for (const s of arr) { while (!s.startsWith(p)) p = p.slice(0, -1); }
  return p;
}
