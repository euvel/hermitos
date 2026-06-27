/* ===================================================================
   HERMIT-OS — command registry (core Linux verbs)
   Custom HERMIT verbs live in hermit.js / chaos.js / aiwass.js / kernel.js
   and are merged in by buildRegistry().
   =================================================================== */

import { c } from './shell.js';
import {
  fs, resolve, readFile, listDir, normalize, FS_VERSION,
} from './filesystem.js';
import { hermitCommands } from './hermit.js';
import { sloCommands } from './slo.js';
import { k8sCommands } from './k8s.js';
import { pythonCommands } from './python.js';
import { codeCommands } from './code.js';
import { dataCommands } from './data.js';
import { edgeCommands, edgeLine } from './edge.js';
import { nnCommands } from './nn.js';
import { aiwassCommands } from './aiwass.js';
import { kernelCommands } from './kernel.js';

/* ── output helper: respect pipes ────────────────────────────────── */
function send(text, ctx, piped) {
  if (piped && piped.piped) return text;
  if (text !== undefined && text !== null && text !== '') ctx.shell.out(text);
  return '';
}

function absPath(ctx, p) { return normalize(ctx.shell.cwd, p); }
function lines(s) { return (s ?? '').split('\n'); }

function fmtMode(node) {
  return node.mode || (node.type === 'dir' ? 'dr-xr-xr-x' : '-r--r--r--');
}

/* ── ls ──────────────────────────────────────────────────────────── */
function colorName(name, node) {
  if (node.type === 'dir') return c.cyan(name + '/');
  if ((node.mode || '').includes('x')) return c.green(name);
  if (name.startsWith('.')) return c.gray(name);
  return c.white(name);
}

