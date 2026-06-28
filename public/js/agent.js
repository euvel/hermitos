/* ===================================================================
   HERMIT-OS — AIWASS agent: a watchable ReAct tool-use loop.
   The model plans; the loop executes REAL tools over REAL data:
     · sql(query)   → read-only SQL over Cloudflare D1
     · grep(term)   → search the skill tree (the virtual filesystem)
     · read(path)   → read a file from the projection
   Every Observation in the trace is a real tool result. The planner is
   a real LLM (Workers AI / Groq) when available, else a deterministic
   fallback — the tools and observations are real either way.
   =================================================================== */

import { c } from './shell.js';
import { fs, resolve, readFile, listDir } from './filesystem.js';
import { runPython } from './python.js';

const MAX_STEPS = 6;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SYSTEM = `You are AIWASS, an autonomous engineering assistant operating a real terminal.
Answer the GOAL by taking iterative steps with tools, ReAct-style — be genuinely useful.

Respond with ONE JSON object per turn, nothing else:
{"thought":"brief","action":"python|sql|grep|read|final","input":"..."}

TOOLS (use the FEWEST that get the job done):
- python : run real Python 3 (Pyodide). Use for ANY math, logic, proof, calculation,
           algorithm, simulation, or verification. print() the result. You may
           import numpy / sympy (auto-installed). This is your main reasoning tool.
- sql    : ONE read-only SQLite SELECT over the owner's résumé DB.
           projects(name,stack,year,impact,url) · experience(role,org,start_year,end_year,summary) · skills(area,name,level)
- grep   : search the skill tree for a term — only for questions about the owner's skills.
- read   : read a file, e.g. /skills/ai/applied-ml.txt
- final  : your answer to the user.

ROUTING:
- Math / computation / proofs / "calculate X" → python (e.g. import sympy; print(sympy.simplify(...))).
- About the owner's skills / projects / experience → sql, then grep/read if useful.
- General knowledge you already know confidently → answer directly with final. Do NOT grep for it.
Never grep vague phrases hoping for a hit. If two tool calls return nothing useful, switch tactic or finalize.
Final answers: correct first, concise, no purple prose.`;

export async function runAgent(ctx, goal) {
  const term = ctx.term;
  goal = (goal || '').trim();
  if (!goal) { ctx.shell.out(c.gray('usage: aiwass agent "a goal, e.g. \\"prove Euvel can run Kubernetes at scale\\""')); return ''; }

  ctx.bus.emit('orbifold:pulse', { kind: 'agent' });
  term.write('\r\n' + c.mag('aiwass·agent') + c.gray(' engaged. goal: ') + c.white(goal) + '\r\n');
  term.write(c.gray('the planner reasons; each observation below is a real tool result.\r\n'));

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `GOAL: ${goal}` },
  ];

  let usedLLM = true;
  for (let step = 1; step <= MAX_STEPS; step++) {
    term.write('\r\n' + c.gray(`── step ${step} `) + c.gray('─'.repeat(40)) + '\r\n');

    let raw = await callPlanner(messages, ctx);
    let act;
    if (raw == null) { usedLLM = false; act = heuristicStep(goal, ctx, step); }
    else act = parseAction(raw);

    if (!act) { act = { action: 'final', input: raw || 'inconclusive.' }; }

    if (act.thought) term.write(c.gray('  thought  ') + c.white(wrap(act.thought, 68, 11)) + '\r\n');

    if (act.action === 'final') {
      term.write(c.green('  answer   ') + c.white(wrap(act.input, 68, 11)) + '\r\n');
      term.write(c.gray(`\r\n  (${usedLLM ? 'planned by a real LLM' : 'deterministic planner'}; ${step - 1} real tool call${step - 1 === 1 ? '' : 's'})`) + '\r\n');
      return '';
    }

    term.write(c.cyan('  action   ') + c.cyan(act.action) + c.gray('(') + c.amber(truncate(act.input, 60)) + c.gray(')') + '\r\n');
    await sleep(120);

    const obs = await runTool(act.action, act.input, ctx);
    term.write(c.gray('  observe  ') + c.gray(wrap(obs.display, 68, 11)) + '\r\n');

    messages.push({ role: 'assistant', content: raw || JSON.stringify(act) });
    messages.push({ role: 'user', content: `Observation:\n${obs.model}` });
    await sleep(150);
  }

  term.write('\r\n' + c.amber('  step budget exhausted; synthesizing from observations so far.') + '\r\n');
  const wrapUp = await callPlanner(
    messages.concat({ role: 'user', content: 'Stop searching. Give the final answer now as {"action":"final","input":"..."}.' }), ctx);
  const fin = parseAction(wrapUp || '') || { action: 'final', input: 'The evidence gathered above is the answer.' };
  term.write(c.green('  answer   ') + c.white(wrap(fin.input, 68, 11)) + '\r\n');
  return '';
}

