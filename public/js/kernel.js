/* ===================================================================
   HERMIT-OS — kernel mode (hidden admin editor)
   Reachable only after the gluing ritual (see hermit.js / man sheaf).
   Lets the elevated operator add/edit experiences, projects, ideas
   and retrain AIWASS. Persists to Cloudflare KV via /api/admin/*.
   =================================================================== */

import { c } from './shell.js';

function guard(ctx, send, piped) {
  if (!ctx.state.elevated) {
    send(c.red('kernel: permission denied — you are an external observer.\n') +
         c.gray('elevation is a gluing, not a login. read ') + c.green('man sheaf') +
         c.gray(' and ') + c.green('cat /home/euvel/.secret') + c.gray('.'), ctx, piped);
    return false;
  }
  return true;
}

export function kernelCommands(send, core) {
  return {
    su: {
      desc: 'attempt to switch user', usage: 'su [root]',
      run(args, ctx, piped) {
        if (ctx.state.elevated) return send(c.green('already inside the orbifold (kernel mode).'), ctx, piped);
        return send(c.red('su: Authentication failure — there is nothing to authenticate against.\n') +
          c.gray('Euvel admits no global section, hence no single secret. Glue the local ones: ') + c.green('man sheaf'), ctx, piped);
      },
    },

    kernel: {
      desc: 'kernel-mode content editor (elevated)',
      usage: 'kernel ls | kernel add <type> "<title>" "<body>" | kernel edit <id> "<body>" | kernel rm <id> | kernel publish | kernel lock',
      async run(args, ctx, piped) {
        const sub = args[0];

        if (sub === 'lock') {
          ctx.state.elevated = false;
          ctx.bus.emit('elevate', { on: false });
          return send(c.amber('re-sealed. the global section dissolves; you are an observer again.'), ctx, piped);
        }

        if (!guard(ctx, send, piped)) return '';

        if (sub === 'auth') {
          ctx.state.elevationToken = (args[1] || '').trim();
          return send(ctx.state.elevationToken
            ? c.green('kernel: write token armed for this session. `kernel publish` will now persist to KV.')
            : c.red('usage: kernel auth <token>   (the KERNEL_TOKEN you set in the Cloudflare dashboard)'), ctx, piped);
        }

        if (!sub || sub === 'help') {
          return send([
            c.red('KERNEL MODE') + c.gray(' — you are editing the internal manifold directly.'),
            '',
            c.cyan('  kernel auth <token>') + c.gray('                    arm KERNEL_TOKEN for KV writes (set in dashboard)'),
            c.cyan('  kernel ls') + c.gray('                              list stored entries'),
            c.cyan('  kernel add <type> "<title>" "<body>"') + c.gray('   type: experience|project|idea'),
            c.cyan('  kernel edit <id> "<new body>"') + c.gray('          modify an entry'),
            c.cyan('  kernel rm <id>') + c.gray('                         remove an entry'),
            c.cyan('  kernel publish') + c.gray('                         flush to Cloudflare KV (persist)'),
            c.cyan('  kernel pull') + c.gray('                            reload entries from KV'),
            c.cyan('  aiwass retrain "<directive>"') + c.gray('           fold a directive into AIWASS'),
            c.cyan('  kernel lock') + c.gray('                            drop back to observer'),
          ].join('\n'), ctx, piped);
        }

        ctx.state.entries = ctx.state.entries || [];

        if (sub === 'ls') {
          if (!ctx.state.entries.length) return send(c.gray('(no entries yet — try `kernel add idea "title" "body"`, then `kernel pull` to load from KV)'), ctx, piped);
          return send(ctx.state.entries.map(e =>
            `${c.amber('#' + e.id)} ${c.cyan('[' + e.type + ']')} ${c.white(e.title)}\n     ${c.gray(e.body)}`).join('\n'), ctx, piped);
        }

        if (sub === 'add') {
          const type = args[1] || 'idea';
          const title = args[2] || 'untitled';
          const body = args[3] || '';
          const entry = { id: (ctx.state.nextId = (ctx.state.nextId || 0) + 1), type, title, body, ts: Date.now() };
          ctx.state.entries.push(entry);
          ctx.bus.emit('orbifold:pulse', { kind: 'write' });
          return send(c.green(`added #${entry.id} [${type}] ${title}`) + c.gray('  — run `kernel publish` to persist to KV'), ctx, piped);
        }

        if (sub === 'edit') {
          const id = parseInt(args[1]);
          const e = ctx.state.entries.find(x => x.id === id);
          if (!e) return send(c.red(`kernel: no entry #${id}`), ctx, piped);
          e.body = args[2] || e.body;
          return send(c.green(`edited #${id}`) + c.gray('  — run `kernel publish` to persist'), ctx, piped);
        }

        if (sub === 'rm') {
          const id = parseInt(args[1]);
          const before = ctx.state.entries.length;
          ctx.state.entries = ctx.state.entries.filter(x => x.id !== id);
          return send(ctx.state.entries.length < before ? c.green(`removed #${id}`) : c.red(`kernel: no entry #${id}`), ctx, piped);
        }

        if (sub === 'publish') {
          ctx.shell.out(c.gray('flushing internal manifold → Cloudflare KV ...'));
          try {
            const res = await fetch('/api/admin/content', {
              method: 'PUT',
              headers: { 'content-type': 'application/json', 'x-hermit-elevated': ctx.state.elevationToken || 'glued' },
              body: JSON.stringify({ entries: ctx.state.entries, directives: ctx.state.aiwassDirectives || [] }),
            });
            if (res.ok) return send(c.green('published. the projection now leaks slightly more — by your choice.'), ctx, piped);
            if (res.status === 404) return send(c.amber('no KV bound (HERMIT_KV). entries persist in-session only. see README → KV binding.'), ctx, piped);
            return send(c.red(`publish failed: HTTP ${res.status}`), ctx, piped);
          } catch (e) {
            return send(c.amber('edge unreachable (likely local file mode). entries persist in-session only.'), ctx, piped);
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
