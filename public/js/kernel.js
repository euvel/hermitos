/* ===================================================================
   hermit — kernel mode (the operator's admin dashboard)
   `kernel auth` → masked token prompt → /api/admin/login exchanges the
   master token (sent once) for an HttpOnly session cookie, then live-
   recompiles into ring-0. All résumé data lives in D1 (single source of
   truth); add/edit/rm write straight through. No secret is kept in JS.
   =================================================================== */

import { c } from './shell.js';
import { bootRealKernel, noImageMessage } from './vm.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* Script pushed into the real kernel on `kernel integrate`: installs a
   guest-side `kernel switch` helper (signals the host via OSC 777 so the
   "commands only" switch works from inside real Linux), mounts a résumé
   view, and brands the shell. Sent raw (heredocs), so no capture framing. */
function guestSetupScript() {
  return [
    'mkdir -p /usr/local/bin /root/resume 2>/dev/null',
    // guest → host control: `kernel switch imaginary|real` from inside real Linux
    "cat > /usr/local/bin/kernel <<'KEOF'",
    '#!/bin/sh',
    'case "$1 $2" in',
    "\"switch imaginary\"|\"switch i\") printf '\\033]777;kernel;switch;imaginary\\007' ;;",
    "\"switch real\"|\"switch r\") printf '\\033]777;kernel;switch;real\\007' ;;",
    '*) echo "kernel: usage: kernel switch imaginary|real   (you are in REAL Linux — this jumps to the résumé kernel)" ;;',
    'esac',
    'KEOF',
    'chmod +x /usr/local/bin/kernel',
    // a résumé view reachable from inside real Linux (the full interactive one is the imaginary kernel)
    "cat > /root/resume/summary.txt <<'SEOF'",
    '  Euvel — DevOps / Systems / SRE.',
    '  Real systems, not slideware: chaos engineering with dynamical-systems',
    '  analysis, an in-browser orchestrator, edge SQL, a from-scratch neural net,',
    '  a CRDT, and this real Linux kernel — all live on the résumé itself.',
    '  Full interactive résumé (labs, aiwass, dynamical systems): kernel switch imaginary',
    'SEOF',
    "cat > /usr/local/bin/resume <<'REOF'",
    '#!/bin/sh',
    'echo; cat /root/resume/summary.txt; echo',
    'REOF',
    'chmod +x /usr/local/bin/resume',
    'export PATH=/usr/local/bin:$PATH',
    "export PS1='hermit:\\w# '",
  ].join('\n');
}

const TABLES = {
  projects:   ['name', 'stack', 'year', 'impact', 'url'],
  experience: ['role', 'org', 'start_year', 'end_year', 'summary'],
  skills:     ['area', 'name', 'level'],
};
const ALIASES = { project: 'projects', exp: 'experience', experiences: 'experience', skill: 'skills' };
const resolveTable = (t) => TABLES[t] ? t : ALIASES[t] || null;

function guard(ctx, send, piped) {
  if (!ctx.state.elevated) {
    send(c.red('kernel: permission denied.\n') +
         c.gray('kernel access requires the operator token: ') + c.green('kernel auth'), ctx, piped);
    return false;
  }
  return true;
}

const BUILD = [
  ['make', '-C /usr/src/orbifold-kernel -j$(nproc) modules'],
  ['CC', 'kernel/observable.o'], ['CC', 'kernel/projection.o'],
  ['CC', 'mm/trapping_set.o'], ['CC', 'sched/reconciler.o'],
  ['CC', 'drivers/aiwass/core.o'], ['LD [M]', 'fs/resume/resume.ko'],
  ['MODPOST', 'Module.symvers'], ['LD', 'vmlinux'],
  ['SYSMAP', 'System.map'], ['INSTALL', '/lib/modules/6.8.0-orbifold'],
];