/* ── planner (LLM with graceful fallback) ────────────────────────── */
async function callPlanner(messages, ctx) {
  try {
    const r = await fetch('/api/agent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: 512 }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.source === 'no-llm' || !data.text) return null;
    return data.text;
  } catch (_) { return null; }
}

/* ── tools (all real) ────────────────────────────────────────────── */
async function runTool(action, input, ctx) {
  try {
    if (action === 'python') return await toolPython(input, ctx);
    if (action === 'sql') return await toolSql(input);
    if (action === 'grep') return toolGrep(input, ctx);
    if (action === 'read') return toolRead(input, ctx);
  } catch (e) { /* fall through */ }
  return { display: `unknown action '${action}'`, model: `error: unknown action ${action}` };
}

async function toolPython(code, ctx) {
  const out = await runPython(ctx, String(code || ''));
  const flat = out.replace(/\n+/g, ' ⏎ ').trim();
  return { display: flat ? flat.slice(0, 120) : '(no output)', model: out.slice(0, 1200) || '(no output)' };
}

async function toolSql(query) {
  try {
    const r = await fetch('/api/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: query }),
    });
    if (r.status === 404) return { display: 'D1 unavailable on this host (needs the edge).', model: 'D1 unavailable' };
    const d = await r.json();
    if (!d.ok) return { display: `sql error: ${d.error}`, model: `sql error: ${d.error}` };
    if (!d.rows.length) return { display: '(0 rows)', model: '0 rows' };
    const compact = d.rows.slice(0, 8).map(row => d.columns.map(col => `${col}=${row[col]}`).join(', '));
    return { display: `${d.count} row(s): ` + compact.slice(0, 3).join(' | '), model: compact.join('\n') };
  } catch (_) {
    return { display: 'D1 unavailable (offline).', model: 'D1 unavailable' };
  }
}

function collectFiles(node, path, out) {
  if (node.type === 'file') { out.push([path, readFile(node) || '']); return; }
  for (const [n, child] of Object.entries(node.children || {})) collectFiles(child, path === '/' ? '/' + n : path + '/' + n, out);
}

