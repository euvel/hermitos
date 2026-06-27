/* ===================================================================
   GET /api/admin/verify  — token check for `kernel auth`.
   Guarded by _middleware.js: reaching this handler at all means the
   x-hermit-elevated header matched KERNEL_TOKEN (constant-time).
     200 → token valid           (middleware let us through)
     401 → wrong token           (from middleware)
     503 → KERNEL_TOKEN not set   (from middleware)
   =================================================================== */

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
