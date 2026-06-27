/* ===================================================================
   HERMIT-OS — the site is its own portfolio
   `source [file]`   read the REAL, live source of this site (fetched
                     from the actual deployed assets — not a copy)
   `git log`         the real development history of HERMIT-OS
   `git show <id>`   what a given phase changed
   =================================================================== */

import { c } from './shell.js';

const SOURCES = {
  'orbifold.js':  '/js/orbifold.js',
  'shell.js':     '/js/shell.js',
  'commands.js':  '/js/commands.js',
  'slo.js':       '/js/slo.js',
  'orchestrator.js':'/js/orchestrator.js',
  'k8s.js':       '/js/k8s.js',
  'nn.js':        '/js/nn.js',
  'python.js':    '/js/python.js',
  'aiwass.js':    '/js/aiwass.js',
  'filesystem.js':'/js/filesystem.js',
  'main.js':      '/js/main.js',
  'code.js':      '/js/code.js',
  'data.js':      '/js/data.js',
  'main.css':     '/styles/main.css',
  'index.html':   '/index.html',
};

function colorLine(line) {
  const t = line.trimStart();
  if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#') || t.startsWith('<!--')) return c.gray(line);
  return line;
}

export function codeCommands(send) {
  return {
    source: {
      desc: 'read the REAL source of this site', usage: 'source [file]',
      async run(args, ctx, piped) {
        const name = args[0];
        if (!name) {
          const list = Object.keys(SOURCES).map(n => c.cyan(n)).join('   ');
          return send([
            c.amber('the site is its own résumé.') + c.gray(' everything you are experiencing, I built.'),
            c.gray('read the actual, live source that is running right now:'),
            '',
            '  ' + list,
            '',
            c.gray('  e.g. ') + c.green('source orbifold.js') + c.gray('  (the raymarcher behind you)  ·  ') + c.green('source slo.js') + c.gray('  (the SRE console)'),
          ].join('\n'), ctx, piped);
        }
        const path = SOURCES[name] || (name.startsWith('/') ? name : null);
        if (!path) return send(c.red(`source: unknown file '${name}'`) + c.gray('  — run `source` for the list'), ctx, piped);
        try {
          const r = await fetch(path, { cache: 'no-store' });
          if (!r.ok) return send(c.red(`source: ${name}: HTTP ${r.status}`), ctx, piped);
          const text = await r.text();
          const lines = text.split('\n');
          const head = c.gray(`── ${path} · ${lines.length} lines · the real thing, fetched live ──`);
          const body = lines.map((l, i) => c.gray(String(i + 1).padStart(4) + ' │ ') + colorLine(l)).join('\n');
          return send(head + '\n' + body, ctx, piped);
        } catch (e) {
          return send(c.red('source: could not fetch (offline?)'), ctx, piped);
        }
      },
    },

    git: {
      desc: 'real development history of HERMIT-OS', usage: 'git log [--oneline] | git show <id>',
      async run(args, ctx, piped) {
        const log = await loadChangelog();
        if (!log) return send(c.red('git: development log unavailable'), ctx, piped);

        const sub = args[0] || 'log';

        if (sub === 'log') {
          if (args.includes('--oneline')) {
            return send(log.map(e => `${c.amber(e.id)} ${c.white(e.title)}`).join('\n'), ctx, piped);
          }
          const out = [];
          for (const e of log) {
            out.push(c.amber('commit ' + e.hash) + c.gray('  (' + e.id + ')'));
            out.push(c.gray('Author: Euvel <euvel@orbifold>'));
            out.push(c.gray('Date:   ' + e.date));
            out.push('');
            out.push('    ' + c.white(e.title));
            if (e.body) out.push('    ' + c.gray(e.body));
            out.push('');
          }
          return send(out.join('\n'), ctx, piped);
        }

        if (sub === 'show') {
          const id = args[1];
          const e = log.find(x => x.id === id || x.hash.startsWith(id || '~'));
          if (!e) return send(c.red(`git: bad revision '${id || ''}'`), ctx, piped);
          const out = [
            c.amber('commit ' + e.hash),
            c.gray('Date:   ' + e.date),
            '',
            '    ' + c.white(e.title),
            e.body ? '    ' + c.gray(e.body) : '',
            '',
            c.cyan('changed:'),
            ...(e.files || []).map(f => c.gray('  ' + f)),
          ].filter(Boolean);
          return send(out.join('\n'), ctx, piped);
        }

        if (sub === 'blame') {
          return send(c.gray('git blame: every line traces to a single author, but the lines do not glue into a single story. see `man sheaf`.'), ctx, piped);
        }

        return send(c.gray('git log [--oneline] · git show <id> · git blame <file>'), ctx, piped);
      },
    },
  };
}

let _changelog = null;
async function loadChangelog() {
  if (_changelog) return _changelog;
  try {
    const r = await fetch('/meta/changelog.json', { cache: 'no-store' });
    if (r.ok) { _changelog = await r.json(); return _changelog; }
  } catch (_) {}
  return null;
}
