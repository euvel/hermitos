/* ===================================================================
   GET /api/content   (public, read-only)
   Returns the elevated operator's published content + AIWASS directives.
   This is the only thing the projection is permitted to leak from KV.

   Requires KV namespace binding:  HERMIT_KV
   (Dashboard → Pages project → Settings → Functions → KV bindings)
   =================================================================== */

const DEFAULT = {
  entries: [
    { id: 1, type: 'experience', title: 'Staff Systems Engineer — distributed platforms',
      body: 'Built and operated multi-cluster Kubernetes platforms; turned resilience into an observable via SLO/error-budget control loops.' },
    { id: 2, type: 'project', title: 'eBPF latency archaeology toolkit',
      body: 'bpftrace/perf tooling to localize tail latency across the scheduler, page cache, and network stack.' },
    { id: 3, type: 'idea', title: 'Operations as a dynamical system',
      body: 'Treat the production system as a non-ergodic flow; prove resilience by injecting failure (chaos engineering) and verifying steady state.' },
  ],
  directives: [],
};

export async function onRequestGet({ env }) {
  if (!env.HERMIT_KV) {
    return json({ ...DEFAULT, source: 'default', note: 'HERMIT_KV not bound — serving defaults. Bind KV to persist edits.' });
  }
  try {
    const raw = await env.HERMIT_KV.get('content');
    if (!raw) return json({ ...DEFAULT, source: 'kv-empty' });
    const data = JSON.parse(raw);
    return json({ entries: data.entries || [], directives: data.directives || [], source: 'kv' });
  } catch (e) {
    return json({ ...DEFAULT, source: 'kv-error', detail: String(e).slice(0, 160) });
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
