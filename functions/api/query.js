/* ===================================================================
   POST /api/query  — REAL read-only SQL over Cloudflare D1
   Body: { sql: "SELECT ..." }
   A genuine serverless SQL database at the edge. Strictly read-only:
   only SELECT/WITH, single statement, auto-LIMIT, dangerous keywords
   rejected. Requires D1 binding HERMIT_DB.
   =================================================================== */

const BLOCK = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|analyze)\b/i;

export async function onRequestPost({ request, env }) {
  if (!env.HERMIT_DB) {
    return json({ ok: false, error: 'D1 not bound (HERMIT_DB). See README → D1 setup. HERMIT-OS will not fake a database.' }, 503);
  }
  let body = {};
  try { body = await request.json(); } catch (_) {}
  let sql = String(body.sql || '').trim().replace(/;+\s*$/, '');

  if (!sql) return json({ ok: false, error: 'empty query' }, 400);
  if (sql.length > 2000) return json({ ok: false, error: 'query too long' }, 400);
  if (sql.includes(';')) return json({ ok: false, error: 'only a single statement is allowed' }, 400);
  if (!/^(select|with)\b/i.test(sql)) return json({ ok: false, error: 'read-only: only SELECT / WITH queries are permitted' }, 400);
  if (BLOCK.test(sql)) return json({ ok: false, error: 'read-only: write/DDL keywords are not permitted' }, 400);
  if (!/\blimit\b/i.test(sql)) sql += ' LIMIT 200';

  try {
    const res = await env.HERMIT_DB.prepare(sql).all();
    const rows = res.results || [];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return json({ ok: true, columns, rows, count: rows.length });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 300) }, 400);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
