/* ===================================================================
   HERMIT-OS — `sql` : REAL queries against Cloudflare D1 at the edge
   `sql`                 schema + example queries
   `sql tables`          list tables (real query)
   `sql "SELECT ..."`    run a real read-only query, rendered as a table
   =================================================================== */

import { c } from './shell.js';

const EXAMPLES = [
  'SELECT name, stack, year FROM projects ORDER BY year DESC',
  "SELECT name, level FROM skills WHERE area='devops' ORDER BY level DESC",
  'SELECT role, org, start_year FROM experience ORDER BY start_year DESC',
  "SELECT area, COUNT(*) AS n, AVG(level) AS avg FROM skills GROUP BY area",
];

export function dataCommands(send) {
  return {
    sql: {
      desc: 'real read-only SQL over Cloudflare D1', usage: 'sql "SELECT ..."  ·  sql tables  ·  sql schema',
      async run(args, ctx, piped) {
        const raw = args.join(' ').trim().replace(/^["']|["']$/g, '');

        if (!raw || raw === 'help') {
          return send([
            c.amber('D1') + c.gray(' — a real serverless SQLite database at the edge. read-only from here.'),
            '',
            c.cyan('schema:'),
            c.gray('  projects')   + c.gray('(id, name, stack, year, impact, url)'),
            c.gray('  experience') + c.gray('(id, role, org, start_year, end_year, summary)'),
            c.gray('  skills')     + c.gray('(id, area, name, level)'),
            '',
            c.cyan('try:'),
            ...EXAMPLES.map(q => c.gray('  sql ') + c.green('"' + q + '"')),
          ].join('\n'), ctx, piped);
        }

        if (raw === 'schema') {
          return this.run([], ctx, piped);
        }

        let query = raw;
        if (raw === 'tables') query = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name";

        let data;
        try {
          const r = await fetch('/api/query', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sql: query }),
          });
          if (r.status === 404) return send(offline(), ctx, piped);
          data = await r.json();
        } catch (_) {
          return send(offline(), ctx, piped);
        }

        if (!data.ok) {
          if (String(data.error || '').includes('not bound')) return send(notBound(), ctx, piped);
          return send(c.red('sql error: ') + c.gray(data.error || 'unknown'), ctx, piped);
        }
        if (!data.rows.length) return send(c.gray('(0 rows)'), ctx, piped);
        return send(renderTable(data.columns, data.rows) + '\n' + c.gray(`(${data.count} row${data.count === 1 ? '' : 's'})`), ctx, piped);
      },
    },
  };
}

function renderTable(cols, rows) {
  const widths = cols.map(col => Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length)));
  const cap = 48;
  const w = widths.map(x => Math.min(x, cap));
  const cell = (s, i) => { s = String(s ?? ''); if (s.length > w[i]) s = s.slice(0, w[i] - 1) + '…'; return s.padEnd(w[i]); };
  const sep = (l, m, r2) => c.gray(l + w.map(x => '─'.repeat(x + 2)).join(m) + r2);
  const out = [];
  out.push(sep('┌', '┬', '┐'));
  out.push(c.gray('│ ') + cols.map((col, i) => c.cyan(cell(col, i))).join(c.gray(' │ ')) + c.gray(' │'));
  out.push(sep('├', '┼', '┤'));
  for (const r of rows) out.push(c.gray('│ ') + cols.map((col, i) => c.white(cell(r[col], i))).join(c.gray(' │ ')) + c.gray(' │'));
  out.push(sep('└', '┴', '┘'));
  return out.join('\n');
}

function offline() {
  return c.red('sql: edge offline.') + c.gray(' Real D1 queries need the Pages Functions running. Run ') +
    c.cyan('npx wrangler pages dev public --d1 HERMIT_DB') + c.gray(' or use the deployed site.');
}
function notBound() {
  return [
    c.amber('sql: D1 database not bound yet.'),
    c.gray('  HERMIT-OS will not fake a database. To make `sql` real:'),
    c.gray('   1. Dashboard → Workers & Pages → D1 → Create database (e.g. hermit-os-db)'),
    c.gray('   2. Pages project → Settings → Functions → D1 bindings → ') + c.cyan('HERMIT_DB') + c.gray(' → that db'),
    c.gray('   3. Seed it: paste ') + c.cyan('schema.sql') + c.gray(' in the D1 console (or POST /api/admin/seed)'),
  ].join('\n');
}
