/* ===================================================================
   POST /api/admin/logout — clear the session cookie. Exempt from the
   session gate so it always succeeds (even after expiry).
   =================================================================== */

import { sessionCookie } from './_session.js';

export async function onRequestPost({ request }) {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'set-cookie': sessionCookie('', new URL(request.url), 0),
    },
  });
}
