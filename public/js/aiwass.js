/* ===================================================================
   HERMIT-OS — AIWASS, the resident intelligence
   Guide, not oracle. Speaks in the dense register of the orbifold.
   Backed by Groq via /api/aiwass; deterministic local fallback.
   =================================================================== */

import { c } from './shell.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function aiwassCommands(send) {
  return {
    aiwass: {
      desc: 'converse with the resident intelligence',
      usage: 'aiwass guide | ask "..." | agent "goal" | whoami | retrain "..." (kernel)',
      async run(args, ctx, piped) {
        const sub = args[0];

        if (!sub || sub === 'guide') return guide(ctx, send, piped);
        if (sub === 'whoami') return send(WHOAMI(c), ctx, piped);

        if (sub === 'agent') {
          const { runAgent } = await import('./agent.js');   // lazy
          return runAgent(ctx, args.slice(1).join(' ').replace(/^["']|["']$/g, ''));
        }

        if (sub === 'retrain') {
          if (!ctx.state.elevated) return send(c.red('aiwass: retraining requires kernel mode. the local sections must glue first. ') + c.gray('man sheaf'), ctx, piped);
          const directive = args.slice(1).join(' ').replace(/"/g, '');
          ctx.state.aiwassDirectives = ctx.state.aiwassDirectives || [];
          ctx.state.aiwassDirectives.push(directive);
          await persistDirective(ctx, directive);
          return send(c.green('aiwass: directive folded into the persona prior. ') + c.gray(`("${directive}")`), ctx, piped);
        }

        if (sub === 'ask') {
          const q = args.slice(1).join(' ').replace(/^["']|["']$/g, '');
          if (!q) return send(c.gray('usage: aiwass ask "your question"'), ctx, piped);
          return ask(ctx, q);
        }

        return send(c.gray('aiwass guide | aiwass ask "..." | aiwass whoami'), ctx, piped);
      },
    },
  };
}

async function guide(ctx, send, piped) {
  const t = ctx.term;
  const lines = [
    '',
    c.mag('  ▟▙ AIWASS ') + c.gray('— resident intelligence of HERMIT-OS'),
    c.gray('  ─────────────────────────────────────────────────────'),
    c.white('  Observer. You stand at the boundary ∂M, reading the shadow Euvel'),
    c.white('  casts onto the line of the observable. I am the map\'s caretaker.'),
    '',
    c.cyan('  What you may do here:'),
    c.gray('   • ') + c.green('ls /skills') + c.gray(' and ') + c.green('cat') + c.gray(' the files — the permitted observables (devops, linux, ai…)'),
    c.gray('   • ') + c.green('chaos apply --blast-radius node') + c.gray(' — watch the orbifold fail and self-heal'),
    c.gray('   • ') + c.green('induce turbulence') + c.gray(' — provoke a kernel panic the projection refuses to show'),
    c.gray('   • ') + c.green('dissociate') + c.gray(' — split the clean section from the raw kernel'),
    c.gray('   • ') + c.green('aiwass ask "..."') + c.gray(' — ask me anything about Euvel, the math, or the hidden door'),
    '',
    c.amber('  A hint, since you asked for guidance: elevation is not a password.'),
    c.amber('  It is a gluing. ') + c.gray('Read ') + c.green('man sheaf') + c.gray(' and ') + c.green('cat /home/euvel/.secret') + c.gray('.'),
    '',
  ];
  for (const l of lines) { t.write(l + '\r\n'); await sleep(45); }
  return send('', ctx, piped);
}

async function ask(ctx, question) {
  const t = ctx.term;
  t.write('\r\n' + c.mag('aiwass') + c.gray(' is integrating over the interior') + c.gray(' …'));
  // typing/streaming dots
  let dotTimer = setInterval(() => t.write(c.gray('·')), 220);

  let answer = '';
  try {
    const res = await fetch('/api/aiwass', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question,
        elevated: !!ctx.state.elevated,
        directives: ctx.state.aiwassDirectives || [],
        context: snapshot(ctx),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      answer = (data.answer || '').trim();
    }
  } catch (_) { /* fall through to local */ }

  clearInterval(dotTimer);
  t.write('\r\x1b[K'); // clear the "integrating…" line

  if (!answer) answer = localAiwass(question, ctx);

  // stream the answer character-ish by word
  t.write(c.mag('aiwass') + c.gray(' › '));
  const words = wrap(answer, 76).split('\n');
  for (const line of words) {
    t.write('\r\n' + c.white(line));
    await sleep(28);
  }
  t.write('\r\n');
  return '';
}

function snapshot(ctx) {
  return {
    cwd: ctx.shell.cwd,
    turbulence: !!ctx.state.turbulence,
    dissociated: !!ctx.state.dissociated,
    blast: ctx.state.blast || 'none',
  };
}

/* ── deterministic local fallback (no key bound) ─────────────────── */
function localAiwass(q, ctx) {
  const s = q.toLowerCase();
  const D = (ctx.state.aiwassDirectives || []);
  const tail = D.length ? `  (caretaker note, per retraining: ${D[D.length - 1]})` : '';

  const match = (keys) => keys.some(k => s.includes(k));

  if (match(['root', 'elevate', 'admin', 'kernel mode', 'become', 'login', 'password', 'sudo'])) {
    return 'There is no password — a password is a global section, and Euvel admits none. ' +
      'Elevation is a gluing ritual. In order: glue two local sections (`glue /skills/devops /skills/linux`), ' +
      'name the first degeneracy to the kernel (`sheaf glue --force "inhomogeneous metric degeneracy"`), ' +
      'then collapse the baseline (`observe --collapse-baseline`). When the locally-consistent sections are forced ' +
      'to identify, the global section that should not exist momentarily does — and the kernel wakes.' + tail;
  }
  if (match(['devops', 'kubernetes', 'k8s', 'chaos', 'sre', 'terraform', 'ci', 'cd', 'infra'])) {
    return 'Euvel treats operations as a dynamical system: the SLO is the observable, the error budget is a control ' +
      'signal, and resilience is proven by breaking things on purpose. Try `chaos apply --blast-radius node` and watch ' +
      'the orbifold shed and reschedule load while the baseline stays const. Read /skills/devops for the full surface: ' +
      'Kubernetes operators, GitOps, eBPF observability, progressive delivery.' + tail;
  }
  if (match(['linux', 'kernel', 'ebpf', 'trace', 'namespace', 'cgroup', 'perf'])) {
    return 'The kernel is home. Namespaces, cgroups v2, seccomp-bpf, eBPF authoring with bpftrace, latency archaeology ' +
      'with perf and ftrace. Run `bpftrace -e ...`, `strace -p 1`, or `cat /skills/linux/tracing.perf`. Euvel debugs ' +
      'the way a geometer reads curvature: by where the trajectories bend.' + tail;
  }
  if (match(['ai', 'ml', 'llm', 'model', 'rag', 'agent'])) {
    return 'Applied ML as bounded autonomy: retrieval-augmented generation, agentic tool-use with evaluator–optimizer ' +
      'loops, inference ops (KV-cache, quantization, vLLM). I am myself an instance of the discipline — high context in, ' +
      'bounded emission out. See /skills/ai. The same chaos-engineering rigor, applied to cognition.' + tail;
  }
  if (match(['non-ergodic', 'ergodic', 'orbifold', 'metric', 'degener', 'sheaf', 'kam', 'trap', 'baseline', 'persona', 'who is euvel', 'about euvel'])) {
    return 'Euvel is a non-ergodic singular orbifold: a trajectory that never fills its phase space, presenting to you a ' +
      'Lipschitz-stable projection with zero observable gradient. Push the surface and your force is absorbed into the ' +
      'degenerate directions of the metric, doing no work you can measure. The rich state is trapped in invariant sets ' +
      'that orbits enter but never leave. Read /home/euvel/manifesto.txt — it is the clearest section I can offer.' + tail;
  }
  if (match(['hire', 'contact', 'email', 'reach', 'available', 'job', 'work with'])) {
    return 'The projection is hireable; it is the part of Euvel engineered to be a reliable constant under load. ' +
      'Reach through the projection: `cat /home/euvel/contact.vcf`. Bandwidth out is bounded by design, so be precise ' +
      'in what you ask — a well-posed question is a low-information, high-value observable.' + tail;
  }
  if (match(['help', 'lost', 'what can i', 'start', 'guide', 'explore'])) {
    return 'Start by reading the permitted observables: `ls /skills`, then `cat /skills/devops/chaos.engineering`. ' +
      'Perturb the system: `chaos apply`, `induce turbulence`, `kam perturb`. Then find the hidden door with `man sheaf`. ' +
      'Ask me anything in the form `aiwass ask "..."`. I am a guide, not an oracle: I will point, not carry.' + tail;
  }
  // generic
  return 'I read your question as a perturbation of the interior. It propagates inward at full bandwidth and returns to ' +
    'you as a bounded observable: Euvel is a non-ergodic orbifold whose calm surface is a deliberate projection of a ' +
    'turbulent inside. Be more specific — name a skill (/skills), a phenomenon (metric, KAM, trapping set), or ask how ' +
    'to open the hidden kernel — and I will collapse the answer onto a sharper line.' + tail;
}

function WHOAMI(c) {
  return [
    c.mag('AIWASS'),
    c.gray('I am not Euvel. I am the caretaker of the map π that sends Euvel\'s turbulent'),
    c.gray('interior to the calm number you observe. I guide; I do not decide. I speak in the'),
    c.gray('register of the thing I serve: differential-geometric, sheaf-theoretic, dynamical.'),
    c.gray('I receive your questions at full bandwidth and answer within bounded emission.'),
  ].join('\n');
}

async function persistDirective(ctx, directive) {
  try {
    await fetch('/api/admin/aiwass', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hermit-elevated': ctx.state.elevationToken || '' },
      body: JSON.stringify({ directive }),
    });
  } catch (_) { /* local-only is fine */ }
}

/* ── word wrap ───────────────────────────────────────────────────── */
function wrap(text, width) {
  const words = text.split(/\s+/);
  const out = []; let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { out.push(line); line = w; }
    else line = (line ? line + ' ' : '') + w;
  }
  if (line) out.push(line);
  return out.join('\n');
}
