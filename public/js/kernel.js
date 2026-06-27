/* ===================================================================
   hermit — kernel mode (the operator's résumé dashboard)
   Access is a single step: `kernel auth <KERNEL_TOKEN>` verifies the
   token at the edge, then live-recompiles the kernel and drops you into
   ring-0, where you manage experiences / projects / skills / ideas and
   publish them to Cloudflare KV.
   =================================================================== */

import { c } from './shell.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function guard(ctx, send, piped) {
  if (!ctx.state.elevated) {
    send(c.red('kernel: permission denied.\n') +
         c.gray('kernel access requires the operator token: ') + c.green('kernel auth <KERNEL_TOKEN>'), ctx, piped);
    return false;
  }
  return true;
}

// a plausible kbuild trace for the live recompile
const BUILD = [
  ['make', '-C /usr/src/orbifold-kernel -j$(nproc) modules'],
  ['SYNC', 'include/config/auto.conf'],
  ['CC', 'kernel/observable.o'],
  ['CC', 'kernel/projection.o'],
  ['CC', 'mm/trapping_set.o'],
  ['CC', 'sched/reconciler.o'],
  ['CC', 'drivers/aiwass/core.o'],
  ['LD [M]', 'fs/resume/resume.ko'],
  ['MODPOST', 'Module.symvers'],
  ['LD', 'vmlinux'],
  ['SYSMAP', 'System.map'],
  ['INSTALL', '/lib/modules/6.8.0-orbifold'],
];

async function recompileAuth(ctx, send, piped, rawToken) {
  if (ctx.state.elevated) {
    if (rawToken) ctx.state.elevationToken = rawToken.trim();
    return send(c.green('already in kernel mode.') + c.gray(rawToken ? ' write token re-armed.' : '  ' + 'kernel help'), ctx, piped);
  }
  const token = (rawToken || '').trim();
  if (!token) return send(c.red('usage: kernel auth <KERNEL_TOKEN>') + c.gray('   (the token you set in the Cloudflare dashboard)'), ctx, piped);

  ctx.shell.out(c.gray('authenticating operator token at the edge …'));
  let status = 0;
  try { status = (await fetch('/api/admin/verify', { headers: { 'x-hermit-elevated': token } })).status; }
  catch (_) { status = 0; }

  if (status === 401) return send(c.red('kernel: authentication failed — wrong token.'), ctx, piped);
  if (status === 503) return send(c.red('kernel: KERNEL_TOKEN is not configured on the edge.') + c.gray('  set it in the dashboard → Variables.'), ctx, piped);
  const offline = status === 0 || status === 404;   // local/static host: no edge to verify against

  // ── live kernel recompile (the "odd but standard" way in) ────────
  const t = ctx.term;
  t.write('\r\n' + c.amber('▸ recompiling orbifold-kernel — hot reload')
    + (offline ? c.gray('  (local: token unverified)') : c.green('  (token verified)')) + '\r\n');
  ctx.bus.emit('orbifold:stress', { v: 0.72 });         // background reacts: build heat
  const t0 = performance.now();
  for (const [tag, what] of BUILD) {
    const ts = ((performance.now() - t0) / 1000).toFixed(3).padStart(7);
    t.write(c.gray('[' + ts + '] ') + c.cyan(tag.padEnd(8)) + ' ' + c.white(what) + '\r\n');
    ctx.bus.emit('orbifold:pulse', {});
    await sleep(85 + Math.random() * 95);
  }
  t.write(c.green('[  ok  ] ') + c.white('kexec: hot-reloading kernel image into ring-0') + '\r\n'); await sleep(240);
  t.write(c.green('[  ok  ] ') + c.white('fs/resume remounted ') + c.amber('rw') + '\r\n'); await sleep(160);
  ctx.bus.emit('orbifold:stress', { v: 0 });            // settle (recover flash)
  ctx.bus.emit('elevate', { on: true });                // kernel tint

  ctx.state.elevated = true;
  ctx.state.elevationToken = token;

  // load current résumé content so it's editable immediately
  try {
    const res = await fetch('/api/content');
    if (res.ok) {
      const d = await res.json();
      ctx.state.entries = d.entries || [];
      ctx.state.nextId = ctx.state.entries.reduce((m, e) => Math.max(m, e.id), 0);
      ctx.state.aiwassDirectives = d.directives || [];
    }
  } catch (_) {}

  t.write('\r\n' + c.green('● kernel mode — ring-0.') + c.gray('  fs/resume is writable. ')
    + c.cyan('kernel help') + c.gray(' for the editor; ') + c.cyan('kernel lock') + c.gray(' to leave.') + '\r\n');
  if (offline) t.write(c.amber('  note: edge unreachable — edits persist in-session only (publish needs the deployed site + KV).') + '\r\n');
  // returning here lets the run-loop draw the kernel@orbifold prompt automatically
  return '';
}

