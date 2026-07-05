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
import { lorenzCommands } from './lorenz.js';
import { kamCommands } from './kam.js';
import { crdtCommands } from './crdt.js';
import { ciCommands } from './ci.js';
import { vmCommands } from './vm.js';
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ── real coreutils: run on the REAL v86 kernel when it's booted ──────
   No fabricated process tables. `mapper(args)` builds the real command
   (with /proc fallbacks so it works on any busybox image). If the kernel
   isn't up, we say so honestly and point at `linux` — we do not fake it. */
function realUnix(name, mapper, hint) {
  return {
    desc: (hint || name) + ' (real kernel via v86)',
    async run(args, ctx, piped) {
      const lx = ctx.state.linux;
      if (!lx || !lx.ready) {
        return send(c.gray(`${name}: needs the real kernel. run `) + c.green('linux') + c.gray(' first (it can stay backgrounded), then re-run — this shows REAL output, not a mock.'), ctx, piped);
      }
      const cmd = typeof mapper === 'function' ? mapper(args) : mapper;
      const r = await lx.exec(cmd, { timeout: 6000 });
      const out = (r.stdout || '').trim();
      if (!out) return send(c.gray(`(${name}: no output` + (r.code ? `, exit ${r.code}` : '') + ')'), ctx, piped);
      return send(out, ctx, piped);
    },
  };
}
// quote a user arg for safe-ish inclusion in the guest command
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

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
        'system':     ['whoami', 'id', 'uname', 'uptime', 'top', 'ps', 'free', 'mount', 'df', 'env', 'date', 'dmesg', 'journalctl', 'strace', 'lsof', 'kill'],
        'trace/perf': ['bpftrace', 'perf', 'vmstat', 'lscpu'],
        'network':    ['ip', 'ping', 'ss', 'curl', 'dig', 'traceroute', 'edge'],
        'dev (real)': ['python3', 'source', 'git', 'sql', 'ci', 'deploy'],
        'labs':       ['train'],
        'intelligence': ['aiwass'],
        'systems':    ['linux', 'dissociate', 'induce', 'orbifold', 'kam', 'sheaf', 'glue'],
        'devops':     ['chaos', 'lyapunov', 'watch', 'kubectl', 'helm'],
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

  uname: realUnix('uname', (args) => 'uname ' + (args.length ? args.map(q).join(' ') : '-s'), 'system information'),

  uptime: realUnix('uptime', 'uptime 2>/dev/null || (cat /proc/uptime | awk \'{print "up " int($1/60) " min"}\')', 'uptime + load'),

  top: realUnix('top', 'top -bn1 2>/dev/null | head -24 || ps', 'live process view'),
  htop: { desc: 'alias top', run(a, ctx, p) { return core.top.run(a, ctx, p); } },

  ps: realUnix('ps', (args) => 'ps ' + (args.length ? args.map(q).join(' ') : 'aux 2>/dev/null || ps'), 'process snapshot'),

  free: realUnix('free', 'free -m 2>/dev/null || head -5 /proc/meminfo', 'memory usage'),

  env: { desc: 'environment', run(a, ctx, p) {
    return send(Object.entries(ctx.shell.env).map(([k, v]) => `${k}=${v}`).join('\n'), ctx, p);
  }},
  export: { desc: 'set env var', run(args, ctx) {
    for (const a of args) { const [k, ...v] = a.split('='); if (k && v.length) ctx.shell.env[k] = v.join('='); }
  }},

  date: { desc: 'current date', run(a, ctx, p) { return send(new Date().toString(), ctx, p); } },
  hostname: { desc: 'host', run(a, ctx, p) { return send('projection', ctx, p); } },

  dmesg: realUnix('dmesg', 'dmesg 2>/dev/null | tail -40 || echo "dmesg: restricted in this image"', 'kernel ring buffer'),

  journalctl: realUnix('journalctl', 'dmesg 2>/dev/null | tail -30 || echo "no systemd journal (busybox init) — showing kernel log"', 'journal (busybox → kernel log)'),

  strace: realUnix('strace', (args) => args.length ? 'strace ' + args.map(q).join(' ') + ' 2>&1 | head -50' : 'echo "usage: strace <cmd>   (needs strace in the image)"', 'trace system calls'),

  lsof: realUnix('lsof', 'lsof 2>/dev/null | head -30 || ls -l /proc/[0-9]*/fd 2>/dev/null | head -30', 'open files'),

  systemctl: {
    desc: 'service manager (busybox init — no systemd)', usage: 'systemctl',
    run(args, ctx, piped) {
      return send([
        c.gray('this kernel boots with busybox init, not systemd — there are no units to manage.'),
        c.gray('for the REAL running processes use ') + c.green('ps') + c.gray(', for mounts ') + c.green('mount') + c.gray(', for the kernel log ') + c.green('dmesg') + c.gray(' (all real once ') + c.green('linux') + c.gray(' is booted).'),
      ].join('\n'), ctx, piped);
    },
  },
  service: { desc: 'alias systemctl', run(args, ctx, p) { return core.systemctl.run(args, ctx, p); } },

  kill: realUnix('kill', (args) => 'kill ' + args.map(q).join(' '), 'send a signal'),

  lscpu: realUnix('lscpu', 'lscpu 2>/dev/null || cat /proc/cpuinfo', 'cpu info'),
  vmstat: realUnix('vmstat', (args) => 'vmstat ' + args.map(q).join(' ') + ' 2>/dev/null || cat /proc/stat', 'virtual memory stats'),
  mount: realUnix('mount', 'mount', 'mounted filesystems'),
  df: realUnix('df', (args) => 'df ' + (args.length ? args.map(q).join(' ') : '-h') + ' 2>/dev/null || df', 'disk usage'),

  /* ── tracing / perf: REAL data about THIS running app ────────────── */
  bpftrace: {
    desc: 'REAL latency histogram of the shell commands you have run', usage: "bpftrace [-e 'shell:latency']",
    run(args, ctx, piped) {
      const t = (ctx.shell.cmdTimings || []).map(x => x.ms);
      if (!t.length) return send(c.gray('bpftrace: no samples yet — run some commands, then re-run. this traces the REAL command dispatch (performance.now() around each cmd), not a mock.'), ctx, piped);
      const buckets = {};
      for (const d of t) { const b = d < 1 ? 0 : Math.floor(Math.log2(d)); buckets[b] = (buckets[b] || 0) + 1; }
      const max = Math.max(...Object.values(buckets));
      const rows = Object.keys(buckets).map(Number).sort((a, b) => a - b).map(b => {
        const lo = b === 0 ? 0 : 2 ** b, hi = 2 ** (b + 1);
        const n = buckets[b];
        return `  [${String(lo).padStart(5)}, ${String(hi).padStart(6)}) ms  ${String(n).padStart(4)}  ${c.amber('█'.repeat(Math.max(1, Math.round(n / max * 30))))}`;
      });
      return send([c.cyan(`@latency (ms) — REAL shell command dispatch, n=${t.length}`), ...rows,
        c.gray('  measured with performance.now() around each command\'s execution.')].join('\n'), ctx, piped);
    },
  },
  perf: {
    desc: 'REAL performance profile of this page (Performance API)', usage: 'perf [stat]',
    run(args, ctx, piped) {
      const nav = performance.getEntriesByType('navigation')[0];
      const out = [];
      if (nav) {
        const seg = (a, b) => Math.max(0, nav[b] - nav[a]).toFixed(1);
        out.push(c.cyan('navigation timing — real, this page load:'));
        out.push(`  DNS       ${seg('domainLookupStart', 'domainLookupEnd').padStart(7)} ms`);
        out.push(`  TCP       ${seg('connectStart', 'connectEnd').padStart(7)} ms`);
        out.push(`  TLS       ${(nav.secureConnectionStart ? (nav.connectEnd - nav.secureConnectionStart).toFixed(1) : '0.0').padStart(7)} ms`);
        out.push(`  TTFB      ${seg('requestStart', 'responseStart').padStart(7)} ms`);
        out.push(`  response  ${seg('responseStart', 'responseEnd').padStart(7)} ms`);
        out.push(`  DOM ready ${seg('startTime', 'domContentLoadedEventEnd').padStart(7)} ms`);
      }
      const res = performance.getEntriesByType('resource').slice().sort((a, b) => b.duration - a.duration).slice(0, 6);
      if (res.length) {
        out.push('', c.cyan('slowest resources — real:'));
        for (const r of res) out.push(`  ${String(r.duration.toFixed(0)).padStart(6)} ms  ${c.gray((r.name.split('/').pop() || r.name).slice(0, 46))}`);
      }
      if (performance.memory) out.push('', c.cyan('JS heap: ') + `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} / ${(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0)} MiB (real)`);
      return send(out.join('\n') || c.gray('no timing data available'), ctx, piped);
    },
  },
  ltrace: { desc: 'library call trace', run(a, ctx, p) {
    return send(c.gray('ltrace is not in the image. for REAL syscall tracing use ') + c.green('strace <cmd>') + c.gray(' on the booted kernel; for REAL app latency use ') + c.green('bpftrace') + c.gray(' or ') + c.green('perf') + c.gray('.'), ctx, p);
  }},

  /* ── network: REAL (real kernel for ip/ss · real web for dig/curl/ping) ── */
  ip: realUnix('ip', (args) => 'ip ' + (args.length ? args.map(q).join(' ') : 'addr') + ' 2>/dev/null || ifconfig 2>/dev/null || cat /proc/net/dev', 'network interfaces'),
  ifconfig: { desc: 'alias ip addr', run(a, ctx, p) { return core.ip.run(['addr'], ctx, p); } },
  ss: realUnix('ss', (args) => 'ss ' + (args.length ? args.map(q).join(' ') : '-tuln') + ' 2>/dev/null || netstat -tuln 2>/dev/null || head /proc/net/tcp', 'socket stats'),
  netstat: { desc: 'alias ss', run(a, ctx, p) { return core.ss.run(a, ctx, p); } },

  ping: { desc: 'REAL HTTP latency probe (browsers can\'t send ICMP)', usage: 'ping [host|url]', async run(args, ctx, piped) {
    const target = args.find(a => !a.startsWith('-'));
    const url = !target ? '/api/ping' : (/^https?:\/\//.test(target) ? target : 'https://' + target);
    ctx.shell.out(c.gray(`PING ${target || '/api/ping (this edge)'} — real HTTP round-trips (incl. DNS+TLS):`));
    const times = [];
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      try { await fetch(url, target ? { mode: 'no-cors', cache: 'no-store' } : { cache: 'no-store' }); }
      catch (e) { ctx.shell.out(c.red(`  seq=${i} failed: ${e.message || e}`)); await sleep(250); continue; }
      const ms = performance.now() - t0; times.push(ms);
      ctx.shell.out(`  seq=${i}  time=${c.cyan(ms.toFixed(1) + ' ms')}`);
      await sleep(300);
    }
    if (times.length) {
      const mn = Math.min(...times), mx = Math.max(...times), av = times.reduce((a, b) => a + b, 0) / times.length;
      ctx.shell.out(c.gray(`  --- ${times.length}/4 replies · min/avg/max = ${mn.toFixed(1)}/${av.toFixed(1)}/${mx.toFixed(1)} ms (real)`));
    }
    return '';
  }},

  dig: { desc: 'REAL DNS lookup (DNS-over-HTTPS via 1.1.1.1)', usage: 'dig <name> [A|AAAA|MX|TXT|NS|CNAME]', async run(args, ctx, piped) {
    const type = (args.find(a => /^[A-Z]{1,6}$/.test(a)) || 'A').toUpperCase();
    const name = args.find(a => !a.startsWith('-') && a !== type);
    if (!name) return send(c.gray('usage: dig <name> [A|AAAA|MX|TXT|NS|CNAME]  — resolves for real over HTTPS'), ctx, piped);
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, { headers: { accept: 'application/dns-json' } });
      if (!r.ok) return send(c.red('dig: resolver HTTP ' + r.status), ctx, piped);
      const d = await r.json();
      const TYPES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA' };
      const st = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN'][d.Status] ?? d.Status;
      const out = [c.gray(`; <<>> dig (DoH · 1.1.1.1) <<>> ${name} ${type}`), c.gray(`;; status: ${st}`)];
      if (d.Answer && d.Answer.length) {
        out.push(';; ANSWER SECTION:');
        for (const a of d.Answer) out.push(`${a.name.padEnd(26)} ${String(a.TTL).padStart(6)}  IN  ${(TYPES[a.type] || a.type).toString().padEnd(6)} ${c.cyan(a.data)}`);
      } else out.push(c.gray(';; no records'));
      return send(out.join('\n'), ctx, piped);
    } catch (e) { return send(c.red('dig: ' + (e.message || 'network error') + '  (needs network access)'), ctx, piped); }
  }},

  traceroute: { desc: 'path to the edge (real serving PoP; browsers can\'t raw-socket)', async run(args, ctx, p) {
    return send([
      c.gray(`traceroute to ${args[0] || 'this site'} — browsers can't open raw sockets, so a true hop-by-hop trace isn't possible (that would be a lie).`),
      c.gray('the real, verifiable network fact is which Cloudflare PoP served you:'),
      '  ' + stripAnsi(await edgeLine()),
      c.gray('for real edge latency use ') + c.green('ping') + c.gray('; for real DNS resolution use ') + c.green('dig') + c.gray('.'),
    ].join('\n'), ctx, p);
  }},

  curl: { desc: 'transfer a URL (REAL fetch)', usage: 'curl [-I] <url>', async run(args, ctx, piped) {
    const head = args.includes('-I') || args.includes('--head');
    const url = args.find(a => !a.startsWith('-'));
    if (!url) return send(c.gray('usage: curl [-I] <url>   — same-origin /api/* is fully real; cross-origin may be CORS-blocked (a real browser constraint, not a mock).'), ctx, piped);
    const full = /^https?:\/\//.test(url) ? url : (url.startsWith('/') ? url : 'https://' + url);
    try {
      const t0 = performance.now();
      const r = await fetch(full, { method: head ? 'HEAD' : 'GET', cache: 'no-store' });
      const ms = (performance.now() - t0).toFixed(0);
      const status = (r.ok ? c.green : c.red)(`HTTP ${r.status} ${r.statusText}`);
      if (head) {
        const hdrs = []; r.headers.forEach((v, k) => hdrs.push(`${c.gray(k + ':')} ${v}`));
        return send([status, ...hdrs, c.gray(`— ${ms} ms (real)`)].join('\n'), ctx, piped);
      }
      const body = await r.text();
      const snip = body.length > 1200 ? body.slice(0, 1200) + c.gray(`\n… (${body.length} bytes total)`) : body;
      return send([status, c.gray(`${r.headers.get('content-type') || '?'} · ${ms} ms · ${body.length} bytes`), '', snip].join('\n'), ctx, piped);
    } catch (e) {
      return send(c.red('curl: ' + (e.message || 'request failed')) + c.gray('  (cross-origin without CORS is blocked by the browser — a real constraint)'), ctx, piped);
    }
  }},

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
    '       induce turbulence            drive the interior across its bifurcation, measure λ',
    '       dissociate                   split: clean resume | live interior telemetry',
    '       kam / lyapunov               real chaos: standard map + Lorenz/Lyapunov',
    '       sheaf / glue                 a real CRDT: diverge replicas, then glue them',
    '',
    c.cyan('SEE ALSO'),
    '       man sheaf, man orbifold, man aiwass, man chaos',
  ].join('\n'),

  sheaf: (c) => [
    c.amber('SHEAF(7)') + '                  HERMIT-OS Concepts                  ' + c.amber('SHEAF(7)'),
    '',
    c.cyan('NAME'),
    '       sheaf — a real CRDT: local sections that actually glue',
    '',
    c.cyan('DESCRIPTION'),
    '       A sheaf glues locally-consistent data over overlapping regions',
    '       into one global section. The CS instance is a CRDT. `sheaf` is a',
    '       real state-based Observed-Remove Set: replicas take divergent',
    '       offline edits (`sheaf partition`), then `glue` joins them — and',
    '       because the join is commutative, associative and idempotent, the',
    '       result is order-independent. The gluing condition, made to hold.',
    '',
    '           ' + c.green('sheaf partition') + '   diverge the replicas concurrently',
    '           ' + c.green('glue') + '              merge them into one global section',
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
    '       Real dynamical-systems tools measure and perturb it: ' + c.green('kam') + ' (standard map),',
    '       ' + c.green('lyapunov') + ' (Lorenz), ' + c.green('induce turbulence') + ' (measured λ), ' + c.green('chaos inject') + ' —',
    '       all change what you see, while the projection (this terminal) stays invariant.',
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
  Object.assign(reg, lorenzCommands(send));  // `lyapunov` — Lorenz attractor + Lyapunov
  Object.assign(reg, kamCommands(send));     // `kam` — Chirikov standard map (real KAM tori)
  Object.assign(reg, crdtCommands(send));    // `sheaf`/`glue` — real OR-Set CRDT
  Object.assign(reg, ciCommands(send));      // `ci`/`deploy` — real GitHub Actions + CD status
  Object.assign(reg, vmCommands(send));      // `linux` — real x86 kernel (v86)
  Object.assign(reg, aiwassCommands(send));
  Object.assign(reg, kernelCommands(send, core));
  return reg;
}

export { send, stripAnsi };
