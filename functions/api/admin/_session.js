/* ===================================================================
   Admin session tokens — HMAC-signed, expiring, opaque.
   The master KERNEL_TOKEN is used ONLY to verify login and as the HMAC
   key; it is never sent back to the client. The client holds only a
   short-lived signed cookie (HttpOnly), which carries an expiry and a
   signature we re-verify on every admin request. (File is _-prefixed so
   Pages does not route it; it is imported by the endpoints.)
   =================================================================== */

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64urlStr(s) {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// issue a signed session valid for ttlSec seconds
export async function issueSession(secret, ttlSec = 1800) {
  const payload = b64urlStr(JSON.stringify({ exp: Date.now() + ttlSec * 1000, v: 1 }));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return payload + '.' + b64url(sig);
}

// verify signature + expiry; returns true only if both hold
export async function verifySession(secret, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const key = await hmacKey(secret);
  const expected = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  if (!timingSafeEqual(expected, sig)) return false;
  try {
    const data = JSON.parse(fromB64urlStr(payload));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch (_) { return false; }
}

// build a Set-Cookie string; Secure only over https so local dev still works
export function sessionCookie(value, url, maxAgeSec) {
  const secure = url && url.protocol === 'https:' ? ' Secure;' : '';
  return `hermit_session=${value}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

export function readSessionCookie(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)hermit_session=([^;]+)/);
  return m ? m[1] : '';
}
