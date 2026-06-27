/* ===================================================================
   PUT /api/admin/content   (guarded by _middleware.js)
   Persists the elevated operator's entries + AIWASS directives to KV.
   Body: { entries: [...], directives: [...] }
   =================================================================== */

export async function onRequestPut({ request, env }) {
  if (!env.HERMIT_KV) {
    return json({ ok: false, error: 'HERMIT_KV not bound. Add the KV binding in Pages → Settings → Functions.' }, 503);
  }
  let body;
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'invalid JSON' }, 400); }

  const entries = Array.isArray(body.entries) ? body.entries.slice(0, 200).map(sanitize) : [];
  const directives = Array.isArray(body.directives) ? body.directives.slice(0, 50).map(d => String(d).slice(0, 500)) : [];

  await env.HERMIT_KV.put('content', JSON.stringify({ entries, directives, updated: Date.now() }));
  return json({ ok: true, stored: entries.length, directives: directives.length });
}

export async function onRequestGet({ env }) {
  // convenience read-back for the elevated operator
  if (!env.HERMIT_KV) return json({ ok: false, error: 'HERMIT_KV not bound' }, 503);
  const raw = await env.HERMIT_KV.get('content');
  return json({ ok: true, content: raw ? JSON.parse(raw) : null });
}

function sanitize(e) {
  return {
    id: Number(e.id) || 0,
    type: ['experience', 'project', 'idea'].includes(e.type) ? e.type : 'idea',
    title: String(e.title || 'untitled').slice(0, 160),
    body: String(e.body || '').slice(0, 2000),
    ts: Number(e.ts) || Date.now(),
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
