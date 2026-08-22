/* ===================================================================
   POST /api/agent  — a single reasoning turn for the AIWASS agent.
   The client runs the ReAct tool-use loop and executes the tools
   (sql over D1, grep/read over the skill tree) for real; this endpoint
   only produces one model completion per step.

   Model backends, in order of preference (all optional):
     1. Groq                   (env GROQ_API_KEY)  — qwen3.6-27b by default
     2. Cloudflare Workers AI  (binding: AI)       — free-tier fallback
     3. none → { source: "no-llm" }; client falls back to a heuristic planner
   =================================================================== */

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  let messages = Array.isArray(body.messages) ? body.messages : [];
  // keep the context bounded WITHOUT dropping the system prompt (messages[0]):
  // that instruction carries the ReAct contract, so preserve it + the last 15.
  if (messages.length > 16) messages = [messages[0], ...messages.slice(-15)];
  const maxTokens = Math.min(body.max_tokens || 512, 768);
  if (!messages.length) return json({ text: '', source: 'empty' });

  // 1) Groq first (quality — qwen3.6-27b)
  if (env.GROQ_API_KEY) {
    try {
      const model = env.GROQ_AGENT_MODEL || 'qwen/qwen3.6-27b';
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.3 }),
      });
      if (r.ok) {
        const data = await r.json();
        const text = stripThink(data?.choices?.[0]?.message?.content || '');
        if (text) return json({ text, source: 'groq', model });
      }
      // not ok (404 model / 429 rate-limit / 5xx) → fall through to Workers AI
    } catch (e) { /* fall through */ }
  }

  // 2) Cloudflare Workers AI fallback (free, first-party) — used when Groq is
  //    unavailable or rate-limited, so the agent degrades instead of dying
  if (env.AI) {
    try {
      const model = env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
      const r = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.4 });
      const text = stripThink((r && (r.response ?? r.result?.response ?? '')) || '');
      if (text) return json({ text, source: 'workers-ai', model });
    } catch (e) { /* fall through */ }
  }

  // 3) no model available — client will use its deterministic planner
  return json({ text: '', source: 'no-llm' });
}

// reasoning models (qwen3, …) may emit <think>…</think>; strip it so the
// client's JSON parser sees only the action object.
function stripThink(s) {
  s = (s || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const ci = s.lastIndexOf('</think>');
  if (ci !== -1) s = s.slice(ci + 8);
  return s.trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
