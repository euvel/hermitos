/* ===================================================================
   Gate for /api/admin/*  — the only write path into the kernel.

   Auth model (professional, defence-in-depth):
   - `login` / `logout` are exempt (that's how you get / drop a session).
   - Every other admin request must carry a valid `hermit_session` cookie:
     an HMAC-signed, expiring token issued by /api/admin/login. The cookie
     is HttpOnly + SameSite=Strict (+ Secure on https), so JS can't read it
     and it isn't sent cross-site (CSRF mitigation). The master KERNEL_TOKEN
     is never stored client-side.
   - Fails closed if KERNEL_TOKEN is unset.
   =================================================================== */

import { verifySession, readSessionCookie } from './_session.js';

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (url.pathname.endsWith('/admin/login') || url.pathname.endsWith('/admin/logout')) {
    return next();
  }
  if (!env.KERNEL_TOKEN) {
    return json({ ok: false, error: 'KERNEL_TOKEN not configured. Set it in Dashboard → Settings → Variables (encrypted).' }, 503);
  }
  const ok = await verifySession(env.KERNEL_TOKEN, readSessionCookie(request));
  if (!ok) {
    return json({ ok: false, error: 'unauthenticated — run `kernel auth` first (session missing or expired).' }, 401);
  }
  return next();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
