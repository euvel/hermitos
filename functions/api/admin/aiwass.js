/* ===================================================================
   POST /api/admin/aiwass   (guarded by _middleware.js)
   Append a retraining directive for AIWASS. Persisted to KV and merged
   into the system prompt on subsequent /api/aiwass calls' client payload.
   Body: { directive: "..." }
   =================================================================== */

export async function onRequestPost({ request, env }) {
  if (!env.HERMIT_KV) {
    return json({ ok: false, error: 'HERMIT_KV not bound.' }, 503);
  }
  let body;
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'invalid JSON' }, 400); }
  const directive = String(body.directive || '').slice(0, 500).trim();
  if (!directive) return json({ ok: false, error: 'empty directive' }, 400);

  const raw = await env.HERMIT_KV.get('content');
  const data = raw ? JSON.parse(raw) : { entries: [], directives: [] };
  data.directives = (data.directives || []).concat(directive).slice(-50);
  data.updated = Date.now();
  await env.HERMIT_KV.put('content', JSON.stringify(data));

  return json({ ok: true, directives: data.directives.length });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
