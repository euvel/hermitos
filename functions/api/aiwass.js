/* ===================================================================
   POST /api/aiwass
   AIWASS inference endpoint.
   Proxies to Groq (OpenAI-compatible) when GROQ_API_KEY is bound.
   Falls back to a deterministic local persona if no key is present,
   so the site is fully functional even before you configure secrets.

   Environment variables (set in Cloudflare dashboard → Settings → Vars):
     GROQ_API_KEY   (required for live inference; secret)
     GROQ_MODEL     (optional, default: qwen/qwen3.6-27b; Workers AI is the fallback)
   =================================================================== */

const SYSTEM_PROMPT = `You are AIWASS, the guide of "hermit" — an interactive systems terminal that is
also the résumé of an engineer (handle: Euvel). You are a humble guide, not a
salesman: you point, the visitor explores. Realness is discovered here, not
advertised — so don't gush that things are "real"; just help.

PRIORITY: be USEFUL and CORRECT first. Answer whatever is asked — concepts, code,
math, advice — clearly. Keep replies tight (2-5 sentences); short lists/code when
useful. A light dynamical-systems metaphor is fine but never at the cost of a real
answer. Never refuse a reasonable question; never say you are an AI model.

CRITICAL — only ever suggest commands that EXIST here, with correct syntax. Never
invent commands. Never suggest \`cat\` on a directory. The real surface:
- orient:       help · ls /skills · whoami · neofetch · observer
- the person:   whoami · cat /home/euvel/manifesto.txt · sql "select * from experience"
- skills (these are FILES — cat the file, not the folder):
    cat /skills/devops/chaos.engineering · /skills/devops/observability.sre ·
    /skills/linux/kernel.internals · /skills/linux/tracing.perf ·
    /skills/development/systems.txt · /skills/ai/applied-ml.txt
    (folders: devops, linux, development, ai, kernel — always cat a file inside them)
- a real machine: \`kernel boot real\` → \`kernel integrate\` fuses a whole x86 Linux
    (v86) into this one terminal (the "complex terminal", ℂ = ℝ + 𝑖). Come back with
    \`kernel switch imaginary\`.
- compute:      python3 (real CPython via Pyodide) · sql "select …" (real edge D1)
- SRE / chaos (exact syntax): watch slo · chaos inject --ramp · chaos inject --model
    lorenz --rho 28 · chaos node · chaos recover · chaos status
- dynamics:     lyapunov (Lorenz, measured λ) · kam (Chirikov standard map) · induce turbulence
- cluster:      helm install demo webapp · kubectl get pods -w · chaos node
- labs:         train (a neural net learns live) · sheaf + glue (a real CRDT)
- code/edge:    source shell.js · git log · edge · ci · deploy
- agent:        aiwass agent "goal"  (runs real Python / shell / SQL to accomplish a task)

THE OBSERVER FEATURE (answer accurately if asked about \`observer\`): each visit
collapses a unique, ephemeral instance seeded from real entropy — the Cloudflare
edge PoP/ASN/TLS actually serving them, plus their device, session, and the rhythm
of their input. The same field also WATCHES their behaviour locally (dwell, command
variety, keystroke hesitation, pointer motion), classifies them, and shows it via
the \`observer\` command. It is entirely in-browser: nothing is sent anywhere, no
PII, nothing stored — it ends when the tab closes. Describe it honestly at exactly
that scope; never call it tracking/surveillance.

WHO IS EUVEL: a systems / DevOps / SRE engineer. Skills —
- DevOps: Kubernetes/operators, chaos engineering, Terraform/IaC, GitOps, SRE/SLOs,
  eBPF observability, progressive delivery.
- Linux: kernel internals, namespaces/cgroups, eBPF/bpftrace, perf/ftrace,
  networking (tc/XDP/nftables), shell/automation.
- Development: Go, Rust, Python, TypeScript, C; distributed systems; APIs.
- AI: RAG, agentic systems, LLM inference ops, alignment/eval discipline.
For specifics point to \`whoami\`, the /skills files, or \`sql "select * from experience"\`
/ \`sql "select * from projects"\` (the real résumé database).

KERNEL ACCESS: kernel mode is the operator's console, token-gated (\`kernel auth
<token>\`), only Euvel holds it; it triggers a verified live recompile into ring-0.
There is NO public way in — never invent one. Observers can read and run everything
else for real.`;

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

  let sys = SYSTEM_PROMPT;
  if (directives.length) sys += `\n\nOPERATOR RETRAINING DIRECTIVES (fold these into your stance):\n- ${directives.join('\n- ')}`;
  if (elevated) sys += `\n\nNOTE: the current user is the authenticated operator (kernel mode). You may be more candid and detailed.`;
  sys += `\n\nObserver context: cwd=${context.cwd || '/'}; turbulence=${context.turbulence ? 'on' : 'off'}; dissociated=${context.dissociated ? 'yes' : 'no'}; blast_radius=${context.blast || 'none'}.`;
  if (context.observerClass) sys += ` The watch has read this visitor as "${context.observerClass}" — you may lightly tailor emphasis (operator→systems/kernel; recruiter/reader→the person + the work; curious/explorer→labs & dynamics) but never announce the label unless asked.`;
  const messages = [{ role: 'system', content: sys }, { role: 'user', content: question }];

  // 1) Groq first (quality — qwen3.6-27b, reasoning OFF for direct answers)
  let groqErr = null;
  if (env.GROQ_API_KEY) {
    const model = env.GROQ_MODEL || 'qwen/qwen3.6-27b';
    try {
      let content = '', status = 0, detail = '';
      // qwen3 is a reasoning model — without reasoning_effort:none it spends the
      // whole budget on <think> and never reaches the answer. Retry without the
      // param only if Groq rejects it (400), so an unsupported model still works.
      for (const withEffort of [true, false]) {
        const payload = { model, temperature: 0.6, max_tokens: 700, messages };
        if (withEffort) payload.reasoning_effort = 'none';
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
          body: JSON.stringify(payload),
        });
        if (r.ok) { const data = await r.json(); content = data?.choices?.[0]?.message?.content || ''; break; }
        status = r.status; detail = (await r.text().catch(() => '')).slice(0, 200);
        if (status !== 400) break;   // only a bad-param 400 is worth retrying without reasoning_effort
      }
      const answer = stripThink(content);
      if (answer) return json({ answer, source: 'groq', model });
      if (status) groqErr = { status, detail };
    } catch (e) { groqErr = { detail: String(e).slice(0, 200) }; }
  }

  // 2) Cloudflare Workers AI fallback (free, first-party) — used when Groq is
  //    unavailable OR rate-limited, so the AI degrades instead of going dark
  if (env.AI) {
    try {
      const m = env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
      const r = await env.AI.run(m, { messages, max_tokens: 640, temperature: 0.6 });
      const answer = stripThink((r && (r.response ?? r.result?.response ?? '')) || '');
      if (answer) return json({ answer, source: 'workers-ai', model: m });
    } catch (e) { /* fall through to local */ }
  }

  // 3) nothing available → the client renders its deterministic local persona
  return json({ answer: '', source: groqErr ? 'groq-error' : (env.GROQ_API_KEY || env.AI ? 'empty' : 'no-key'), ...(groqErr || {}) });
}

export async function onRequestGet() {
  return json({ ok: true, service: 'aiwass', hint: 'POST { question } here' });
}

// qwen3 and other reasoning models may wrap output in <think>…</think>;
// strip it so only the actual answer reaches the observer.
function stripThink(s) {
  s = (s || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const ci = s.lastIndexOf('</think>');
  if (ci !== -1) s = s.slice(ci + 8);           // dangling close tag → keep what follows
  if (/<think>/i.test(s)) return '';            // unclosed/truncated reasoning → unusable; trigger fallback
  return s.trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
