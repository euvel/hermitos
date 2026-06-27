/* ===================================================================
   POST /api/admin/login  — exchange the master KERNEL_TOKEN (sent once)
   for a short-lived signed session cookie. The master token is verified
   in constant time and never echoed back. Exempt from the session gate
   in _middleware.js (this is how you obtain a session).
   =================================================================== */

import { issueSession, sessionCookie, timingSafeEqual } from './_session.js';

const TTL = 1800;   // 30 minutes

export async function onRequestPost({ request, env }) {
  if (!env.KERNEL_TOKEN) {
    return json({ ok: false, error: 'KERNEL_TOKEN is not configured on the edge.' }, 503);
  }
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const token = String(body.token || '');

  // small constant delay to blunt timing/brute-force probing
  await new Promise(r => setTimeout(r, 250));

  if (!timingSafeEqual(token, env.KERNEL_TOKEN)) {
    return json({ ok: false, error: 'authentication failed' }, 401);
  }

  const session = await issueSession(env.KERNEL_TOKEN, TTL);
  return new Response(JSON.stringify({ ok: true, expiresIn: TTL }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'set-cookie': sessionCookie(session, new URL(request.url), TTL),
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
