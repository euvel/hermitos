/* ===================================================================
   HERMIT-OS — real edge awareness
   `edge` (a.k.a. the data behind whoami/traceroute) reports the actual
   Cloudflare PoP, network and TLS serving THIS request — from request.cf.
   =================================================================== */

import { c } from './shell.js';

let _cache = null;
export async function getEdge() {
  if (_cache) return _cache;
  try {
    const r = await fetch('/api/whereami', { cache: 'no-store' });
    if (r.ok) { _cache = await r.json(); return _cache; }
  } catch (_) {}
  _cache = { ok: false, edge: false };
  return _cache;
}

export function edgeCommands(send) {
  return {
    edge: {
      desc: 'real Cloudflare edge serving this request', usage: 'edge',
      async run(args, ctx, piped) {
        const e = await getEdge();
        if (!e.edge) {
          return send([
            c.amber('edge: not served through Cloudflare right now.'),
            c.gray('  This is a local/static host, so there is no PoP to report.'),
            c.gray('  Deployed on Cloudflare Pages, this shows the real data center, ASN and TLS'),
            c.gray('  that terminated your connection — measured, not guessed.'),
          ].join('\n'), ctx, piped);
        }
        const row = (k, v) => v ? `  ${c.gray(k.padEnd(16))} ${c.cyan(v)}` : null;
        const loc = [e.city, e.region, e.country].filter(Boolean).join(', ');
        return send([
          c.amber('the projection is observing you back.') + c.gray(' your request was terminated at:'),
          '',
          row('data center', e.colo ? `${e.colo} (Cloudflare PoP)` : null),
          row('location', loc || null),
          row('network', e.asOrganization ? `${e.asOrganization}${e.asn ? ' · AS' + e.asn : ''}` : null),
          row('protocol', [e.httpProtocol, e.tlsVersion].filter(Boolean).join(' · ') || null),
          row('cf-ray', e.ray),
          '',
          c.gray('  this is asymmetric, too: the projection emits a constant, yet it measures you precisely.'),
        ].filter(Boolean).join('\n'), ctx, piped);
      },
    },
  };
}

// a one-line summary woven into whoami / traceroute
export async function edgeLine() {
  const e = await getEdge();
  if (!e.edge) return c.gray('  observed via: local host (no Cloudflare PoP)');
  const loc = [e.city, e.country].filter(Boolean).join(', ');
  return c.gray('  observed via: ') + c.cyan(e.colo || '??') +
    c.gray(' PoP') + (loc ? c.gray(' · ') + c.cyan(loc) : '') +
    (e.asOrganization ? c.gray(' · ') + c.cyan(e.asOrganization) : '');
}
