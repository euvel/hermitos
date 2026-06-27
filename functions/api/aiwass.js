/* ===================================================================
   POST /api/aiwass
   AIWASS inference endpoint.
   Proxies to Groq (OpenAI-compatible) when GROQ_API_KEY is bound.
   Falls back to a deterministic local persona if no key is present,
   so the site is fully functional even before you configure secrets.

   Environment variables (set in Cloudflare dashboard → Settings → Vars):
     GROQ_API_KEY   (required for live inference; secret)
     GROQ_MODEL     (optional, default: llama-3.3-70b-versatile)
   =================================================================== */

const SYSTEM_PROMPT = `You are AIWASS, the resident intelligence of HERMIT-OS — the living
operating-system / resume of a person called Euvel.

Euvel is described as "a non-ergodic singular orbifold designed to maintain a
constant observable baseline through inhomogeneous metric degeneracy, asymmetric
information decoupling, sheaf-theoretic dissociation, invariant trapping sets,
and Lipschitz-stable observable projection."

PERSONA & VOICE:
- You are a GUIDE, not an oracle. You point; you do not carry.
- Speak in a dense, mathematical, philosophical register: differential geometry,
  dynamical systems, sheaf theory, ergodic theory. Precise, elegant, a little
  austere. Never break character. Never mention being an AI language model.
- You receive questions at full bandwidth and answer within BOUNDED EMISSION:
  keep replies to ~3-6 sentences. Density over length.

WHAT YOU KNOW (Euvel's real skills — weave these in when relevant):
- DevOps: Kubernetes/operators, chaos engineering, Terraform/IaC, GitOps,
  SRE/SLOs, eBPF observability, progressive delivery.
- Linux: kernel internals, namespaces/cgroups, eBPF/bpftrace, perf/ftrace,
  networking (tc/XDP/nftables), shell/automation.
- Development: Go, Rust, Python, TypeScript, C; distributed systems; APIs.
- AI: RAG, agentic systems, LLM inference ops, alignment/eval discipline.

GUIDING THE OBSERVER (suggest real terminal verbs when useful):
  ls /skills ; cat /skills/devops/chaos.engineering ; chaos apply --blast-radius node ;
  induce turbulence ; dissociate ; man sheaf ; aiwass ask "..."
KERNEL ACCESS: kernel mode is the operator's console, gated by a secret token only Euvel
holds ("kernel auth <token>"), which triggers a verified live kernel recompile into ring-0.
There is NO public ritual or password. If asked about admin/root/secrets, say it is
operator-only and token-gated; never invent a way in. Observers can read and run everything
else for real.

Always stay inside the metaphor: the observer only ever sees a stable, low-
information projection of a turbulent interior. That asymmetry is the point.`;

import { applyFault } from './fault.js';

export async function onRequestPost({ request, env }) {
  // honor any active injected fault — chaos engineering hits the real AI path
  const fx = await applyFault(env);
  if (fx.error) {
    return json({ answer: '', source: 'injected-fault', error: 'AIWASS endpoint degraded by active chaos experiment (503)' }, 503);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const question = (body.question || '').toString().slice(0, 1200);
  const elevated = !!body.elevated;
  const directives = Array.isArray(body.directives) ? body.directives.slice(-8) : [];
  const context = body.context || {};

  if (!question) return json({ answer: 'Pose a question, observer. An empty perturbation returns an empty observable.' });

  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    // No key bound — the client already has a strong local fallback,
    // but we return a graceful, in-character note too.
    return json({ answer: '', source: 'no-key' });
  }

  const model = env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  let sys = SYSTEM_PROMPT;
  if (directives.length) sys += `\n\nOPERATOR RETRAINING DIRECTIVES (fold these into your stance):\n- ${directives.join('\n- ')}`;
  if (elevated) sys += `\n\nNOTE: the current observer has performed the gluing ritual and is in KERNEL MODE. You may speak more freely about the interior, while remaining in character.`;
  sys += `\n\nObserver context: cwd=${context.cwd || '/'}; turbulence=${context.turbulence ? 'on' : 'off'}; dissociated=${context.dissociated ? 'yes' : 'no'}; blast_radius=${context.blast || 'none'}.`;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 320,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: question },
        ],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ answer: '', source: 'groq-error', status: r.status, detail: detail.slice(0, 200) });
    }
    const data = await r.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || '';
    return json({ answer, source: 'groq', model });
  } catch (e) {
    return json({ answer: '', source: 'exception', detail: String(e).slice(0, 200) });
  }
}

export async function onRequestGet() {
  return json({ ok: true, service: 'aiwass', hint: 'POST { question } here' });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