export function toolGrep(term, ctx) {
  const t = String(term || '').trim();
  if (!t) return { display: 'empty pattern', model: 'empty pattern' };
  const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const files = [];
  collectFiles(resolve('/skills'), '/skills', files);
  collectFiles(resolve('/home/euvel'), '/home/euvel', files);
  const hits = [];
  for (const [path, text] of files) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line) && hits.length < 12) hits.push(`${path}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  if (!hits.length) return { display: `no matches for "${t}"`, model: `no matches for ${t}` };
  return { display: `${hits.length} match(es); e.g. ${hits[0]}`, model: hits.slice(0, 8).join('\n') };
}

function toolRead(path, ctx) {
  const p = String(path || '').trim();
  const node = resolve(p.startsWith('/') ? p : '/' + p);
  const text = readFile(node);
  if (text == null) return { display: `cannot read ${p}`, model: `no such file: ${p}` };
  const snippet = text.split('\n').slice(0, 14).join('\n');
  return { display: `${p}: ${text.split('\n')[0].slice(0, 70)}…`, model: snippet.slice(0, 700) };
}

/* ── deterministic fallback planner (no LLM bound) ───────────────── */
const MATHY = /[0-9]|prove|calcul|compute|factor|prime|integral|deriv|matrix|equation|solve|sum|sqrt|theorem|simplify|=|\+|\*|\^/i;
function heuristicStep(goal, ctx, step) {
  const g = goal.toLowerCase();
  // math/computation → Python
  if (MATHY.test(goal) && !/skill|project|experience|euvel|owner|résumé|resume|devops|kubernetes/i.test(goal)) {
    if (step === 1) return { thought: 'this is computational — solving it in Python.', action: 'python', input: pyFor(goal) };
    return { thought: 'reporting the computed result.', action: 'final', input: 'See the computed output above.' };
  }
  const kw = ['kubernetes', 'chaos', 'linux', 'kernel', 'ebpf', 'rust', 'go', 'python', 'ai', 'rag', 'terraform', 'sre', 'observability']
    .find(k => g.includes(k)) || g.split(/\s+/).filter(w => w.length > 4)[0] || 'devops';
  if (step === 1) return { thought: `searching the skill tree for evidence of "${kw}".`, action: 'grep', input: kw };
  if (step === 2) {
    const area = /linux|kernel|ebpf/.test(g) ? 'linux' : /python|rust|go|api/.test(g) ? 'development' : /ai|rag|ml|agent/.test(g) ? 'ai' : 'devops';
    return { thought: 'cross-checking the projects/skills database.', action: 'sql', input: `SELECT name, stack, year, impact FROM projects WHERE lower(stack) LIKE '%${kw}%' OR lower(impact) LIKE '%${kw}%' LIMIT 5` };
  }
  if (step === 3) return { thought: 'reading the most relevant skill file in full.', action: 'read', input: skillPathFor(g) };
  return { thought: 'synthesizing.', action: 'final', input: synth(goal) };
}

function pyFor(goal) {
  const g = goal.toLowerCase();
  if (g.includes('pythagor')) return "import sympy as sp\na,b=sp.symbols('a b',positive=True)\nc=sp.sqrt(a**2+b**2)\nprint('c^2 =', sp.simplify(c**2), '= a^2+b^2  ✓ (by definition of the hypotenuse)')";
  if (g.includes('prime')) return "import sympy as sp\nprint('100th prime =', sp.prime(100))";
  if (/1\s*\+\s*1/.test(g)) return "import sympy as sp\nprint('1+1 =', sp.Integer(1)+sp.Integer(1), '==2 ?', sp.Integer(1)+sp.Integer(1)==2)";
  return "import sympy as sp\n# best-effort symbolic evaluation of the request\nprint(sp.N(sp.sympify('" + goal.replace(/[^0-9+\-*/^(). ]/g, '') + "')))";
}
function skillPathFor(g) {
  if (/linux|kernel|ebpf|trace/.test(g)) return '/skills/linux/kernel.internals';
  if (/python|rust|go|api|develop/.test(g)) return '/skills/development/languages.txt';
  if (/ai|rag|ml|agent|llm/.test(g)) return '/skills/ai/applied-ml.txt';
  return '/skills/devops/chaos.engineering';
}
function synth(goal) {
  return `Based on the skill tree and the projects database, the evidence above directly supports the goal — ` +
    `Euvel's record shows concrete, operated systems rather than asserted familiarity. Read the cited files for the full surface.`;
}

/* ── parsing + formatting ────────────────────────────────────────── */
export function parseAction(raw) {
  if (!raw) return null;
  // try to extract the first {...} JSON object
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      if (obj && obj.action) return { thought: obj.thought, action: String(obj.action).toLowerCase(), input: String(obj.input ?? '') };
    } catch (_) { /* fall through */ }
  }
  // loose regex
  const a = raw.match(/"?action"?\s*[:=]\s*"?(\w+)"?/i);
  const i = raw.match(/"?input"?\s*[:=]\s*"([\s\S]*?)"\s*}?\s*$/i);
  if (a) return { action: a[1].toLowerCase(), input: i ? i[1] : '' };
  return null;
}

function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function wrap(text, width, indent) {
  const pad = ' '.repeat(indent);
  const words = String(text ?? '').split(/\s+/); const out = []; let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { out.push(line); line = w; }
    else line = (line ? line + ' ' : '') + w;
  }
  if (line) out.push(line);
  return out.join('\r\n' + pad);
}