async function login(ctx, send, piped, inlineArg) {
  if (ctx.state.elevated) return send(c.green('already in kernel mode.') + c.gray('  kernel ls'), ctx, piped);

  // never accept the token inline (it would land in scrollback/history).
  if (inlineArg) {
    // scrub the just-recorded history entry so ↑ won't reveal it
    const h = ctx.shell.history;
    if (h.length && h[h.length - 1].startsWith('kernel auth')) h[h.length - 1] = 'kernel auth';
    ctx.shell.out(c.amber('note: enter the token at the masked prompt — never inline (it would be logged).'));
  }

  const token = await ctx.shell.readSecret(c.gray('operator token: '));
  if (token == null) return send(c.gray('cancelled.'), ctx, piped);
  if (!token) return send(c.red('no token entered.'), ctx, piped);

  ctx.shell.out(c.gray('authenticating at the edge …'));
  let status = 0;
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),   // sent once, over HTTPS; never stored
    });
    status = r.status;
  } catch (_) { status = 0; }

  if (status === 401) return send(c.red('kernel: authentication failed — wrong token.'), ctx, piped);
  if (status === 503) return send(c.red('kernel: KERNEL_TOKEN is not configured on the edge.') + c.gray('  set it in the dashboard → Variables.'), ctx, piped);
  if (status !== 200) return send(c.amber('kernel: edge unreachable (local/static host). admin needs the deployed site.'), ctx, piped);

  // ── live kernel recompile ───────────────────────────────────────
  const t = ctx.term;
  t.write('\r\n' + c.amber('▸ recompiling orbifold-kernel — hot reload ') + c.green('(authenticated)') + '\r\n');
  ctx.bus.emit('orbifold:stress', { v: 0.72 });
  const t0 = performance.now();
  for (const [tag, what] of BUILD) {
    const ts = ((performance.now() - t0) / 1000).toFixed(3).padStart(7);
    t.write(c.gray('[' + ts + '] ') + c.cyan(tag.padEnd(8)) + ' ' + c.white(what) + '\r\n');
    ctx.bus.emit('orbifold:pulse', {});
    await sleep(80 + Math.random() * 90);
  }
  t.write(c.green('[  ok  ] ') + c.white('kexec: hot-reloading kernel image into ring-0') + '\r\n'); await sleep(220);
  t.write(c.green('[  ok  ] ') + c.white('fs/resume (D1) mounted ') + c.amber('rw') + '\r\n'); await sleep(140);
  ctx.bus.emit('orbifold:stress', { v: 0 });
  ctx.bus.emit('elevate', { on: true });
  ctx.state.elevated = true;              // UI flag only — the real credential is the HttpOnly cookie

  t.write('\r\n' + c.green('● kernel mode — ring-0.') + c.gray('  session expires in 30m. ')
    + c.cyan('kernel ls') + c.gray(' for the dashboard; ') + c.cyan('kernel lock') + c.gray(' to end it.') + '\r\n');
  return '';   // run-loop draws the kernel@orbifold prompt automatically
}

async function dbWrite(op, table, payload) {
  const res = await fetch('/api/admin/db', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',           // sends the HttpOnly session cookie
    body: JSON.stringify({ op, table, ...payload }),
  });
  let data = {}; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

async function readAll() {
  const out = {};
  for (const t of Object.keys(TABLES)) {
    try {
      const r = await fetch('/api/query', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: `SELECT * FROM ${t} ORDER BY id` }),
      });
      const d = await r.json();
      out[t] = d.ok ? d.rows : { error: d.error };
    } catch (_) { out[t] = { error: 'offline' }; }
  }
  return out;
}

// parse  key="value"  /  key=value  pairs into an object
function parseFields(tokens) {
  const v = {};
  for (const tok of tokens) {
    const i = tok.indexOf('=');
    if (i > 0) v[tok.slice(0, i)] = tok.slice(i + 1);
  }
  return v;
}

function expired(status) { return status === 401; }

