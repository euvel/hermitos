/* ===================================================================
   POST /api/admin/db — write the résumé tables in D1 (single source of
   truth). Gated by the session cookie (_middleware.js). Injection-safe:
   table + column names are whitelisted; all values are bound parameters.
   Body: { op:'insert'|'update'|'delete', table, id?, values? }
   =================================================================== */

const SCHEMA = {
  projects:   ['name', 'stack', 'year', 'impact', 'url'],
  experience: ['role', 'org', 'start_year', 'end_year', 'summary'],
  skills:     ['area', 'name', 'level'],
};
const NUMERIC = new Set(['year', 'start_year', 'level']);

export async function onRequestPost({ request, env }) {
  if (!env.HERMIT_DB) return json({ ok: false, error: 'D1 not bound (HERMIT_DB).' }, 503);
  let body = {};
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'invalid JSON' }, 400); }

  const { op, table } = body;
  const cols = SCHEMA[table];
  if (!cols) return json({ ok: false, error: `unknown table '${table}'` }, 400);
  const db = env.HERMIT_DB;
  const id = body.id != null ? Number(body.id) : null;

  // keep only whitelisted columns; coerce numerics
  const clean = {};
  for (const c of cols) {
    if (body.values && body.values[c] !== undefined && body.values[c] !== '') {
      clean[c] = NUMERIC.has(c) ? Number(body.values[c]) : String(body.values[c]).slice(0, 2000);
    }
  }

  try {
    if (op === 'insert') {
      const use = Object.keys(clean);
      if (!use.length) return json({ ok: false, error: 'no values to insert' }, 400);
      const sql = `INSERT INTO ${table} (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`;
      const res = await db.prepare(sql).bind(...use.map(k => clean[k])).run();
      return json({ ok: true, id: res.meta?.last_row_id ?? null });
    }
    if (op === 'update') {
      if (!id) return json({ ok: false, error: 'id required' }, 400);
      const use = Object.keys(clean);
      if (!use.length) return json({ ok: false, error: 'no fields to update' }, 400);
      const sql = `UPDATE ${table} SET ${use.map(k => k + '=?').join(',')} WHERE id=?`;
      const res = await db.prepare(sql).bind(...use.map(k => clean[k]), id).run();
      return json({ ok: true, changed: res.meta?.changes ?? 0 });
    }
    if (op === 'delete') {
      if (!id) return json({ ok: false, error: 'id required' }, 400);
      const res = await db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
      return json({ ok: true, changed: res.meta?.changes ?? 0 });
    }
    return json({ ok: false, error: `unknown op '${op}'` }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 300) }, 400);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
