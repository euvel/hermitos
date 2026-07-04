/* ===================================================================
   /api/ping — the SLI probe.
   A real edge request the SLO dashboard times. It honors any active
   injected fault (real latency / real 5xx), so the latency and error
   rate the `watch slo` dashboard reports are GENUINELY measured from
   real round-trips to real Cloudflare infrastructure.

   It also honors a per-request `?inject=<ms>` — a structured latency
   the SRE console drives from a real dynamical system (Lorenz / AR(1)
   approaching criticality). The edge really sleeps for it, so the
   round-trip the console times carries the attractor's fingerprint.
   Capped at 800ms to stay a well-behaved neighbour on the free tier.
   =================================================================== */

import { applyFault } from './fault.js';

const MAX_INJECT = 800;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function onRequestGet({ request, env }) {
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

  // structured, client-driven latency the edge really sleeps for
  let structured = 0;
  try {
    const q = Number(new URL(request.url).searchParams.get('inject'));
    if (q > 0) { structured = Math.min(MAX_INJECT, q); await sleep(structured); }
  } catch (_) {}

  const dur = Date.now() - t0;
  return new Response(JSON.stringify({
    ok: true,
    pop: env.CF_PAGES_BRANCH || 'edge',
    injected: fx.injected || structured > 0,
    structured,
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
