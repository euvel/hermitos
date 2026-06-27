/* ===================================================================
   GET /api/whereami — REAL edge telemetry about the visitor's request.
   Everything here comes from Cloudflare's `request.cf` object and request
   headers: the actual data center (colo) serving you, your network, the
   protocol negotiated. Nothing is invented; on a non-CF host it's sparse.
   =================================================================== */

export async function onRequestGet({ request }) {
  const cf = request.cf || {};
  const h = request.headers;
  const data = {
    ok: true,
    colo: cf.colo || null,                 // 3-letter IATA code of the PoP
    country: cf.country || null,
    city: cf.city || null,
    region: cf.region || null,
    continent: cf.continent || null,
    timezone: cf.timezone || null,
    latitude: cf.latitude || null,
    longitude: cf.longitude || null,
    asn: cf.asn || null,
    asOrganization: cf.asOrganization || null,
    httpProtocol: cf.httpProtocol || h.get('x-forwarded-proto') || null,
    tlsVersion: cf.tlsVersion || null,
    tlsCipher: cf.tlsCipher || null,
    ip: h.get('cf-connecting-ip') || null,
    ray: h.get('cf-ray') || null,
    edge: !!request.cf,                     // true only when served through Cloudflare
  };
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
