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
{"thought":"brief","action":"python|shell|sql|grep|read|final","input":"..."}

TOOLS (use the FEWEST that get the job done):
- python : run real Python 3 (Pyodide). Use for ANY math, logic, proof, calculation,
           algorithm, simulation, or verification. print() the result. You may
           import numpy / sympy (auto-installed). This is your main reasoning tool.
- shell  : run a real command on a REAL in-browser Linux kernel (v86) and read its
           real output. Use for questions about THIS machine: kernel/OS, CPU, memory,
           processes, uptime, the filesystem, or to actually run a coreutil.
           THE BOX: minimal Buildroot (i686, kernel 4.16), BusyBox applets ONLY.
           There is NO package manager (no apt/apk/opkg/pip) and NO bc/perl/gcc —
           nothing can be installed; never try. If a command is 'not found', use a
           BusyBox alternative: awk for float math (awk 'BEGIN{printf "%.10f", atan2(0,-1)}'),
           printf/expr for arithmetic, vi for editing. sh is ash, not bash.
- sql    : ONE read-only SQLite SELECT over the owner's résumé DB.
           projects(name,stack,year,impact,url) · experience(role,org,start_year,end_year,summary) · skills(area,name,level)
- grep   : search the skill tree for a term — only for questions about the owner's skills.
- read   : read a file, e.g. /skills/ai/applied-ml.txt
- final  : your answer to the user.

ROUTING:
- Math / computation / proofs / "calculate X" → python (e.g. import sympy; print(sympy.simplify(...))).
  Exception: if the GOAL says to do it in the shell/bash/terminal, honor it — use shell with BusyBox tools (awk).
- About THIS machine / the Linux box / system state (kernel, cpu, memory, processes, files, uptime) → shell.
- About the owner's skills / projects / experience → sql, then grep/read if useful.
- General knowledge you already know confidently → answer directly with final. Do NOT grep for it.
The kernel's boot state comes ONLY from the shell tool's own report: if it returns "not booted",
tell the user to run 'kernel boot real' and stop retrying shell. If it returns ANY command output
(even an error like 'not found'), the kernel IS booted and running — a missing applet is a missing
applet, never a boot problem; switch to a BusyBox-compatible command or do the math in python.
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
  const trace = [];   // what each real tool call returned (the fallback planner summarizes it)
  for (let step = 1; step <= MAX_STEPS; step++) {
    term.write('\r\n' + c.gray(`── step ${step} `) + c.gray('─'.repeat(40)) + '\r\n');

    let raw = await callPlanner(messages, ctx);
    let act;
    if (raw == null) { usedLLM = false; act = heuristicStep(goal, ctx, step, trace); }
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
    trace.push({ action: act.action, display: obs.display });

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
    if (action === 'shell') return await toolShell(input, ctx);
    if (action === 'sql') return await toolSql(input);
    if (action === 'grep') return toolGrep(input, ctx);
    if (action === 'read') return toolRead(input, ctx);
  } catch (e) { /* fall through */ }
  return { display: `unknown action '${action}'`, model: `error: unknown action ${action}` };
}

