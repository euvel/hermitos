/* ===================================================================
   /api/ping — the SLI probe.
   A real edge request the SLO dashboard times. It honors any active
   injected fault (real latency / real 5xx), so the latency and error
   rate the `watch slo` dashboard reports are GENUINELY measured from
   real round-trips to real Cloudflare infrastructure.
   =================================================================== */

import { applyFault } from './fault.js';

export async function onRequestGet({ env }) {
  const t0 = Date.now();
  const fx = await applyFault(env);

  if (fx.error) {
    return new Response(JSON.stringify({ ok: false, error: 'injected fault: upstream 503', served: Date.now() - t0 }), {
      status: 503,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'server-timing': `app;dur=${Date.now() - t0}`,
      },
    });
  }

  const dur = Date.now() - t0;
  return new Response(JSON.stringify({
    ok: true,
    pop: env.CF_PAGES_BRANCH || 'edge',
    injected: fx.injected || false,
    served: dur,
    ts: Date.now(),
  }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'server-timing': `app;dur=${dur}`,
    },
  });
}
