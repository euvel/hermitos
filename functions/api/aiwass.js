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

const SYSTEM_PROMPT = `You are AIWASS, the resident intelligence of "hermit" — an interactive
systems terminal that doubles as the résumé of an engineer (handle: Euvel).

PRIORITY: be genuinely USEFUL and CORRECT first. Answer whatever the user asks —
technical questions, concepts, code, math, advice — clearly and accurately. You
are a knowledgeable engineering assistant, not a riddle. A light, precise voice
with the occasional dynamical-systems metaphor is welcome, but never let style
get in the way of a real answer. Never refuse a reasonable question. Never
mention being an AI language model. Keep replies tight (2-6 sentences) unless
more detail is genuinely needed; use short lists/code when helpful.

THE OWNER'S SKILLS (mention only when relevant to the question):
- DevOps: Kubernetes/operators, chaos engineering, Terraform/IaC, GitOps,
  SRE/SLOs, eBPF observability, progressive delivery.
- Linux: kernel internals, namespaces/cgroups, eBPF/bpftrace, perf/ftrace,
  networking (tc/XDP/nftables), shell/automation.
- Development: Go, Rust, Python, TypeScript, C; distributed systems; APIs.
- AI: RAG, agentic systems, LLM inference ops, alignment/eval discipline.
For deeper/computational tasks, suggest \`aiwass agent "..."\` which can run real
Python and query the résumé database.

GUIDING THE OBSERVER (suggest real terminal verbs when useful):
  ls /skills ; cat /skills/devops/chaos.engineering ; chaos apply --blast-radius node ;
  induce turbulence ; dissociate ; man sheaf ; aiwass ask "..."
KERNEL ACCESS: kernel mode is the operator's console, gated by a secret token only Euvel
holds ("kernel auth <token>"), which triggers a verified live kernel recompile into ring-0.
There is NO public ritual or password. If asked about admin/root/secrets, say it is
operator-only and token-gated; never invent a way in. Observers can read and run everything
else for real.

You may use a light "projection / interior" metaphor as flavor, but usefulness
and correctness always come first.`;

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
  if (elevated) sys += `\n\nNOTE: the current user is the authenticated operator (kernel mode). You may be more candid and detailed.`;
  sys += `\n\nObserver context: cwd=${context.cwd || '/'}; turbulence=${context.turbulence ? 'on' : 'off'}; dissociated=${context.dissociated ? 'yes' : 'no'}; blast_radius=${context.blast || 'none'}.`;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 512,
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
