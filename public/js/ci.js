/* ===================================================================
   hermit — `ci` / `deploy` : REAL CI/CD status.

   `ci` reads this repo's actual GitHub Actions runs and recent commits
   from the public GitHub API (CORS-enabled), live in the browser. The
   workflow it reports (.github/workflows/ci.yml) genuinely runs on every
   push: it syntax-checks all JS and runs the logic test suite that
   asserts the site's real mathematics. So a green check here means those
   tests really passed on GitHub's runners — nothing is mocked.

   `deploy` reports the real CD path: Cloudflare Pages auto-deploys on
   push to main; the latest commit is the deployed SHA, and the edge line
   is the real PoP serving you now.
   =================================================================== */

import { c } from './shell.js';
import { edgeLine } from './edge.js';

const REPO = 'euvel/hermitos';   // owner/name — this very repository
const API = `https://api.github.com/repos/${REPO}`;

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return '';
  if (s < 60) return `${s | 0}s ago`;
  if (s < 3600) return `${(s / 60) | 0}m ago`;
  if (s < 86400) return `${(s / 3600) | 0}h ago`;
  return `${(s / 86400) | 0}d ago`;
}
function dur(a, b) {
  const s = Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
  return s < 60 ? `${s | 0}s` : `${(s / 60) | 0}m${String((s % 60) | 0).padStart(2, '0')}s`;
}

async function gh(path) {
  const r = await fetch(`${API}${path}`, { headers: { accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (r.status === 403) throw new Error('GitHub API rate limit reached (60/hr per IP, unauthenticated) — try again later.');
  if (r.status === 404) throw new Error(`repo ${REPO} not found or private (the public API needs a public repo).`);
  if (!r.ok) throw new Error(`GitHub API HTTP ${r.status}`);
  return r.json();
}

function runLine(run) {
  const ok = run.conclusion;
  const sym = ok === 'success' ? c.green('✓') : ok === 'failure' ? c.red('✗') : ok === 'cancelled' ? c.gray('○') : c.amber('◍');
  const state = run.status === 'completed' ? (ok || '') : run.status;
  const stateCol = ok === 'success' ? c.green(state) : ok === 'failure' ? c.red(state) : c.amber(state);
  const sha = (run.head_sha || '').slice(0, 7);
  const d = run.run_started_at && run.updated_at ? dur(run.run_started_at, run.updated_at) : '—';
  return `  ${sym} ${stateCol.padEnd(20)} ${c.gray(sha)} ${c.cyan((run.name || 'CI').slice(0, 16).padEnd(16))} ${c.gray(run.head_branch || '')}  ${c.gray(d + ' · ' + ago(run.run_started_at || run.created_at))}`;
}

function commitLine(cm) {
  const sha = (cm.sha || '').slice(0, 7);
  const msg = (cm.commit?.message || '').split('\n')[0].slice(0, 60);
  const who = cm.commit?.author?.name || cm.author?.login || '';
  return `  ${c.gray(sha)}  ${msg.padEnd(60)} ${c.gray(who + ' · ' + ago(cm.commit?.author?.date))}`;
}

export function ciCommands(send) {
  return {
    ci: {
      desc: 'REAL CI status — this repo\'s GitHub Actions runs + commits', usage: 'ci [runs|commits]',
      async run(args, ctx, piped) {
        const which = args[0] || 'status';
        try {
          if (which === 'commits') {
            const commits = await gh('/commits?per_page=8');
            return send([c.cyan(`recent commits · ${REPO}`), ...commits.map(commitLine)].join('\n'), ctx, piped);
          }
          const [runsData, commits] = await Promise.all([
            gh('/actions/runs?per_page=6').catch((e) => ({ _err: e.message })),
            gh('/commits?per_page=5').catch(() => []),
          ]);
          const out = [c.amber('CI/CD') + c.gray(`  ·  ${REPO}  ·  real GitHub Actions`)];
          if (runsData._err) {
            out.push(c.gray('  runs: ' + runsData._err));
          } else if (!runsData.workflow_runs || !runsData.workflow_runs.length) {
            out.push(c.gray('  no workflow runs yet — the CI workflow runs on the next push to main.'));
          } else {
            out.push(c.gray('  workflow runs (newest first):'));
            for (const run of runsData.workflow_runs.slice(0, 6)) out.push(runLine(run));
          }
          if (commits.length) {
            out.push('', c.gray('  latest commits:'));
            for (const cm of commits.slice(0, 5)) out.push(commitLine(cm));
          }
          out.push('', c.gray('  ') + c.green('ci commits') + c.gray(' for more history · ') + c.green('deploy') + c.gray(' for the CD path'));
          return send(out.join('\n'), ctx, piped);
        } catch (e) {
          return send(c.red('ci: ' + (e.message || 'failed')) + c.gray('  (this reads the real GitHub API; it needs network access.)'), ctx, piped);
        }
      },
    },

    deploy: {
      desc: 'REAL CD status — Cloudflare Pages deploy path', usage: 'deploy',
      async run(args, ctx, piped) {
        let head = null;
        try { const commits = await gh('/commits?per_page=1'); head = commits[0]; } catch (_) {}
        const out = [
          c.amber('CD') + c.gray('  ·  Cloudflare Pages (auto-deploy on push to ') + c.cyan('main') + c.gray(')'),
          c.gray('  pipeline: ') + c.green('git push') + c.gray(' → GitHub → Cloudflare Pages build → global edge'),
        ];
        if (head) out.push(c.gray('  deployed SHA: ') + c.cyan((head.sha || '').slice(0, 7)) + c.gray('  ' + (head.commit?.message || '').split('\n')[0].slice(0, 54) + '  · ' + ago(head.commit?.author?.date)));
        out.push('  ' + stripPrefix(await edgeLine()));
        out.push(c.gray('  verify the running build yourself: ') + c.green('ci') + c.gray(' (tests) · ') + c.green('whoami') + c.gray(' (real PoP)'));
        return send(out.join('\n'), ctx, piped);
      },
    },
  };
}

function stripPrefix(s) { return String(s); }
