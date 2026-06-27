/* ===================================================================
   Guard for /api/admin/*  — the only write path into the kernel.

   Elevation gate:
   - Requires env.KERNEL_TOKEN to be set (Dashboard → Vars, mark as secret).
   - Requests must present it in header `x-hermit-elevated` (constant-time
     compared). The in-browser gluing ritual unlocks the editor UI; this
     token is what actually authorizes persistence to KV.
   - If KERNEL_TOKEN is unset, writes are refused (fail closed) with a hint.
   =================================================================== */

export async function onRequest({ request, env, next }) {
  const expected = env.KERNEL_TOKEN;
  if (!expected) {
    return json({ ok: false, error: 'KERNEL_TOKEN not configured. Set it in Dashboard → Settings → Variables (encrypt it), then `kernel auth <token>` in the terminal.' }, 503);
  }
  const provided = request.headers.get('x-hermit-elevated') || '';
  if (!timingSafeEqual(provided, expected)) {
    return json({ ok: false, error: 'permission denied — the gluing did not authorize this write. `kernel auth <token>` first.' }, 401);
  }
  return next();
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
