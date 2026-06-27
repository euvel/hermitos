/* ===================================================================
   /api/fault — REAL fault injection state (chaos engineering)
   GET  → current active fault (or null)
   POST → set a fault that the site's OWN real endpoints honor
          (/api/ping and /api/aiwass actually add latency / return 5xx).

   This is genuine chaos engineering against this site's real edge
   infrastructure — not a simulation. Guardrails keep it safe & honest:
     - latency capped at 800ms, error rate capped at 0.5
     - every fault AUTO-EXPIRES (<= 60s) and the system self-heals
     - stored in KV (one write per injection — well within free tier)

   Requires KV binding HERMIT_KV. Without it, fault state is a no-op and
   the dashboard simply shows a steady (healthy) baseline.
   =================================================================== */

const MAX_LATENCY = 800;     // ms
const MAX_ERRORS = 0.5;      // fraction
const MAX_TTL = 60;          // seconds

export async function readFault(env) {
  if (!env.HERMIT_KV) return null;
  try {
    const raw = await env.HERMIT_KV.get('fault');
    if (!raw) return null;
    const f = JSON.parse(raw);
    if (!f || !f.until || Date.now() > f.until) return null; // expired → healed
    return f;
  } catch (_) { return null; }
}

export async function onRequestGet({ env }) {
  const f = await readFault(env);
  return json({ fault: f, healthy: !f, serverTime: Date.now() });
}

export async function onRequestPost({ request, env }) {
  if (!env.HERMIT_KV) {
    return json({ ok: false, error: 'HERMIT_KV not bound; fault injection is a no-op. Bind KV to enable real chaos.' }, 503);
  }
  let body = {};
  try { body = await request.json(); } catch (_) {}

  // clear / recover
  if (body.clear) {
    await env.HERMIT_KV.put('fault', JSON.stringify({ until: 0 }));
    return json({ ok: true, fault: null, recovered: true });
  }

  const latency = clamp(Number(body.latency) || 0, 0, MAX_LATENCY);
  const errorRate = clamp(Number(body.errorRate) || 0, 0, MAX_ERRORS);
  const ttl = clamp(Number(body.ttl) || 30, 1, MAX_TTL);
  const kind = String(body.kind || 'latency').slice(0, 24);

  if (latency === 0 && errorRate === 0) {
    return json({ ok: false, error: 'specify latency (ms) and/or errorRate (0..0.5)' }, 400);
  }

  const fault = { latency, errorRate, kind, since: Date.now(), until: Date.now() + ttl * 1000 };
  await env.HERMIT_KV.put('fault', JSON.stringify(fault), { expirationTtl: Math.max(60, ttl + 5) });
  return json({ ok: true, fault });
}

/* helper other endpoints use to actually APPLY the fault */
export async function applyFault(env) {
  const f = await readFault(env);
  if (!f) return { injected: false };
  if (f.errorRate && Math.random() < f.errorRate) {
    return { injected: true, error: true };
  }
  if (f.latency) {
    await new Promise(r => setTimeout(r, f.latency));
    return { injected: true, latency: f.latency };
  }
  return { injected: false };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
