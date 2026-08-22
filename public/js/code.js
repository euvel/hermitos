/* ===================================================================
   HERMIT-OS — the site is its own portfolio
   `source [file]`   read the REAL, live source of this site (fetched
                     from the actual deployed assets — not a copy)
   `git log`         the REAL commit history, live from the GitHub API
   `git show <sha>`  the real diff stat for a commit
   =================================================================== */

import { c } from './shell.js';

// this very repository — the same one CI reads (see ci.js)
const REPO = 'euvel/hermitos';
const GH = `https://api.github.com/repos/${REPO}`;
async function gh(path) {
  const r = await fetch(`${GH}${path}`, { headers: { accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (r.status === 403) throw new Error('GitHub API rate limit reached (60/hr per IP, unauthenticated) — try again shortly.');
  if (r.status === 404) throw new Error(`repo ${REPO} not found or private.`);
  if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}`);
  return r.json();
}
let _commits = null;                              // session cache (stay under the rate limit)
async function realLog(n) {
  if (!_commits) _commits = await gh('/commits?per_page=30');
  return _commits.slice(0, n);
}
const firstLine = (s) => (s || '').split('\n')[0];

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
      desc: 'the REAL commit history of this site (live from GitHub)',
      usage: 'git log [--oneline] [-n N] | git show <sha> | git blame',
      async run(args, ctx, piped) {
        const sub = args[0] || 'log';
        try {
          if (sub === 'log') {
            let n = 15;
            const ni = args.indexOf('-n');
            if (ni >= 0 && args[ni + 1]) n = Math.max(1, Math.min(30, parseInt(args[ni + 1], 10) || 15));
            const commits = await realLog(n);
            if (args.includes('--oneline')) {
              return send(
                commits.map(x => c.amber(x.sha.slice(0, 7)) + ' ' + c.white(firstLine(x.commit.message))).join('\n') +
                '\n' + c.gray(`  · real history of github.com/${REPO}, fetched live`), ctx, piped);
            }
            const out = [];
            for (const x of commits) {
              const a = x.commit.author || {};
              const [title, ...rest] = x.commit.message.split('\n');
              out.push(c.amber('commit ' + x.sha));
              out.push(c.gray(`Author: ${a.name} <${a.email}>`));
              out.push(c.gray('Date:   ' + new Date(a.date).toUTCString()));
              out.push('');
              out.push('    ' + c.white(title));
              const body = rest.join('\n').trim();
              if (body) out.push(body.split('\n').map(l => '    ' + c.gray(l)).join('\n'));
              out.push('');
            }
            out.push(c.gray(`  · ${commits.length} real commits, live from github.com/${REPO}  ·  git show <sha> for a diff stat`));
            return send(out.join('\n'), ctx, piped);
          }

          if (sub === 'show') {
            const id = args[1];
            if (!id) return send(c.gray('usage: git show <sha>'), ctx, piped);
            const x = await gh('/commits/' + encodeURIComponent(id));
            const a = x.commit.author || {};
            const [title, ...rest] = x.commit.message.split('\n');
            const st = x.stats || {};
            const files = x.files || [];
            const out = [
              c.amber('commit ' + x.sha),
              c.gray(`Author: ${a.name} <${a.email}>`),
              c.gray('Date:   ' + new Date(a.date).toUTCString()),
              '',
              '    ' + c.white(title),
            ];
            const body = rest.join('\n').trim();
            if (body) out.push(body.split('\n').map(l => '    ' + c.gray(l)).join('\n'));
            out.push('');
            out.push(c.cyan(`${files.length} file(s) changed`) + c.gray(`   +${st.additions || 0} / -${st.deletions || 0}`));
            for (const f of files.slice(0, 40)) {
              const mark = f.status === 'added' ? c.green('A') : f.status === 'removed' ? c.red('D') : f.status === 'renamed' ? c.mag('R') : c.amber('M');
              out.push('  ' + mark + ' ' + c.gray(f.filename) + c.gray(`  +${f.additions}/-${f.deletions}`));
            }
            if (files.length > 40) out.push(c.gray(`  … and ${files.length - 40} more`));
            return send(out.join('\n'), ctx, piped);
          }

          if (sub === 'blame') {
            return send(c.gray('git blame: every line traces to a single author (') + c.white('Euvel') +
              c.gray(') — but the lines do not glue into a single story. see ') + c.green('man sheaf') + c.gray('.'), ctx, piped);
          }

          return send(c.gray('git log [--oneline] [-n N] · git show <sha> · git blame'), ctx, piped);
        } catch (e) {
          return send(c.red('git: ' + (e.message || 'unavailable')), ctx, piped);
        }
      },
    },
  };
}