export function kernelCommands(send, core) {
  return {
    su: {
      desc: 'switch user', usage: 'su',
      run(args, ctx, piped) {
        if (ctx.state.elevated) return send(c.green('already in kernel mode.'), ctx, piped);
        return send(c.red('su: authentication failure.\n') +
          c.gray('kernel access is by operator token: ') + c.green('kernel auth <KERNEL_TOKEN>'), ctx, piped);
      },
    },

    kernel: {
      desc: 'kernel-mode résumé editor (operator only)',
      usage: 'kernel auth <token> | ls | add <type> "<title>" "<body>" | edit <id> "<body>" | rm <id> | publish | lock',
      async run(args, ctx, piped) {
        const sub = args[0];

        // the single entry point — works before elevation
        if (sub === 'auth' || sub === '--auth') return recompileAuth(ctx, send, piped, args[1]);

        if (sub === 'lock') {
          ctx.state.elevated = false;
          ctx.bus.emit('elevate', { on: false });
          ctx.bus.emit('orbifold:stress', { v: 0 });
          return send(c.amber('kernel locked. back to read-only observer.'), ctx, piped);
        }

        if (!guard(ctx, send, piped)) return '';

        if (!sub || sub === 'help') {
          return send([
            c.green('KERNEL MODE') + c.gray(' — the résumé subsystem (fs/resume), writable.'),
            '',
            c.cyan('  kernel ls') + c.gray('                              list entries'),
            c.cyan('  kernel add <type> "<title>" "<body>"') + c.gray('   type: experience|project|skill|idea'),
            c.cyan('  kernel edit <id> "<new body>"') + c.gray('          modify an entry'),
            c.cyan('  kernel rm <id>') + c.gray('                         remove an entry'),
            c.cyan('  kernel publish') + c.gray('                         commit to Cloudflare KV (persist)'),
            c.cyan('  kernel pull') + c.gray('                            reload from KV'),
            c.cyan('  aiwass retrain "<directive>"') + c.gray('           steer AIWASS'),
            c.cyan('  kernel lock') + c.gray('                            leave kernel mode'),
          ].join('\n'), ctx, piped);
        }

        ctx.state.entries = ctx.state.entries || [];

        if (sub === 'ls') {
          if (!ctx.state.entries.length) return send(c.gray('(no entries — add one: kernel add experience "Role" "what you did")'), ctx, piped);
          return send(ctx.state.entries.map(e =>
            `${c.amber('#' + e.id)} ${c.cyan('[' + e.type + ']')} ${c.white(e.title)}\n     ${c.gray(e.body)}`).join('\n'), ctx, piped);
        }

        if (sub === 'add') {
          const type = args[1] || 'idea';
          const title = args[2] || 'untitled';
          const body = args[3] || '';
          const entry = { id: (ctx.state.nextId = (ctx.state.nextId || 0) + 1), type, title, body, ts: Date.now() };
          ctx.state.entries.push(entry);
          ctx.bus.emit('orbifold:pulse', {});
          return send(c.green(`added #${entry.id} [${type}] ${title}`) + c.gray('  — `kernel publish` to persist'), ctx, piped);
        }

        if (sub === 'edit') {
          const id = parseInt(args[1]);
          const e = ctx.state.entries.find(x => x.id === id);
          if (!e) return send(c.red(`kernel: no entry #${id}`), ctx, piped);
          e.body = args[2] || e.body;
          return send(c.green(`edited #${id}`) + c.gray('  — `kernel publish` to persist'), ctx, piped);
        }

        if (sub === 'rm') {
          const id = parseInt(args[1]);
          const before = ctx.state.entries.length;
          ctx.state.entries = ctx.state.entries.filter(x => x.id !== id);
          return send(ctx.state.entries.length < before ? c.green(`removed #${id}`) + c.gray('  — `kernel publish` to persist') : c.red(`kernel: no entry #${id}`), ctx, piped);
        }

        if (sub === 'publish') {
          ctx.shell.out(c.gray('committing fs/resume → Cloudflare KV …'));
          try {
            const res = await fetch('/api/admin/content', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', 'x-hermit-elevated': ctx.state.elevationToken || '' },
              body: JSON.stringify({ entries: ctx.state.entries, directives: ctx.state.aiwassDirectives || [] }),
            });
            if (res.ok) return send(c.green('published. persisted to KV — live for every visitor.'), ctx, piped);
            if (res.status === 401) return send(c.red('publish denied: token not armed. run `kernel auth <token>` again.'), ctx, piped);
            if (res.status === 503) return send(c.amber('no KV bound (HERMIT_KV). edits persist in-session only.'), ctx, piped);
            return send(c.red(`publish failed: HTTP ${res.status}`), ctx, piped);
          } catch (e) {
            return send(c.amber('edge unreachable (local mode). edits persist in-session only.'), ctx, piped);
          }
        }

        if (sub === 'pull') {
          try {
            const res = await fetch('/api/content');
            if (res.ok) {
              const data = await res.json();
              ctx.state.entries = data.entries || [];
              ctx.state.nextId = ctx.state.entries.reduce((m, e) => Math.max(m, e.id), 0);
              ctx.state.aiwassDirectives = data.directives || ctx.state.aiwassDirectives || [];
              return send(c.green(`pulled ${ctx.state.entries.length} entries from KV.`), ctx, piped);
            }
            return send(c.amber('no stored content (KV empty or unbound).'), ctx, piped);
          } catch (e) {
            return send(c.amber('edge unreachable; nothing to pull.'), ctx, piped);
          }
        }

        return send(c.gray('kernel: unknown subcommand. try `kernel help`.'), ctx, piped);
      },
    },
  };
}
