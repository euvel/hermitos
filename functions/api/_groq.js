/* ===================================================================
   Groq chat completion with a model fallback chain (shared by
   /api/aiwass and /api/agent). File is _-prefixed so Pages does not
   route it.

   Groq retires models at short notice (qwen3.6-27b went 404
   model_not_found overnight), so a single hard-coded model can
   take AIWASS dark. Each model in the chain is tried in order; ANY
   failure (404 retired, 429 rate-limited, 5xx, empty) moves on to the
   next, since models have independent availability and rate limits.
   An env override (GROQ_MODEL / GROQ_AGENT_MODEL) is tried first.
   =================================================================== */

// production first; the preview model is a quality bonus, not a dependency
const CHAIN = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'llama-3.1-8b-instant'];

// reasoning models burn max_tokens on chain-of-thought unless told not to;
// gpt-oss has no "none", so ask for the least it allows
function effortFor(model) {
  if (model.startsWith('openai/gpt-oss')) return 'low';
  if (model.startsWith('qwen/')) return 'none';
  return null;
}

export async function groqChat(env, { messages, max_tokens, temperature, override }) {
  const models = [...new Set([override, ...CHAIN].filter(Boolean))];
  const errors = [];
  for (const model of models) {
    const effort = effortFor(model);
    // retry once without reasoning_effort only if Groq rejects the param (400)
    for (const withEffort of effort ? [true, false] : [false]) {
      const payload = { model, messages, max_tokens, temperature };
      if (withEffort) payload.reasoning_effort = effort;
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          const data = await r.json();
          const text = stripThink(data?.choices?.[0]?.message?.content || '');
          if (text) return { text, model };
          errors.push({ model, detail: 'empty completion' });
          break;
        }
        const detail = (await r.text().catch(() => '')).slice(0, 200);
        errors.push({ model, status: r.status, detail });
        if (r.status !== 400) break;   // 404/429/5xx → next model
      } catch (e) {
        errors.push({ model, detail: String(e).slice(0, 200) });
        break;
      }
    }
  }
  return { text: '', errors };
}

// reasoning models (qwen3, …) may wrap output in <think>…</think>; strip it
// so only the answer reaches the observer / the agent's JSON parser.
export function stripThink(s) {
  s = (s || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const ci = s.lastIndexOf('</think>');
  if (ci !== -1) s = s.slice(ci + 8);           // dangling close tag → keep what follows
  if (/<think>/i.test(s)) return '';            // unclosed/truncated reasoning → unusable; trigger fallback
  return s.trim();
}
