/* ===================================================================
   POST /api/agent  — a single reasoning turn for the AIWASS agent.
   The client runs the ReAct tool-use loop and executes the tools
   (sql over D1, grep/read over the skill tree) for real; this endpoint
   only produces one model completion per step.

   Model backends, in order of preference (all optional):
     1. Cloudflare Workers AI  (binding: AI)  — first-party, free tier
     2. Groq                   (env GROQ_API_KEY)
     3. none → { source: "no-llm" }; client falls back to a heuristic planner
   =================================================================== */

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const messages = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
  const maxTokens = Math.min(body.max_tokens || 512, 768);
  if (!messages.length) return json({ text: '', source: 'empty' });

  // 1) Workers AI (free, first-party)
  if (env.AI) {
    try {
      const model = env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
      const r = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.4 });
      const text = (r && (r.response ?? r.result?.response ?? '')) || '';
      if (text) return json({ text: text.trim(), source: 'workers-ai', model });
    } catch (e) {
      // fall through to Groq / no-llm
    }
  }

  // 2) Groq
  if (env.GROQ_API_KEY) {
    try {
      const model = env.GROQ_MODEL || 'llama-3.3-70b-versatile';
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.4 }),
      });
      if (r.ok) {
        const data = await r.json();
        const text = data?.choices?.[0]?.message?.content?.trim() || '';
        if (text) return json({ text, source: 'groq', model });
      }
    } catch (e) { /* fall through */ }
  }

  // 3) no model available — client will use its deterministic planner
  return json({ text: '', source: 'no-llm' });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