export function kernelCommands(send, core) {
  return {
    su: {
      desc: 'switch user', usage: 'su',
      run(args, ctx, piped) {
        if (ctx.state.elevated) return send(c.green('already in kernel mode.'), ctx, piped);
        return send(c.red('su: authentication failure.\n') + c.gray('kernel access is by operator token: ') + c.green('kernel auth'), ctx, piped);
      },
    },

    kernel: {
      desc: 'the complex terminal (real+imaginary) + operator dashboard',
      usage: 'kernel status | boot real | integrate | switch imaginary|real   ·   auth | ls | add | edit | rm | lock',
      async run(args, ctx, piped) {
        const sub = args[0];

        /* ── complex terminal: real (ℝ) + imaginary (𝑖) kernels ── */
        if (!sub || sub === 'status' || (sub === 'boot' && (!args[1] || args[1] === 'status'))) {
          const lx = ctx.state.linux;
          const real = !lx ? c.gray('not booted') : !lx.ready ? c.amber('booting…') : lx.published ? c.green('integrated (ℂ)') : c.cyan('ready — run `kernel integrate`');
          return send([
            c.amber('kernel status') + c.gray('   z = real + imaginary·𝑖'),
            c.gray('  imaginary (𝑖)  résumé + tools ....... ') + c.green('online') + c.gray('  (this shell)'),
            c.gray('  real      (ℝ)  x86 Linux via v86 .... ') + real,
            '',
            (lx && lx.published)
              ? c.gray('  switch:  ') + c.cyan('kernel switch real') + c.gray('  ·  ') + c.cyan('kernel switch imaginary')
              : c.gray('  the full trip:  ') + c.cyan('kernel boot real') + c.gray('  →  ') + c.cyan('kernel integrate'),
          ].join('\n'), ctx, piped);
        }

        if (sub === 'boot' && (args[1] === 'real' || args[1] === 'linux')) {
          const cur = ctx.state.linux;
          if (cur && cur.ready) return send(c.green('real kernel already booted.') + c.gray('  fuse them: ') + c.cyan('kernel integrate'), ctx, piped);
          ctx.shell.out(c.amber('▸ booting the REAL x86 Linux kernel (v86) — streaming the genuine boot log…'));
          ctx.shell.out(c.gray('  first boot fetches a few MB; ~15–30s. the imaginary kernel is unaffected either way.'));
          ctx.shell.busy = true;
          const lx = await bootRealKernel(ctx, {});
          if (!lx) { ctx.shell.busy = false; ctx.shell.out(noImageMessage()); ctx.shell.prompt(); return ''; }
          lx.attachDisplay(true);
          ctx.term.write('\r\n');
          const ok = await Promise.race([lx.whenReady.then(() => true), sleep(90000).then(() => false)]);
          lx.attachDisplay(false);
          ctx.shell.busy = false;
          if (!ok) { ctx.shell.out('\r\n' + c.red('kernel: the real kernel did not reach a shell in time.')); ctx.shell.prompt(); return ''; }
          ctx.shell.out('\r\n' + c.green('● real kernel ready.') + c.gray('  now fuse them into one terminal: ') + c.cyan('kernel integrate'));
          ctx.shell.prompt();
          return '';
        }

        if (sub === 'integrate' || sub === 'publish' || sub === 'merge') {
          const lx = ctx.state.linux;
          if (!lx || !lx.ready) return send(c.gray('nothing to integrate yet — boot the real kernel first: ') + c.green('kernel boot real'), ctx, piped);
          if (lx.published) { ctx.shell.enterReal(); return ''; }
          ctx.shell.out(c.amber('▸ integrating  ℝ + 𝑖  →  ℂ') + c.gray('   (installing the guest switch helper + mounting the résumé view)'));
          lx.sendRaw(guestSetupScript() + '\n');
          await sleep(1600);
          lx.published = true; ctx.state.published = true;
          ctx.bus.emit('orbifold:pulse', {});
          ctx.shell.out(c.green('● integrated — the terminal is now complex.') + c.gray('  default = real Linux; ') + c.cyan('kernel switch imaginary') + c.gray(' for the résumé kernel.'));
          ctx.shell.enterReal();
          return '';
        }

        if (sub === 'switch') {
          const to = (args[1] || '').toLowerCase();
          if (['real', 'r', 'linux'].includes(to)) { ctx.shell.enterReal(); return ''; }
          if (['imaginary', 'i', 'resume', 'résumé'].includes(to)) { ctx.shell.enterImaginary(); return ''; }
          return send(c.gray('usage: kernel switch imaginary|real'), ctx, piped);
        }

        if (sub === 'halt') {
          const lx = ctx.state.linux;
          if (!lx) return send(c.gray('the real kernel is not running.'), ctx, piped);
          if (lx.halt) lx.halt();
          ctx.shell.mode = 'imaginary'; ctx.state.published = false;
          ctx.bus.emit('mode', { mode: 'imaginary' });
          return send(c.amber('real kernel halted; freed. imaginary kernel remains.'), ctx, piped);
        }

        if (sub === 'auth' || sub === '--auth' || sub === 'login') return login(ctx, send, piped, args[1]);

        if (sub === 'lock') {
          if (!ctx.state.elevated) return send(c.gray('not in kernel mode.'), ctx, piped);
          try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' }); } catch (_) {}
          ctx.state.elevated = false;
          ctx.bus.emit('elevate', { on: false });
          ctx.bus.emit('orbifold:stress', { v: 0 });
          return send(c.amber('kernel locked. session ended, cookie cleared. back to read-only observer.'), ctx, piped);
        }

        if (!guard(ctx, send, piped)) return '';

        if (sub === 'help') {
          return send([
            c.green('KERNEL MODE') + c.gray(' — fs/resume (Cloudflare D1), writable. tables: ') + Object.keys(TABLES).map(t => c.cyan(t)).join(', '),
            '',
            c.cyan('  kernel ls') + c.gray('                                       the whole résumé'),
            c.cyan('  kernel add experience role="…" org="…" start_year=2022 end_year=present summary="…"'),
            c.cyan('  kernel add project name="…" stack="…" year=2026 impact="…" url="…"'),
            c.cyan('  kernel add skill area=devops name="Kubernetes" level=5'),
            c.cyan('  kernel edit <table> <id> field="new value"') + c.gray('       update fields'),
            c.cyan('  kernel rm <table> <id>') + c.gray('                          delete a row'),
            c.cyan('  kernel seed') + c.gray('                                     reset to schema + sample rows (confirm)'),
            c.cyan('  aiwass retrain "<directive>"') + c.gray('                    steer AIWASS'),
            c.cyan('  kernel lock') + c.gray('                                     end the session'),
            '',
            c.gray('  fields — ') + Object.entries(TABLES).map(([t, cols]) => c.cyan(t) + c.gray('(' + cols.join(',') + ')')).join('  '),
          ].join('\n'), ctx, piped);
        }

        if (sub === 'seed') {
          ctx.shell.out(c.amber('seed: this DROPs and recreates projects/experience/skills with sample rows.'));
          const confirm = await ctx.shell.readSecret(c.gray('type "yes" to confirm: '));
          if (confirm !== 'yes') return send(c.gray('seed cancelled.'), ctx, piped);
          ctx.shell.out(c.gray('seeding fs/resume (D1) …'));
          try {
            const r = await fetch('/api/admin/seed', { method: 'POST', credentials: 'same-origin' });
            const d = await r.json().catch(() => ({}));
            if (r.status === 401) return send(c.red('session expired — run `kernel auth` again.'), ctx, piped);
            if (!d.ok) return send(c.red('seed: ' + (d.error || ('HTTP ' + r.status))), ctx, piped);
            const s = d.seeded || {};
            return send(c.green('seeded.') + c.gray(`  projects=${s.projects ?? '?'} experience=${s.experience ?? '?'} skills=${s.skills ?? '?'}  — \`kernel ls\` to view.`), ctx, piped);
          } catch (e) {
            return send(c.amber('seed: edge unreachable (local mode).'), ctx, piped);
          }
        }

        if (sub === 'ls' || sub === 'get' || sub === 'dashboard') {
          ctx.shell.out(c.gray('reading fs/resume (D1) …'));
          const all = await readAll();
          const out = [];
          const label = { projects: 'PROJECTS', experience: 'EXPERIENCE', skills: 'SKILLS' };
          for (const t of Object.keys(TABLES)) {
            const rows = all[t];
            out.push('');
            out.push(c.amber('▌ ' + label[t]) + c.gray('  (' + (Array.isArray(rows) ? rows.length : '?') + ')'));
            if (!Array.isArray(rows)) { out.push(c.red('  ' + (rows.error === 'offline' ? 'D1 unreachable' : 'not bound — seed schema.sql / bind HERMIT_DB'))); continue; }
            if (!rows.length) { out.push(c.gray('  (empty — kernel add ' + t.replace(/s$/, '') + ' …)')); continue; }
            for (const r of rows) {
              if (t === 'skills') out.push(`  ${c.amber('#' + r.id)} ${c.cyan('[' + r.area + ']')} ${c.white(r.name)} ${c.green('★'.repeat(Math.max(0, Math.min(5, r.level || 0))))}`);
              else if (t === 'experience') out.push(`  ${c.amber('#' + r.id)} ${c.white(r.role)} ${c.gray('@ ' + r.org)} ${c.gray('(' + (r.start_year || '?') + '–' + (r.end_year || '?') + ')')}\n      ${c.gray(r.summary || '')}`);
              else out.push(`  ${c.amber('#' + r.id)} ${c.white(r.name)} ${c.gray('· ' + (r.stack || ''))} ${c.gray(r.year ? '· ' + r.year : '')}\n      ${c.gray(r.impact || '')}`);
            }
          }
          out.push('');
          out.push(c.gray('  manage: kernel add/edit/rm <table> …   ·   changes are live immediately'));
          return send(out.join('\n'), ctx, piped);
        }

        if (sub === 'add') {
          const table = resolveTable(args[1]);
          if (!table) return send(c.red(`kernel: unknown table '${args[1] || ''}' (projects|experience|skills)`), ctx, piped);
          const values = parseFields(args.slice(2));
          if (!Object.keys(values).length) return send(c.gray(`usage: kernel add ${table} ${TABLES[table].map(f => f + '="…"').join(' ')}`), ctx, piped);
          const { status, data } = await dbWrite('insert', table, { values });
          if (expired(status)) return send(c.red('session expired — run `kernel auth` again.'), ctx, piped);
          if (!data.ok) return send(c.red('kernel: ' + (data.error || ('HTTP ' + status))), ctx, piped);
          ctx.bus.emit('orbifold:pulse', {});
          return send(c.green(`added ${table} #${data.id}`) + c.gray('  — live. `kernel ls` to view.'), ctx, piped);
        }

        if (sub === 'edit' || sub === 'update') {
          const table = resolveTable(args[1]);
          const id = parseInt(args[2], 10);
          if (!table || !id) return send(c.gray('usage: kernel edit <table> <id> field="new value"'), ctx, piped);
          const values = parseFields(args.slice(3));
          if (!Object.keys(values).length) return send(c.gray('nothing to change. e.g. kernel edit ' + table + ' ' + id + ' name="…"'), ctx, piped);
          const { status, data } = await dbWrite('update', table, { id, values });
          if (expired(status)) return send(c.red('session expired — run `kernel auth` again.'), ctx, piped);
          if (!data.ok) return send(c.red('kernel: ' + (data.error || ('HTTP ' + status))), ctx, piped);
          return send(data.changed ? c.green(`updated ${table} #${id}`) : c.amber(`no row ${table} #${id}`), ctx, piped);
        }

        if (sub === 'rm' || sub === 'del' || sub === 'delete') {
          const table = resolveTable(args[1]);
          const id = parseInt(args[2], 10);
          if (!table || !id) return send(c.gray('usage: kernel rm <table> <id>'), ctx, piped);
          const { status, data } = await dbWrite('delete', table, { id });
          if (expired(status)) return send(c.red('session expired — run `kernel auth` again.'), ctx, piped);
          if (!data.ok) return send(c.red('kernel: ' + (data.error || ('HTTP ' + status))), ctx, piped);
          return send(data.changed ? c.green(`removed ${table} #${id}`) : c.amber(`no row ${table} #${id}`), ctx, piped);
        }

        return send(c.gray('kernel: unknown subcommand. try `kernel help`.'), ctx, piped);
      },
    },
  };
}
