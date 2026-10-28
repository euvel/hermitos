/* ===================================================================
   POST /api/agent  — a single reasoning turn for the AIWASS agent.
   The client runs the ReAct tool-use loop and executes the tools
   (sql over D1, grep/read over the skill tree) for real; this endpoint
   only produces one model completion per step.

   Model backends, in order of preference (all optional):
     1. Groq                   (env GROQ_API_KEY)  — model chain in _groq.js
     2. Cloudflare Workers AI  (binding: AI)       — free-tier fallback
     3. none → { source: "no-llm" }; client falls back to a heuristic planner
   =================================================================== */

import { groqChat, stripThink } from './_groq.js';

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  let messages = Array.isArray(body.messages) ? body.messages : [];
  // keep the context bounded WITHOUT dropping the system prompt (messages[0]):
  // that instruction carries the ReAct contract, so preserve it + the last 15.
  if (messages.length > 16) messages = [messages[0], ...messages.slice(-15)];
  const maxTokens = Math.min(body.max_tokens || 512, 768);
  if (!messages.length) return json({ text: '', source: 'empty' });

  // 1) Groq first (quality), walking a model fallback chain — see _groq.js
  if (env.GROQ_API_KEY) {
    const g = await groqChat(env, { messages, max_tokens: maxTokens, temperature: 0.3, override: env.GROQ_AGENT_MODEL });
    if (g.text) return json({ text: g.text, source: 'groq', model: g.model });
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