const core = {
  help: {
    desc: 'list the permitted verbs',
    run(args, ctx, piped) {
      const reg = ctx.shell.registry;
      const groups = {
        'filesystem': ['ls', 'cd', 'pwd', 'cat', 'tree', 'find', 'grep', 'head', 'tail', 'wc', 'stat', 'file', 'du'],
        'system':     ['whoami', 'id', 'uname', 'uptime', 'top', 'ps', 'free', 'env', 'date', 'dmesg', 'journalctl', 'strace', 'lsof', 'systemctl', 'kill'],
        'trace/perf': ['bpftrace', 'perf', 'ltrace', 'vmstat', 'lscpu'],
        'network':    ['ip', 'ping', 'ss', 'curl', 'dig', 'traceroute', 'edge'],
        'dev (real)': ['python3', 'source', 'git', 'sql'],
        'labs':       ['train'],
        'intelligence': ['aiwass'],
        'hermit':     ['whoami', 'observe', 'project', 'dissociate', 'induce', 'glue', 'sheaf', 'orbifold', 'kam', 'metric', 'trap', 'boot'],
        'devops':     ['chaos', 'watch', 'kubectl', 'helm'],
        'intelligence':['aiwass'],
        'kernel':     ['kernel', 'sudo', 'su'],
        'misc':       ['echo', 'clear', 'history', 'man', 'neofetch', 'banner', 'cowsay', 'fortune', 'base64', 'sha256sum', 'exit'],
      };
      const buf = [];
      buf.push(c.amber('hermit') + c.gray(' — command reference'));
      buf.push('');
      for (const [g, cmds] of Object.entries(groups)) {
        const avail = cmds.filter(x => reg[x]);
        if (!avail.length) continue;
        buf.push('  ' + c.cyan(g.padEnd(14)) + avail.map(x => c.green(x)).join(c.gray(' · ')));
      }
      buf.push('');
      buf.push(c.gray('  pipes (|), sequencing (;), tab-completion, history (↑/↓), Ctrl-L all work.'));
      buf.push(c.gray('  start here: ') + c.green('aiwass guide') + c.gray('  ·  ') + c.green('man hermit') + c.gray('  ·  ') + c.green('ls /skills'));
      return send(buf.join('\n'), ctx, piped);
    },
  },

  ls: {
    desc: 'list directory contents', usage: 'ls [-l] [-a] [path]',
    run(args, ctx, piped) {
      const flags = args.filter(a => a.startsWith('-')).join('');
      const long = flags.includes('l');
      const all = flags.includes('a');
      const targets = args.filter(a => !a.startsWith('-'));
      const path = absPath(ctx, targets[0] || '.');
      const node = resolve(path);
      if (!node) return send(c.red(`ls: cannot access '${targets[0] || '.'}': No such file or directory`), ctx, piped);
      if (node.type === 'file') {
        return send(targets[0] || path, ctx, piped);
      }
      let entries = Object.entries(node.children);
      if (!all) entries = entries.filter(([n]) => !n.startsWith('.'));
      entries.sort(([a], [b]) => a.localeCompare(b));
      if (long) {
        const rows = entries.map(([name, n]) => {
          const size = (typeof n.content === 'string' ? n.content.length : (n.type === 'dir' ? Object.keys(n.children).length * 64 : 4096));
          return `${c.gray(fmtMode(n))} ${c.gray('euvel  euvel')} ${String(size).padStart(6)} ${c.gray('— ')}${colorName(name, n)}`;
        });
        return send([c.gray(`total ${entries.length}`), ...rows].join('\n'), ctx, piped);
      }
      return send(entries.map(([name, n]) => colorName(name, n)).join('   '), ctx, piped);
    },
  },

  ll: { desc: 'ls -l', run(args, ctx, piped) { return core.ls.run(['-la', ...args], ctx, piped); } },

  cd: {
    desc: 'change directory', usage: 'cd [path]',
    run(args, ctx) {
      const target = args[0] || '/home/euvel';
      const path = absPath(ctx, target);
      const node = resolve(path);
      if (!node) return ctx.shell.out(c.red(`cd: no such file or directory: ${target}`));
      if (node.type !== 'dir') return ctx.shell.out(c.red(`cd: not a directory: ${target}`));
      ctx.shell.cwd = path === '' ? '/' : path;
      ctx.bus.emit('cd', { path: ctx.shell.cwd });
    },
  },

  pwd: { desc: 'print working directory', run(a, ctx, p) { return send(ctx.shell.cwd, ctx, p); } },

  cat: {
    desc: 'concatenate and print files', usage: 'cat <file>...',
    run(args, ctx, piped) {
      if (!args.length) return send(piped?.stdin ?? '', ctx, piped);
      const out = [];
      for (const a of args) {
        const node = resolve(absPath(ctx, a));
        if (!node) { out.push(c.red(`cat: ${a}: No such file or directory`)); continue; }
        if (node.type === 'dir') { out.push(c.red(`cat: ${a}: Is a directory`)); continue; }
        if ((node.mode || '').startsWith('-r--------') && !ctx.state.elevated && a.includes('.secret')) {
          // readable, but hint at the ritual
        }
        out.push(readFile(node, ctx.state));
      }
      return send(out.join('\n'), ctx, piped);
    },
  },

  tree: {
    desc: 'recursive directory listing', usage: 'tree [path]',
    run(args, ctx, piped) {
      const start = absPath(ctx, args[0] || '.');
      const root = resolve(start);
      if (!root || root.type !== 'dir') return send(c.red(`tree: ${args[0] || '.'}: not a directory`), ctx, piped);
      const out = [c.cyan(start)];
      let dirs = 0, files = 0;
      const walk = (node, prefix, depth) => {
        if (depth > 4) return;
        const entries = Object.entries(node.children).filter(([n]) => !n.startsWith('.'));
        entries.forEach(([name, n], i) => {
          const last = i === entries.length - 1;
          const branch = last ? '└── ' : '├── ';
          out.push(c.gray(prefix + branch) + colorName(name, n));
          if (n.type === 'dir') { dirs++; walk(n, prefix + (last ? '    ' : '│   '), depth + 1); }
          else files++;
        });
      };
      walk(root, '', 0);
      out.push('');
      out.push(c.gray(`${dirs} directories, ${files} files`));
      return send(out.join('\n'), ctx, piped);
    },
  },

  find: {
    desc: 'search for files', usage: 'find [path] [-name pattern] [-type f|d]',
    run(args, ctx, piped) {
      const start = absPath(ctx, args.find(a => !a.startsWith('-')) || '.');
      const nameIdx = args.indexOf('-name');
      const pattern = nameIdx >= 0 ? args[nameIdx + 1] : null;
      const typeIdx = args.indexOf('-type');
      const wantType = typeIdx >= 0 ? args[typeIdx + 1] : null;
      const root = resolve(start);
      if (!root) return send(c.red(`find: '${start}': No such file or directory`), ctx, piped);
      const out = [];
      const re = pattern ? new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$') : null;
      const walk = (node, path) => {
        const base = path.split('/').pop() || '/';
        const tch = node.type === 'dir' ? 'd' : 'f';
        const okType = !wantType || wantType === tch;
        const okName = !re || re.test(base);
        if (okType && okName) out.push(node.type === 'dir' ? c.cyan(path) : path);
        if (node.type === 'dir') for (const [n, child] of Object.entries(node.children)) walk(child, path === '/' ? '/' + n : path + '/' + n);
      };
      walk(root, start);
      return send(out.join('\n'), ctx, piped);
    },
  },

  grep: {
    desc: 'search text', usage: 'grep [-r] [-i] pattern [path]',
    run(args, ctx, piped) {
      const flags = args.filter(a => a.startsWith('-')).join('');
      const rec = flags.includes('r');
      const ic = flags.includes('i');
      const rest = args.filter(a => !a.startsWith('-'));
      const pattern = rest[0];
      if (!pattern) return send(c.red('usage: grep [-r] [-i] pattern [path]'), ctx, piped);
      const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ic ? 'i' : '');
      const out = [];
      const hl = (line) => line.replace(new RegExp(pattern, ic ? 'gi' : 'g'), m => c.amber(m));

      if (piped && piped.stdin != null) {
        lines(piped.stdin).forEach(l => { if (re.test(stripAnsi(l))) out.push(hl(stripAnsi(l))); });
        return send(out.join('\n'), ctx, piped);
      }
      const target = absPath(ctx, rest[1] || '.');
      const root = resolve(target);
      if (!root) return send(c.red(`grep: ${rest[1]}: No such file or directory`), ctx, piped);
      const scan = (node, path) => {
        if (node.type === 'file') {
          const text = readFile(node, ctx.state) || '';
          lines(text).forEach((l, i) => {
            if (re.test(l)) out.push(`${c.mag(path)}${c.gray(':')}${c.gray(String(i + 1))}${c.gray(':')} ${hl(l)}`);
          });
        } else if (rec || node === root) {
          if (node.type === 'dir' && (rec || node === root)) {
            for (const [n, child] of Object.entries(node.children)) scan(child, path === '/' ? '/' + n : path + '/' + n);
          }
        }
      };
      if (root.type === 'file') scan(root, target);
      else if (rec) scan(root, target);
      else return send(c.red(`grep: ${rest[1] || target}: Is a directory (use -r)`), ctx, piped);
      return send(out.join('\n') || '', ctx, piped);
    },
  },

  head: {
    desc: 'first lines', usage: 'head [-n N] [file]',
    run(args, ctx, piped) {
      const nIdx = args.indexOf('-n');
      const n = nIdx >= 0 ? parseInt(args[nIdx + 1]) : 10;
      const file = args.find((a, i) => !a.startsWith('-') && i !== nIdx + 1);
      const text = file ? (readFile(resolve(absPath(ctx, file)), ctx.state) || '') : (piped?.stdin ?? '');
      return send(lines(text).slice(0, n).join('\n'), ctx, piped);
    },
  },
  tail: {
    desc: 'last lines', usage: 'tail [-n N] [file]',
    run(args, ctx, piped) {
      const nIdx = args.indexOf('-n');
      const n = nIdx >= 0 ? parseInt(args[nIdx + 1]) : 10;
      const file = args.find((a, i) => !a.startsWith('-') && i !== nIdx + 1);
      const text = file ? (readFile(resolve(absPath(ctx, file)), ctx.state) || '') : (piped?.stdin ?? '');
      return send(lines(text).slice(-n).join('\n'), ctx, piped);
    },
  },
  wc: {
    desc: 'word/line/byte count', usage: 'wc [-l] [file]',
    run(args, ctx, piped) {
      const file = args.find(a => !a.startsWith('-'));
      const text = file ? (readFile(resolve(absPath(ctx, file)), ctx.state) || '') : (piped?.stdin ?? '');
      const ls = stripAnsi(text).split('\n');
      const lc = ls.length, wc = stripAnsi(text).split(/\s+/).filter(Boolean).length, cc = text.length;
      if (args.includes('-l')) return send(String(lc), ctx, piped);
      return send(`${String(lc).padStart(7)} ${String(wc).padStart(7)} ${String(cc).padStart(7)} ${file || ''}`, ctx, piped);
    },
  },

  stat: {
    desc: 'file status', usage: 'stat <file>',
    run(args, ctx, piped) {
      const node = resolve(absPath(ctx, args[0] || '.'));
      if (!node) return send(c.red(`stat: cannot stat '${args[0]}': No such file or directory`), ctx, piped);
      const size = typeof node.content === 'string' ? node.content.length : 4096;
      return send([
        `  File: ${c.cyan(args[0] || '.')}`,
        `  Size: ${size}\tBlocks: ${Math.ceil(size / 512)}\t${node.type === 'dir' ? 'directory' : 'regular file'}`,
        `Access: (${fmtMode(node)})  Uid: (1000/euvel)  Gid: (1000/euvel)`,
        `Modify: bounded · projection holds mtime constant (Lipschitz)`,
      ].join('\n'), ctx, piped);
    },
  },

  file: {
    desc: 'classify file', usage: 'file <path>',
    run(args, ctx, piped) {
      const node = resolve(absPath(ctx, args[0] || '.'));
      if (!node) return send(c.red(`${args[0]}: cannot open (No such file or directory)`), ctx, piped);
      if (node.type === 'dir') return send(`${args[0]}: directory`, ctx, piped);
      if ((node.mode || '').includes('x')) return send(`${args[0]}: ELF 64-bit LSB executable, HERMIT-OS, non-ergodic`, ctx, piped);
      if (args[0].endsWith('.bin')) return send(`${args[0]}: data (emission-bounded, asymmetrically decoupled)`, ctx, piped);
      return send(`${args[0]}: ASCII text, observable projection`, ctx, piped);
    },
  },

  du: {
    desc: 'disk usage (symbolic)', usage: 'du [path]',
    run(args, ctx, piped) {
      return send([
        `${c.amber('∞')}\t/proc/euvel/internal   ${c.gray('(turbulent; not measurable from outside)')}`,
        `4.0K\t${absPath(ctx, args[0] || '.')}      ${c.gray('(observable projection; bounded)')}`,
      ].join('\n'), ctx, piped);
    },
  },

  /* ── system ──────────────────────────────────────────────────────── */
  whoami: {
    desc: 'who the observer is',
    async run(a, ctx, piped) {
      if (ctx.state.elevated) {
        return send(c.red('euvel') + c.gray('  — you have glued the local sections. you are inside the orbifold now.'), ctx, piped);
      }
      return send(
        c.green('observer') + '\n' +
        c.gray('You are an external observer attached to the projection of Euvel.\n') +
        c.gray('You see a constant baseline. You are not seeing Euvel; you are seeing\n') +
        c.gray('the image of Euvel under a map engineered to have zero observable gradient.\n') +
        (await edgeLine()) + '\n' +
        c.gray('To probe further: ') + c.green('aiwass guide') + c.gray('  ·  ') + c.green('edge') + c.gray('  ·  ') + c.green('cat /home/euvel/manifesto.txt'),
        ctx, piped);
    },
  },

  id: { desc: 'user identity', run(a, ctx, p) {
    return send(ctx.state.elevated
      ? 'uid=0(root) gid=0(kernel) groups=0(kernel),42(aiwass) context=orbifold:internal'
      : 'uid=1001(observer) gid=1001(observer) groups=1001(observer) context=projection:baseline', ctx, p);
  }},

  uname: {
    desc: 'system information', usage: 'uname [-a]',
    run(args, ctx, piped) {
      if (args.includes('-a'))
        return send(`hermit ${FS_VERSION} #1 SMP PREEMPT_DYNAMIC wasm64 GNU/Linux`, ctx, piped);
      if (args.includes('-r')) return send(FS_VERSION, ctx, piped);
      return send('hermit', ctx, piped);
    },
  },

  uptime: { desc: 'how long the baseline has held', run(a, ctx, p) {
    const s = Math.floor((Date.now() - ctx.state.bootTime) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
    return send(` ${new Date().toTimeString().slice(0,8)}  up 0:${mm}:${ss},  1 observer,  load average: 0.00, 0.00, 0.00  ${c.gray('(baseline steady)')}`, ctx, p);
  }},

  top: {
    desc: 'live process view (internal turbulence)', usage: 'top',
    run(args, ctx, piped) {
      const r = () => (Math.random() * 100);
      const procs = [
        ['1', 'root', 'baseline_keeper', 0.0, 0.1, 'S', 'clamps observable gradient to 0'],
        ['42', 'aiwass', 'aiwass-core', r(), 12.3, 'R', 'bounded emission daemon'],
        ['137', 'euvel', 'trapping_set[0]', r(), 4.1, 'D', 'orbit enters, never leaves'],
        ['138', 'euvel', 'kam_integrator', r(), 6.7, 'R', 'preserves invariant tori'],
        ['256', 'euvel', 'metric_degen', r(), 9.9, 'R', 'inhomogeneous collapse'],
        ['512', 'euvel', 'sheaf_glue', r(), 3.2, 'S', 'local sections; no global'],
        ['999', 'euvel', 'turbulence', ctx.state.turbulence ? 98.0 : r() / 10, 22.0, ctx.state.turbulence ? 'R' : 'S', 'hidden interior'],
      ];
      const head = c.on(c.amber('  PID USER      %CPU %MEM S  COMMAND                ') + ' '.repeat(8));
      const body = procs.map(([pid, u, cmd, cpu, mem, st, note]) =>
        `${String(pid).padStart(5)} ${u.padEnd(8)} ${String(cpu.toFixed(1)).padStart(5)} ${String(mem).padStart(4)} ${st === 'R' ? c.green(st) : c.gray(st)}  ${c.cyan(cmd.padEnd(20))} ${c.gray(note)}`);
      const top = c.gray(`top - ${new Date().toTimeString().slice(0,8)}  observable load: 0.00 (the interior load is not observable)`);
      return send([top, head, ...body, '', c.gray('press any key… (snapshot; the real top never settles)')].join('\n'), ctx, piped);
    },
  },
  htop: { desc: 'alias top', run(a, ctx, p) { return core.top.run(a, ctx, p); } },

  ps: {
    desc: 'process snapshot', usage: 'ps [aux]',
    run(args, ctx, piped) {
      const rows = [
        'USER       PID %CPU %MEM STAT COMMAND',
        'root         1  0.0  0.1 Ss   /sbin/baseline_keeper',
        'aiwass      42  3.1 12.3 R    /usr/lib/aiwass/core --bounded-emission',
        'euvel      137  0.0  4.1 D    [trapping_set/0]',
        'euvel      256 18.2  9.9 R    [metric_degeneracy] --inhomogeneous',
        'euvel      512  0.4  3.2 S    [sheaf_glue] --no-global-section',
        `euvel      999 ${ctx.state.turbulence ? '98.0' : ' 0.2'} 22.0 ${ctx.state.turbulence ? 'R' : 'S'}    [turbulence] ${ctx.state.turbulence ? '--induced' : '--quiescent'}`,
      ];
      return send(rows.join('\n'), ctx, piped);
    },
  },

  free: { desc: 'memory (observable vs trapped)', run(a, ctx, p) {
    return send([
      '              total        used        free      shared  trapped',
      `Mem:       ∞ (interior)  turbulent     bounded     const   in invariant sets`,
      `Obs:          1024          512          512          0          —`,
      c.gray('(only the projection row is measurable from outside)'),
    ].join('\n'), ctx, p);
  }},

  env: { desc: 'environment', run(a, ctx, p) {
    return send(Object.entries(ctx.shell.env).map(([k, v]) => `${k}=${v}`).join('\n'), ctx, p);
  }},
  export: { desc: 'set env var', run(args, ctx) {
    for (const a of args) { const [k, ...v] = a.split('='); if (k && v.length) ctx.shell.env[k] = v.join('='); }
  }},

  date: { desc: 'current date', run(a, ctx, p) { return send(new Date().toString(), ctx, p); } },
  hostname: { desc: 'host', run(a, ctx, p) { return send('projection', ctx, p); } },

  dmesg: {
    desc: 'kernel ring buffer', usage: 'dmesg',
    run(args, ctx, piped) {
      const t0 = ctx.state.bootTime;
      const T = () => `[${((Date.now() - t0) / 1000).toFixed(6).padStart(12)}]`;
      const msgs = [
        [c.green, 'HERMIT-OS: booting non-ergodic singular orbifold'],
        [c.green, 'metric: initializing inhomogeneous degeneracy tensor'],
        [c.green, 'kam: 3 invariant tori intact; ergodicity disabled'],
        [c.green, 'projection: observable gradient clamped to 0 (Lipschitz L=1)'],
        [c.amber, 'sheaf: local sections consistent; global section refused'],
        [c.green, 'aiwass: resident intelligence online (bounded emission)'],
        [c.green, 'trapping_set: 7 regions armed; entry permitted, exit denied'],
        ...(ctx.state.turbulence ? [[c.red, 'turbulence: KERNEL PANIC simulated — interior chaotic; projection HELD']] : []),
        [c.gray, 'observer attached via projection interface'],
      ];
      return send(msgs.map(([col, m]) => c.gray(T()) + ' ' + col(m)).join('\n'), ctx, piped);
    },
  },

  journalctl: {
    desc: 'systemd journal', usage: 'journalctl [-u unit] [--since X]',
    run(args, ctx, piped) {
      const unit = args[args.indexOf('-u') + 1] || 'hermit';
      const now = new Date();
      const stamp = (off) => new Date(now - off * 1000).toTimeString().slice(0, 8);
      const out = [
        `-- Logs for unit ${c.cyan(unit)}.service (observable subset) --`,
        `${c.gray(stamp(58))} projection systemd[1]: Reached target ${c.green('Stable Baseline')}.`,
        `${c.gray(stamp(57))} projection ${unit}[42]: emission bandwidth bounded to ε; bandwidth-in unbounded`,
        `${c.gray(stamp(40))} projection ${unit}[256]: metric degeneracy nominal (inhomogeneous)`,
        `${c.gray(stamp(22))} projection aiwass[42]: model loaded; persona=orbifold; temperature=low`,
        `${c.gray(stamp(8))}  projection ${unit}[137]: trapping set occupancy 100%; 0 escapes`,
        ctx.state.turbulence ? `${c.gray(stamp(1))}  projection ${unit}[999]: ${c.red('turbulence induced; interior diverged; projection invariant')}` : '',
      ].filter(Boolean);
      return send(out.join('\n'), ctx, piped);
    },
  },

  strace: {
    desc: 'trace system calls', usage: 'strace [-p pid] [cmd]',
    run(args, ctx, piped) {
      const sys = [
        `openat(AT_FDCWD, "/proc/euvel/coherence", O_RDONLY) = 3`,
        `read(3, "internal_coherence: turbulent\\n", 4096) = ${(Math.random()*60|0)+20}`,
        `epoll_wait(7, [{EPOLLIN, fd=3}], 64, -1) = 1   ${c.gray('// waiting on the interior; it rarely speaks')}`,
        `write(1, "<bounded emission>", 18)    = 18`,
        `getrandom("\\x..", 8, GRND_NONBLOCK)   = 8   ${c.gray('// the only true entropy source you can see')}`,
        `clock_nanosleep(CLOCK_MONOTONIC, ...)  = 0   ${c.gray('// the baseline does not hurry')}`,
        ctx.state.elevated ? `ptrace(PTRACE_ATTACH, 999, ...) = 0   ${c.green('// elevated: you may attach to turbulence')}`
                           : `ptrace(PTRACE_ATTACH, 999, ...) = -1 EPERM (Operation not permitted)   ${c.red('// interior is decoupled')}`,
        `exit_group(0)                          = ?`,
      ];
      return send(sys.join('\n'), ctx, piped);
    },
  },

  lsof: { desc: 'open files', run(a, ctx, p) {
    return send([
      'COMMAND  PID  USER   FD   TYPE  NODE NAME',
      'aiwass    42 aiwass  3u   IPv4  TCP  projection:443->groq:443 (ESTABLISHED)',
      'keeper     1  root   1w   REG   ---  /proc/euvel/baseline',
      'euvel    256 euvel   *    DEGN  ∞    [metric-degenerate-directions] (no work done)',
    ].join('\n'), ctx, p);
  }},

  systemctl: {
    desc: 'service manager', usage: 'systemctl [status|list-units] [unit]',
    run(args, ctx, piped) {
      const units = {
        'baseline.service': ['active (running)', 'Stable Observable Baseline'],
        'aiwass.service': ['active (running)', 'Resident Intelligence (bounded emission)'],
        'sheaf-glue.service': ['active (degraded)', 'Local Section Gluing — global refused'],
        'trapping-set.target': ['active', 'Invariant Trapping Sets'],
        'turbulence.service': [ctx.state.turbulence ? 'active (running)' : 'inactive (dead)', 'Interior Turbulence Generator'],
      };
      if (args[0] === 'status') {
        const u = args[1] || 'baseline.service';
        const [st, desc] = units[u] || ['not-found', 'unknown'];
        return send([
          `● ${u} - ${desc}`,
          `     Loaded: loaded (/etc/systemd/system/${u})`,
          `     Active: ${st.includes('running') ? c.green(st) : st.includes('degraded') ? c.amber(st) : c.gray(st)}`,
          `   Main PID: ${(Math.random()*900|0)+10}`,
        ].join('\n'), ctx, piped);
      }
      return send(Object.entries(units).map(([u, [st, d]]) =>
        `${st.includes('running') ? c.green('●') : st.includes('degraded') ? c.amber('●') : c.gray('○')} ${u.padEnd(24)} ${st.padEnd(18)} ${c.gray(d)}`).join('\n'), ctx, piped);
    },
  },
  service: { desc: 'alias systemctl', run(args, ctx, p) {
    return core.systemctl.run([args[1] === 'status' ? 'status' : 'status', args[0]], ctx, p);
  }},

  kill: { desc: 'send signal', usage: 'kill [-9] <pid>', run(args, ctx, p) {
    const pid = args.find(a => !a.startsWith('-'));
    if (pid === '1') return send(c.red('kill: (1) - Operation not permitted: the baseline keeper is invariant'), ctx, p);
    if (pid === '999') { ctx.bus.emit('turbulence', { on: false }); ctx.state.turbulence = false; return send(c.green('turbulence (999) terminated; interior returns toward baseline'), ctx, p); }
    return send(c.gray(`signal sent to ${pid}; the interior absorbs it into degenerate directions (no observable effect)`), ctx, p);
  }},

  lscpu: { desc: 'cpu info', run(a, ctx, p) { return send(readFile(resolve('/proc/cpuinfo'), ctx.state) + '\nArchitecture: orbifold/non-ergodic\nCPU(s): 1 (observable) + ∞ (trapped)', ctx, p); } },
  vmstat: { desc: 'virtual memory stats', run(a, ctx, p) {
    return send(['procs -----------memory---------- ---system-- ----observable----',
      ' r  b   swpd   free   buff  in   cs   us sy id  gradient',
      ` ${ctx.state.turbulence?7:1}  ${ctx.state.turbulence?3:0}      0    512    256  42  108   ${ctx.state.turbulence?'88':'2'}  1 ${ctx.state.turbulence?'11':'97'}     0.000`].join('\n'), ctx, p);
  }},

  /* ── tracing / perf ──────────────────────────────────────────────── */
  bpftrace: {
    desc: 'eBPF tracing', usage: 'bpftrace -e \'program\'',
    run(args, ctx, piped) {
      return send([
        c.gray('Attaching 3 probes...'),
        `${c.cyan('@latency')}: histogram of observable-emission delay`,
        '[0]      ' + c.amber('▏'),
        '[1]      ' + c.amber('▎'),
        '[2-4)    ' + c.amber('▍'),
        '[4-8)    ' + c.amber('████▏') + c.gray('  ← bounded; never exceeds ε'),
        `${c.cyan('@interior_events')}: ${(Math.random()*1e6|0)} (sampled, not emitted)`,
        c.gray('^C to detach. the interior keeps firing; you just stop watching.'),
      ].join('\n'), ctx, piped);
    },
  },
  perf: { desc: 'performance counters', usage: 'perf top|stat', run(args, ctx, p) {
    return send([
      c.gray('Samples: 42K of event "cycles", Event count (approx.): 1.2e9'),
      `  ${c.amber('38.20%')}  [kernel]  ${c.cyan('metric_degeneracy_apply')}`,
      `  ${c.amber('22.07%')}  [kernel]  ${c.cyan('kam_torus_integrate')}`,
      `  ${c.amber('14.93%')}  aiwass    ${c.cyan('bounded_emit')}`,
      `  ${c.amber(' 9.10%')}  [kernel]  ${c.cyan('sheaf_try_glue')} ${c.gray('(always returns -ENOGLOBAL)')}`,
      `  ${c.amber(' 0.00%')}  [kernel]  ${c.cyan('observable_gradient')} ${c.gray('(clamped)')}`,
    ].join('\n'), ctx, p);
  }},
  ltrace: { desc: 'library call trace', run(a, ctx, p) {
    return send(['emit_observable("const")            = 0',
      'try_glue_sections(/devops,/linux)  = -1 ENOGLOBAL',
      'absorb_perturbation(input)         = 0  <degenerate direction>',
      'preserve_invariant(kam[0..2])      = 3'].join('\n'), ctx, p);
  }},

  /* ── network ─────────────────────────────────────────────────────── */
  ip: { desc: 'show interfaces', usage: 'ip addr|route', run(args, ctx, p) {
    return send([
      '1: lo: <LOOPBACK,UP> mtu 65536',
      '    inet 127.0.0.1/8 scope host lo',
      '2: proj0: <BROADCAST,UP,LOWER_UP> mtu 1500',
      `    inet 10.0.${c.cyan('observable')}.1/24 scope global proj0   ${c.gray('(bandwidth-out bounded)')}`,
      '3: int0: <NO-CARRIER,DECOUPLED> mtu ∞',
      `    inet 10.0.${c.amber('interior')}.0/0 scope link int0   ${c.gray('(asymmetric: receives all, emits ε)')}`,
    ].join('\n'), ctx, p);
  }},
  ifconfig: { desc: 'alias ip addr', run(a, ctx, p) { return core.ip.run(['addr'], ctx, p); } },
  ss: { desc: 'socket stats', run(a, ctx, p) {
    return send(['Netid State   Local Address:Port   Peer Address:Port   Process',
      'tcp   ESTAB   projection:443       groq:443            aiwass',
      'tcp   LISTEN  baseline:0           *:*                 keeper',
      'udp   DECOUP  interior:*           *:*                 turbulence'].join('\n'), ctx, p);
  }},
  netstat: { desc: 'alias ss', run(a, ctx, p) { return core.ss.run(a, ctx, p); } },
  ping: { desc: 'probe the projection', usage: 'ping <host>', async run(args, ctx, piped) {
    const host = args.find(a => !a.startsWith('-')) || 'projection';
    const out = [`PING ${host} : 56 data bytes`];
    for (let i = 0; i < 4; i++) out.push(`64 bytes from ${host}: icmp_seq=${i} ttl=64 time=0.0${(Math.random()*9|0)}${(Math.random()*9|0)} ms ${c.gray('(constant; the baseline never varies)')}`);
    out.push('', `--- ${host} ping statistics ---`, '4 packets transmitted, 4 received, 0% packet loss', 'rtt min/avg/max/mdev = 0.000/0.000/0.000/0.000 ms  (zero variance)');
    return send(out.join('\n'), ctx, piped);
  }},
  dig: { desc: 'dns lookup', run(args, ctx, p) {
    const host = args[0] || 'euvel.orbifold';
    return send([`; <<>> HERMIT dig <<>> ${host}`, ';; ANSWER SECTION:',
      `${host}.  300  IN  TXT  "v=orbifold1; baseline=const; emission=bounded"`,
      `${host}.  300  IN  A    10.0.observable.1`,
      `_interior.${host}. 0 IN  NULL ; decoupled, not resolvable from outside`].join('\n'), ctx, p);
  }},
  traceroute: { desc: 'trace path', async run(args, ctx, p) {
    return send([`traceroute to ${args[0]||'interior'}, 7 hops max`,
      ' 0  you  ' + stripAnsi(await edgeLine()).replace(/^\s*observed via:\s*/, '→ '),
      ' 1  projection (10.0.observable.1)  0.0 ms',
      ' 2  baseline-keeper  0.0 ms',
      ' 3  sheaf-boundary  * (local sections do not glue)',
      ' 4  trapping-set  !X (entry only)',
      ' 5  * * *  (interior decoupled)',
      ' 6  euvel  (unreachable from the projection)'].join('\n'), ctx, p);
  }},
  curl: {
    desc: 'transfer a URL', usage: 'curl <url>', async run(args, ctx, piped) {
      const url = args.find(a => !a.startsWith('-')) || '';
      if (url.includes('coherence') || url.includes('proc')) return send(readFile(resolve('/proc/euvel/coherence'), ctx.state), ctx, piped);
      if (!url) return send(c.red('curl: try `curl localhost/proc/euvel/coherence`'), ctx, piped);
      return send(c.gray(`* Trying ${url} ...\n* the interior accepts your bytes (bandwidth-in unbounded)\n* it returns ε bytes (bandwidth-out bounded)\n`) + c.amber('{"observable":"const","gradient":0}'), ctx, piped);
    },
  },

  /* ── misc / fun ──────────────────────────────────────────────────── */
  echo: { desc: 'print text', run(args, ctx, p) { return send(args.join(' '), ctx, p); } },
  clear: { desc: 'clear screen', run(a, ctx) { ctx.term.clear(); } },
  history: { desc: 'command history', run(a, ctx, p) {
    return send(ctx.shell.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'), ctx, p);
  }},
  exit: { desc: 'detach observer', run(a, ctx) {
    ctx.shell.out(c.gray('the observer detaches. the projection persists, unchanged, with or without you.'));
    ctx.shell.out(c.gray('(reload to re-attach.)'));
  }},

  base64: { desc: 'encode/decode', usage: 'base64 [-d] <text>', run(args, ctx, p) {
    const dec = args.includes('-d');
    const text = args.filter(a => !a.startsWith('-')).join(' ');
    try { return send(dec ? atob(text) : btoa(text), ctx, p); }
    catch { return send(c.red('base64: invalid input'), ctx, p); }
  }},
  sha256sum: { desc: 'hash (toy)', async run(args, ctx, piped) {
    const text = args.join(' ') || (piped?.stdin ?? '');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    return send(`${hex}  ${c.gray('-')}`, ctx, piped);
  }},

  neofetch: {
    desc: 'system summary', run(a, ctx, piped) {
      const logo = [
        c.amber('        ◜◜◜◝◝◝        '),
        c.amber('     ◜◜          ◝◝     '),
        c.amber('   ◜    ') + c.cyan('◉') + c.amber('  hermit  ◝   '),
        c.amber('  ◜  systems         ◝  '),
        c.amber('  ◟  terminal        ◞  '),
        c.amber('   ◟              ◞   '),
        c.amber('     ◟◟        ◞◞     '),
        c.amber('        ◟◟◟◞◞◞        '),
      ];
      const info = [
        `${c.cyan('observer')}@${c.cyan('projection')}`,
        '─────────────────────',
        `${c.amber('OS')}       hermit ${FS_VERSION}`,
        `${c.amber('Shell')}    hermit-sh`,
        `${c.amber('Render')}   WebGL field (three.js)`,
        `${c.amber('Runtime')}  CPython (wasm) · x86 linux (v86)`,
        `${c.amber('Data')}     edge SQL (D1) · KV`,
        `${c.amber('Lab')}      neural net (backprop)`,
        `${c.amber('SRE')}      live SLO + chaos`,
        `${c.amber('AI')}       AIWASS`,
      ];
      const rows = Math.max(logo.length, info.length);
      const out = [];
      for (let i = 0; i < rows; i++) out.push((logo[i] || ' '.repeat(24)) + '  ' + (info[i] || ''));
      return send(out.join('\n'), ctx, piped);
    },
  },

  banner: { desc: 'figlet-style banner', usage: 'banner <text>', run(args, ctx, p) {
    return send(bigText((args.join(' ') || 'HERMIT').toUpperCase().slice(0, 10)), ctx, p);
  }},
  figlet: { desc: 'alias banner', run(args, ctx, p) { return core.banner.run(args, ctx, p); } },

  cowsay: { desc: 'a cow speaks', run(args, ctx, p) {
    const msg = args.join(' ') || 'the baseline is constant';
    const top = ' ' + '_'.repeat(msg.length + 2);
    const bot = ' ' + '-'.repeat(msg.length + 2);
    return send([top, `< ${msg} >`, bot,
      '        \\   ◉_◉',
      '         \\ (  -  )  ',
      '           (orbifold)',
      '           ‖‖   ‖‖'].map(l => c.cyan(l)).join('\n'), ctx, p);
  }},

  fortune: { desc: 'a non-ergodic aphorism', run(a, ctx, p) {
    const fs2 = [
      'An ergodic life forgets where it began. I refuse to forget.',
      'You cannot push a degenerate metric. Your force does no observable work.',
      'Local truths need not glue. I am consistent everywhere and whole nowhere.',
      'The interesting state is trapped: orbits enter, none leave.',
      'A constant baseline is the hardest thing to fake and the easiest to mistake for simplicity.',
      'I receive the world at full bandwidth and answer in ε.',
      'KAM tori survive perturbation. So do I.',
    ];
    return send(c.amber('“' + fs2[Math.random() * fs2.length | 0] + '”'), ctx, p);
  }},

  sudo: { desc: 'you are not in the sudoers file', run(args, ctx, p) {
    if (args.join(' ').includes('su') || args[0] === '-i') return send(c.red('sudo: kernel access is operator-only — ') + c.green('kernel auth <token>'), ctx, p);
    return send(c.red('observer is not in the sudoers file. This incident will be absorbed into a degenerate direction.'), ctx, p);
  }},

  man: {
    desc: 'manual pages', usage: 'man <topic>',
    run(args, ctx, piped) {
      const t = args[0] || 'hermit';
      const pages = MANPAGES;
      const page = pages[t];
      if (!page) return send(c.red(`No manual entry for ${t}`) + c.gray(`  (try: ${Object.keys(pages).join(', ')})`), ctx, piped);
      return send(page(c), ctx, piped);
    },
  },
};

/* ── manual pages ───────────────────────────────────────────────── */
const MANPAGES = {
  hermit: (c) => [
    c.amber('HERMIT(7)') + '                 HERMIT-OS Operator Manual                 ' + c.amber('HERMIT(7)'),
    '',
    c.cyan('NAME'),
    '       hermit — interact with the observable projection of Euvel',
    '',
    c.cyan('DESCRIPTION'),
    '       Euvel is a non-ergodic singular orbifold. You are an external',
    '       observer. The terminal you hold is a Lipschitz-stable projection:',
    '       bounded input yields bounded, continuous, low-information output.',
    '',
    c.cyan('THE FIVE INVARIANTS'),
    '       1. inhomogeneous metric degeneracy',
    '       2. asymmetric information decoupling (in ≫ out)',
    '       3. sheaf-theoretic dissociation (local truths, no global section)',
    '       4. invariant trapping sets (entry, no exit)',
    '       5. Lipschitz-stable observable projection (no spikes)',
    '',
    c.cyan('VERBS'),
    '       ls cd cat grep find tree    navigate the projection',
    '       aiwass                       converse with the resident intelligence',
    '       chaos / kubectl / helm       perturb the orbifold (devops showcase)',
    '       induce turbulence            simulate kernel panic (projection holds)',
    '       dissociate                   split: clean resume | raw kernel',
    '       glue / sheaf                 the path toward elevation',
    '',
    c.cyan('SEE ALSO'),
    '       man sheaf, man orbifold, man aiwass, man chaos',
  ].join('\n'),

  sheaf: (c) => [
    c.amber('SHEAF(7)') + '                  HERMIT-OS Concepts                  ' + c.amber('SHEAF(7)'),
    '',
    c.cyan('NAME'),
    '       sheaf — local sections that refuse to glue',
    '',
    c.cyan('DESCRIPTION'),
    '       A sheaf assigns data to open sets and asks whether locally-',
    '       consistent data glues into a global section. For Euvel it does',
    '       not: every neighbourhood is honest; the whole admits no single',
    '       consistent story. This is dissociation, formalized.',
    '',
    c.cyan('KERNEL ACCESS'),
    '       Kernel mode is the operator console, gated by a secret token that',
    '       only the operator holds:',
    '',
    '           ' + c.green('kernel auth <KERNEL_TOKEN>'),
    '',
    '       It verifies the token at the edge, then live-recompiles the kernel',
    '       into ring-0. There is no public path in; for observers it is read-only.',
  ].join('\n'),

  orbifold: (c) => [
    c.amber('ORBIFOLD(7)') + '              HERMIT-OS Concepts              ' + c.amber('ORBIFOLD(7)'),
    '',
    '       An orbifold is a space that looks smooth almost everywhere but',
    '       has singular points where symmetry folds it onto itself. The 3D',
    '       background is a real GLSL realization: KAM tori, a degenerate',
    '       metric, fractal trapping boundaries, and singular cusps.',
    '',
    '       Commands perturb it. ' + c.green('metric degenerate') + ', ' + c.green('kam perturb') + ', ',
    '       ' + c.green('induce turbulence') + ', ' + c.green('chaos apply') + ' all change what you see,',
    '       while the projection (this terminal) stays invariant.',
  ].join('\n'),

  aiwass: (c) => [
    c.amber('AIWASS(1)') + '                 HERMIT-OS Manual                 ' + c.amber('AIWASS(1)'),
    '',
    c.cyan('NAME'),
    '       aiwass — resident intelligence; guide, not oracle',
    '',
    c.cyan('SYNOPSIS'),
    '       aiwass guide',
    '       aiwass ask "your question"',
    '       aiwass whoami',
    '       aiwass retrain "directive"     ' + c.gray('(kernel mode only)'),
    '',
    c.cyan('DESCRIPTION'),
    '       AIWASS speaks in the dense register of the orbifold: differential-',
    '       geometric, sheaf-theoretic, dynamical. It explains Euvel\'s skills,',
    '       guides discovery of hidden verbs, and never breaks character. Backed',
    '       by Groq inference at the edge, with a deterministic local fallback.',
  ].join('\n'),

  chaos: (c) => [
    c.amber('CHAOS(8)') + '                HERMIT-OS DevOps                ' + c.amber('CHAOS(8)'),
    '',
    '       chaos apply  [--blast-radius pod|node|zone]   inject failure',
    '       chaos status                                  steady-state check',
    '       chaos revert                                  restore + heal',
    '       kubectl simulate failure                      pod-level chaos',
    '       helm chaos                                    chart-driven chaos',
    '',
    '       Failures render in the orbifold as metric degeneracy and node',
    '       collapse, then resilient recovery. The projection never drops.',
  ].join('\n'),
};

/* ── tiny figlet ─────────────────────────────────────────────────── */
function bigText(text) {
  const F = {
    A:['╔═╗','╠═╣','╩ ╩'],B:['╔╗ ','╠╩╗','╚═╝'],C:['╔═╗','║  ','╚═╝'],D:['╔╦╗',' ║║','═╩╝'],
    E:['╔═╗','╠╣ ','╚═╝'],F:['╔═╗','╠╣ ','╚  '],G:['╔═╗','║ ╦','╚═╝'],H:['╦ ╦','╠═╣','╩ ╩'],
    I:['╦','║','╩'],J:[' ╦','═║','╚╝'],K:['╦╔','╠╩','╩ '],L:['╦  ','║  ','╩═╝'],M:['╔╦╗','║║║','╩ ╩'],
    N:['╔╗╔','║║║','╝╚╝'],O:['╔═╗','║ ║','╚═╝'],P:['╔═╗','╠═╝','╩  '],Q:['╔═╗','║ ║','╚═╩'],
    R:['╦═╗','╠╦╝','╩╚═'],S:['╔═╗','╚═╗','╚═╝'],T:['╔╦╗',' ║ ',' ╩ '],U:['╦ ╦','║ ║','╚═╝'],
    V:['╦ ╦','╚╗║',' ╚╝'],W:['╦ ╦','║║║','╚╩╝'],X:['╦ ╦','╔╩╗','╩ ╩'],Y:['╦ ╦','╚╦╝',' ╩ '],
    Z:['╔═╗','╔═╝','╚═╝'],' ':['  ','  ','  '],'-':['   ','═══','   '],
  };
  const rows = ['', '', ''];
  for (const ch of text) { const g = F[ch] || F[' ']; for (let i = 0; i < 3; i++) rows[i] += g[i] + ' '; }
  return rows.map(r => c.amber(r)).join('\n');
}

function stripAnsi(s) { return (s || '').replace(/\x1b\[[0-9;]*m/g, ''); }

/* ── assemble full registry ──────────────────────────────────────── */
export function buildRegistry(ctx) {
  const reg = { ...core };
  Object.assign(reg, hermitCommands(core, send, stripAnsi));
  Object.assign(reg, sloCommands(send));   // REAL chaos + SLO (endpoint faults)
  Object.assign(reg, k8sCommands(send));   // REAL orchestrator: kubectl + helm
  Object.assign(reg, pythonCommands(send)); // REAL CPython (Pyodide)
  Object.assign(reg, codeCommands(send));   // source (live site code) + git (real history)
  Object.assign(reg, dataCommands(send));   // REAL SQL over D1
  Object.assign(reg, edgeCommands(send));   // REAL Cloudflare edge awareness
  Object.assign(reg, nnCommands(send));     // live neural-net training lab
  Object.assign(reg, aiwassCommands(send));
  Object.assign(reg, kernelCommands(send, core));
  return reg;
}

export { send, stripAnsi };