// real shell on the real v86 Linux kernel (visible in the pane the user booted)
async function toolShell(cmd, ctx) {
  const lx = ctx.state.linux;
  if (!lx || !lx.ready) {
    return {
      display: 'real kernel not booted — boot it first',
      model: 'The real Linux kernel is not booted. Tell the user to run `kernel boot real` to boot it, then ask again. Do NOT retry shell this turn.',
    };
  }
  const res = await lx.exec(String(cmd || '').trim(), { timeout: 8000 });
  const out = (res.stdout || '').trim();
  if (res.timedout) return { display: `(timed out) ${out.slice(0, 90)}`, model: `command timed out after 8s. partial output:\n${out.slice(0, 800)}` };
  const disp = out ? out.replace(/\n+/g, ' ⏎ ').slice(0, 120) : `(no output; exit ${res.code})`;
  return { display: disp, model: (out || '(no output)').slice(0, 1200) + `\n[exit ${res.code}]` };
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
// Linux concepts → a real BusyBox (ash) demo that SHOWS the idea on the box.
// First match wins, so the specific concepts sit above the generic ones.
const DEMOS = [
  { re: /file.?descriptor|\bfds?\b|redirect/i, what: 'file descriptors',
    cmd: 'ls -l /proc/$$/fd; exec 3>/tmp/fd-demo; echo "--- after exec 3>/tmp/fd-demo, fd 3 is open:"; ls -l /proc/$$/fd; ' +
         'echo "written through fd 3" >&3; exec 3>&-; echo "--- fd 3 closed; the file holds:"; cat /tmp/fd-demo' },
  { re: /\bpipes?\b/i, what: 'pipes',
    cmd: 'echo "--- stdin of a piped process is a pipe:"; sleep 1 | ls -l /proc/self/fd/0; echo "--- data flowing through one:"; ls /proc | head -5 | wc -l' },
  { re: /signal|sigterm|sigkill|\bkill\b/i, what: 'signals',
    cmd: 'sleep 30 & P=$!; echo "sleep is pid $P"; grep State /proc/$P/status; kill -STOP $P; grep State /proc/$P/status; ' +
         'kill -CONT $P; kill -TERM $P; wait $P; echo "exit status after SIGTERM: $? (128+15)"' },
  { re: /namespace/i, what: 'namespaces', cmd: 'ls -l /proc/$$/ns' },
  { re: /inode|hard.?link|symlink|symbolic link/i, what: 'inodes and links',
    cmd: 'echo x > /tmp/a; ln -f /tmp/a /tmp/b; ln -sf /tmp/a /tmp/c; ls -li /tmp/a /tmp/b /tmp/c' },
  { re: /permission|chmod|\bumask\b|\bowner(ship)?\b/i, what: 'permissions',
    cmd: 'id; touch /tmp/p; chmod 640 /tmp/p; ls -l /tmp/p; chmod u+x,o+r /tmp/p; ls -l /tmp/p' },
  { re: /environment|env var|\$path\b/i, what: 'environment variables',
    cmd: 'export DEMO=hello; sh -c \'echo "a child process inherits DEMO=$DEMO"\'; env | head -10' },
  { re: /\bmounts?\b|\bdisk\b|filesystem/i, what: 'mounts', cmd: 'cat /proc/mounts; df -h 2>/dev/null' },
  { re: /memory|\bram\b|\bmem\b/i, what: 'memory', cmd: 'free -m 2>/dev/null || head /proc/meminfo' },
  { re: /\bcpu\b|processor/i, what: 'the CPU', cmd: 'head -20 /proc/cpuinfo' },
  { re: /uptime|\bload\b/i, what: 'uptime and load', cmd: 'uptime; cat /proc/loadavg' },
  { re: /process|\bpids?\b|\bps\b|fork/i, what: 'processes',
    cmd: 'echo "this shell is pid $$ (parent $PPID)"; ps | head -15' },
  { re: /\/proc\b|procfs/i, what: '/proc', cmd: 'ls /proc | head -20; head -8 /proc/$$/status' },
  { re: /kernel version|uname|\bos\b/i, what: 'the kernel', cmd: 'uname -a; cat /proc/version' },
];
const MACHINEY = /\b(box|vm|machine|shell|linux|terminal|kernel|busybox|this (system|computer))\b/i;
const RESUMEY = /\b(euvel|he|his|résumé|resume|cv|skills?|experience|projects?|hire|career)\b/i;
const MATHY = /[0-9]|prove|calcul|compute|factor|prime|integral|deriv|matrix|equation|solve|sum|sqrt|theorem|simplify|=|\+|\*|\^/i;
const KEYWORDS = ['kubernetes', 'chaos', 'linux', 'kernel', 'ebpf', 'rust', 'go', 'python', 'ai', 'rag', 'terraform', 'sre', 'observability'];
const STOP = new Set(('a an the and or of to in on for with about at by from into is are was be can could would will do does did ' +
  'you your me my i it this that these those what which who how why when where please show tell explain demonstrate demo ' +
  'give find list describe example examples some any concept concepts work works working use using run make').split(' '));

export function demoFor(goal) { return DEMOS.find(d => d.re.test(goal)) || null; }

// the term worth searching the skill tree for — never a filler word like "demonstrate"
export function keywordFor(goal) {
  const g = goal.toLowerCase();
  return KEYWORDS.find(k => new RegExp(`\\b${k}\\b`).test(g))
    || g.split(/[^a-z0-9.+#-]+/).find(w => w.length > 3 && !STOP.has(w))
    || null;
}

export function heuristicStep(goal, ctx, step, trace = []) {
  const g = goal.toLowerCase();
  const resumey = RESUMEY.test(goal);
  const demo = resumey ? null : demoFor(goal);

  // about THIS machine → real shell on the booted Linux box
  if (demo || (!resumey && MACHINEY.test(goal))) {
    if (!ctx.state.linux || !ctx.state.linux.ready) {
      return { thought: 'this needs the real Linux box, which is not booted.', action: 'final',
        input: 'That runs on the real Linux box, which is not booted yet. Run `kernel boot real`, wait for the prompt, then ask again.' };
    }
    if (step === 1) {
      return { thought: demo ? `demonstrating ${demo.what} on the real kernel.` : 'querying the real kernel via shell.',
        action: 'shell', input: demo ? demo.cmd : 'uname -a; echo; free -m 2>/dev/null | head' };
    }
    return { thought: 'reporting what the box returned.', action: 'final',
      input: `The output above is what the real kernel returned${demo ? ` — a live demo of ${demo.what}` : ''}.` };
  }
  // math/computation → Python
  if (MATHY.test(goal) && !resumey && !/devops|kubernetes/i.test(goal)) {
    if (step === 1) return { thought: 'this is computational — solving it in Python.', action: 'python', input: pyFor(goal) };
    return { thought: 'reporting the computed result.', action: 'final', input: 'See the computed output above.' };
  }
  // about the owner → search the skill tree, the projects DB, then read a file
  const kw = keywordFor(goal);
  if (!kw) return { thought: 'nothing specific to search for.', action: 'final', input: synth(goal, kw, trace) };
  if (step === 1) return { thought: `searching the skill tree for "${kw}".`, action: 'grep', input: kw };
  if (step === 2) {
    const q = kw.replace(/'/g, "''");
    return { thought: 'cross-checking the projects database.', action: 'sql', input: `SELECT name, stack, year, impact FROM projects WHERE lower(stack) LIKE '%${q}%' OR lower(impact) LIKE '%${q}%' LIMIT 5` };
  }
  if (step === 3) return { thought: 'reading the most relevant skill file in full.', action: 'read', input: skillPathFor(g) };
  return { thought: 'summarizing what the tools found.', action: 'final', input: synth(goal, kw, trace) };
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

// an honest summary of what the tool calls actually returned — no canned verdict
const EMPTY = /^(no matches|\(0 rows\)|cannot read|D1 unavailable|sql error|empty pattern|unknown action)/;
export function synth(goal, kw, trace) {
  const found = trace.filter(t => !EMPTY.test(t.display));
  const lead = 'No language model is reachable right now, so this is the deterministic planner.';
  if (!kw) return `${lead} It could not tell what to look up. Try \`help\`, \`ls /skills\`, or ask again in a moment.`;
  if (!found.length) return `${lead} Nothing in the skill tree or the projects database matched "${kw}". Try \`ls /skills\` or \`sql "select * from projects"\`.`;
  return `${lead} For "${kw}" it found: ` + found.map(t => `${t.action} → ${t.display}`).join('; ') + '.';
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
