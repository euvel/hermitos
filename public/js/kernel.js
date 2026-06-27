/* ===================================================================
   hermit — kernel mode (the operator's admin dashboard)
   `kernel auth` → masked token prompt → /api/admin/login exchanges the
   master token (sent once) for an HttpOnly session cookie, then live-
   recompiles into ring-0. All résumé data lives in D1 (single source of
   truth); add/edit/rm write straight through. No secret is kept in JS.
   =================================================================== */

import { c } from './shell.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
      desc: 'kernel-mode résumé dashboard (operator only)',
      usage: 'kernel auth | ls | add <table> field=val… | edit <table> <id> field=val… | rm <table> <id> | lock',
      async run(args, ctx, piped) {
        const sub = args[0];

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

        if (!sub || sub === 'help') {
          return send([
            c.green('KERNEL MODE') + c.gray(' — fs/resume (Cloudflare D1), writable. tables: ') + Object.keys(TABLES).map(t => c.cyan(t)).join(', '),
            '',
            c.cyan('  kernel ls') + c.gray('                                       the whole résumé'),
            c.cyan('  kernel add experience role="…" org="…" start_year=2022 end_year=present summary="…"'),
            c.cyan('  kernel add project name="…" stack="…" year=2026 impact="…" url="…"'),
            c.cyan('  kernel add skill area=devops name="Kubernetes" level=5'),
            c.cyan('  kernel edit <table> <id> field="new value"') + c.gray('       update fields'),
            c.cyan('  kernel rm <table> <id>') + c.gray('                          delete a row'),
            c.cyan('  aiwass retrain "<directive>"') + c.gray('                    steer AIWASS'),
            c.cyan('  kernel lock') + c.gray('                                     end the session'),
            '',
            c.gray('  fields — ') + Object.entries(TABLES).map(([t, cols]) => c.cyan(t) + c.gray('(' + cols.join(',') + ')')).join('  '),
          ].join('\n'), ctx, piped);
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
