/* ===================================================================
   HERMIT-OS — SRE console: REAL self-telemetry + REAL chaos engineering
   `watch slo`   live dashboard timing real /api/ping round-trips
   `chaos inject --latency 300ms | --errors 25% [--ttl 30s]`
   `chaos recover` · `chaos status`
   Everything here measures or perturbs this site's real edge endpoints.
   Nothing is mocked; when the edge isn't reachable it says so honestly.
   =================================================================== */

import { c } from './shell.js';

// SLO definition (the contract we hold ourselves to)
const SLO = { avail: 99.9, p95: 400 };      // % availability, ms p95 latency (edge RTT-realistic)
const WINDOW = 40;                           // rolling samples
const SPARK = '▁▂▃▄▅▆▇█';

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))];
}
function spark(vals, max) {
  if (!vals.length) return '';
  const m = max || Math.max(...vals, 1);
  return vals.map(v => SPARK[Math.min(7, Math.floor((v / m) * 7))]).join('');
}
function bar(frac, w = 10) {
  const n = Math.round(Math.max(0, Math.min(1, frac)) * w);
  return '█'.repeat(n) + '░'.repeat(w - n);
}

async function probe() {
  const t0 = performance.now();
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    const ms = performance.now() - t0;
    if (r.status === 200) return { ok: true, ms };
    if (r.status === 503) return { ok: false, ms, injected: true };  // real injected error
    return { offline: true };                                        // 404 etc → no edge
  } catch (_) {
    return { offline: true };
  }
}

async function getFault() {
  try {
    const r = await fetch('/api/fault', { cache: 'no-store' });
    if (!r.ok) return { offline: r.status === 404 };
    return await r.json();
  } catch (_) { return { offline: true }; }
}

export function sloCommands(send) {
  return {
    watch: {
      desc: 'live dashboards', usage: 'watch slo',
      run(args, ctx, piped) {
        if (args[0] !== 'slo') return send(c.gray('usage: watch slo   — live SRE console of this site\'s real edge telemetry'), ctx, piped);

        const st = { samples: [], inflight: 0, offline: false, fault: null, started: Date.now() };

        const tick = () => {
          // fire a real probe (non-blocking) and a fault read
          st.inflight++;
          probe().then(s => {
            st.inflight--;
            if (s.offline) { st.offline = true; return; }
            st.offline = false;
            st.samples.push(s);
            if (st.samples.length > WINDOW) st.samples.shift();
          });
          getFault().then(f => { st.fault = f && f.fault ? f.fault : null; st.faultOffline = !!f.offline; });
        };

        const render = () => {
          tick();
          return draw(st);
        };

        ctx.shell.runLive({
          render, intervalMs: 1200,
          onExitMsg: c.gray('SRE console detached. the baseline persists.'),
        });
        return '';
      },
    },

    chaos: {
      desc: 'REAL chaos engineering against this site', usage: 'chaos inject --latency 300ms|--errors 25% · chaos node [COLO] · chaos recover · chaos status',
      async run(args, ctx, piped) {
        const sub = args[0] || 'status';

        // the dynamical-systems view of chaos: Lorenz attractor + Lyapunov exponent
        if (sub === 'lyapunov' || sub === 'attractor' || sub === 'dynamics') {
          const { lorenzCommands } = await import('./lorenz.js');
          return lorenzCommands(send).lyapunov.run([], ctx, piped);
        }

        // chaos against the in-browser orchestrator: kill a node, watch it self-heal
        if (sub === 'node' || sub === 'kill') {
          const cl = ctx.state.k8s;
          if (!cl || !cl.pods.length) return send(c.gray('no cluster yet. start one: ') + c.cyan('helm install demo webapp') + c.gray(', then ') + c.cyan('chaos node ' + (cl ? cl.nodes[0].colo : 'AMS')), ctx, piped);
          const target = args[1] || cl.nodes.find(n => n.status === 'Ready' && cl.usage(n).pods > 0)?.colo || cl.nodes[0].colo;
          const r = cl.killNode(target);
          if (!r) return send(c.red(`node "${target}" not found. nodes: ${cl.nodes.map(n => n.colo).join(', ')}`), ctx, piped);
          ctx.bus.emit('chaos:fail', { kind: 'node' });
          ctx.bus.emit('orbifold:stress', { v: 0.6 });
          setTimeout(() => { cl.reviveNode(r.node); ctx.bus.emit('orbifold:stress', { v: 0 }); }, 14000);
          ctx.shell.out(c.red(`◉ node ${r.node} killed`) + c.gray(`  — evicted ${r.evicted} real pod(s). reconciler is rescheduling…`));
          ctx.shell.out(c.gray('opening the live view — pods will go Pending → ContainerCreating → Running on healthy nodes. press ') + c.cyan('q') + c.gray(' to exit; node revives in ~14s.'));
          // auto-launch the watch so the reschedule is impossible to miss
          if (!piped || !piped.piped) setTimeout(() => { if (!ctx.shell.liveMode) ctx.shell.run('kubectl get pods -w'); }, 700);
          return '';
        }

        if (sub === 'status') {
          const f = await getFault();
          if (f.offline) return send(offlineMsg(), ctx, piped);
          if (!f.fault) return send(c.green('● steady state') + c.gray('  — no active fault. the real endpoints are healthy. inject one: ') + c.cyan('chaos inject --latency 300ms'), ctx, piped);
          const left = Math.max(0, Math.round((f.fault.until - Date.now()) / 1000));
          return send(c.red('◉ chaos active') + c.gray(`  kind=${f.fault.kind} latency=${f.fault.latency}ms errorRate=${(f.fault.errorRate*100).toFixed(0)}% · self-heals in ${left}s`), ctx, piped);
        }

        if (sub === 'recover' || sub === 'revert' || sub === 'heal') {
          const r = await postFault({ clear: true });
          if (r.offline) return send(offlineMsg(), ctx, piped);
          ctx.bus.emit('orbifold:stress', { v: 0 });
          return send(c.green('recovered. fault cleared; real endpoints back to baseline.'), ctx, piped);
        }

        if (sub === 'inject' || sub === 'apply') {
          const latency = parseUnit(argVal(args, '--latency'), 'ms');
          const errors = parseUnit(argVal(args, '--errors'), '%');
          const ttl = parseUnit(argVal(args, '--ttl'), 's') || 30;
          // `chaos apply --blast-radius X` is honored too, as a real latency fault
          const blast = argVal(args, '--blast-radius');
          let lat = latency, err = errors;
          if (blast && !latency && !errors) { lat = blast === 'zone' ? 600 : blast === 'node' ? 350 : 180; }
          if (!lat && !err) return send(c.gray('usage: chaos inject --latency 300ms | --errors 25% [--ttl 30s]'), ctx, piped);

          const r = await postFault({ latency: lat || 0, errorRate: err ? err / 100 : 0, ttl, kind: blast ? ('blast:' + blast) : (err ? 'errors' : 'latency') });
          if (r.offline) return send(offlineMsg(), ctx, piped);
          if (!r.ok) return send(c.red('chaos: ' + (r.error || 'injection failed')), ctx, piped);

          // honest visualization: drive the orbifold from the real fault magnitude
          const sev = Math.min(1, ((lat || 0) / 800) + (err ? err / 100 : 0));
          ctx.bus.emit('orbifold:stress', { v: sev });
          ctx.bus.emit('chaos:fail', { kind: 'real' });

          return send([
            c.amber('⚡ fault injected into the REAL edge') + c.gray(`  (auto-heals in ${ttl}s)`),
            `  latency  ${c.cyan((lat || 0) + 'ms')}   errorRate ${c.cyan(((err || 0)) + '%')}   ttl ${c.cyan(ttl + 's')}`,
            c.gray('  it now affects real /api/ping and /api/aiwass round-trips.'),
            c.green('  open the SRE console to watch real impact: ') + c.cyan('watch slo'),
          ].join('\n'), ctx, piped);
        }

        return send(c.gray('chaos inject --latency 300ms | chaos recover | chaos status   ·   watch slo'), ctx, piped);
      },
    },
  };
}

function draw(st) {
  const oks = st.samples.filter(s => s.ok);
  const lat = oks.map(s => s.ms);
  const total = st.samples.length;
  const errors = total - oks.length;
  const avail = total ? (oks.length / total) * 100 : 100;
  const p50 = Math.round(pct(lat, 50));
  const p95 = Math.round(pct(lat, 95));
  const errRate = total ? errors / total : 0;
  const budgetConsumed = errRate / (1 - SLO.avail / 100);     // 1.0 = budget spent at this rate
  const burn = budgetConsumed;
  const f = st.fault;
  // DEGRADED = an availability/budget breach or an active fault — not a single
  // slow probe. A naturally-high p95 is shown as an indicator, not an alarm.
  const degraded = !!f || avail < SLO.avail || burn >= 1;

  const head = [
    c.amber('hermit') + c.gray(' · SRE console') + c.gray('  — live SLO from real edge telemetry') + c.gray('        [q]uit'),
    c.gray('────────────────────────────────────────────────────────────────────'),
  ];

  if (st.offline && total === 0) {
    return head.concat([
      '',
      c.red('  ◍ edge telemetry offline') + c.gray('  — /api/ping is not responding.'),
      c.gray('    Real telemetry needs the Pages Functions running:'),
      c.gray('      • deployed on Cloudflare, or'),
      c.gray('      • locally via  ') + c.cyan('npx wrangler pages dev public --kv HERMIT_KV'),
      '',
      c.gray('    (a plain static server has no edge, so there is nothing real to measure —'),
      c.gray('     and hermit will not fake it.)'),
      '',
      c.gray('────────────────────────────────────────────────────────────────────'),
    ]).join('\n');
  }

  const stateLine = degraded
    ? c.red('  ◉ DEGRADED') + (f ? c.gray(`   chaos active: ${f.kind} · ${f.latency}ms · ${(f.errorRate*100).toFixed(0)}% err · heals in ${Math.max(0,Math.round((f.until-Date.now())/1000))}s`) : c.gray('   (error budget burning)'))
    : c.green('  ● STEADY') + c.gray('   availability within SLO · ') + c.cyan('chaos inject') + c.gray(' to perturb it');

  const availCol = avail >= SLO.avail ? c.green : c.red;
  const p95Col = p95 <= SLO.p95 ? c.green : c.red;
  const burnCol = burn <= 1 ? c.green : burn <= 5 ? c.amber : c.red;

  return head.concat([
    c.gray('  endpoint   ') + c.cyan('/api/ping') + c.gray('   window ' + total + '/' + WINDOW + ' probes · 1.2s interval · ' + st.inflight + ' in flight'),
    stateLine,
    '',
    c.gray('  Availability  ') + availCol((avail).toFixed(2) + '%') + c.gray('   SLO ' + SLO.avail + '%   budget ') + burnCol(bar(1 - Math.min(1, budgetConsumed))) + c.gray('   burn ') + burnCol(burn.toFixed(1) + '×'),
    c.gray('  Latency  p50  ') + c.cyan(String(p50).padStart(4) + 'ms') + c.gray('   p95 ') + p95Col(String(p95).padStart(4) + 'ms') + c.gray('   SLO p95<' + SLO.p95 + 'ms  ') + (p95 <= SLO.p95 ? c.green('✓') : c.red('✗')),
    c.gray('  Errors        ') + (errors ? c.red((errRate*100).toFixed(1) + '%') : c.green('0.0%')) + c.gray('   (' + errors + '/' + total + ')'),
    '',
    c.gray('  latency  ') + c.cyan(spark(lat.slice(-32), Math.max(SLO.p95, ...lat))) + c.gray('  (real ms, last ' + Math.min(32, lat.length) + ')'),
    '',
    c.gray('  inject:  ') + c.cyan('chaos inject --latency 300ms') + c.gray('   ·   ') + c.cyan('chaos inject --errors 25%'),
    c.gray('  recover: ') + c.cyan('chaos recover') + c.gray('     (faults also self-heal ≤60s)'),
    c.gray('────────────────────────────────────────────────────────────────────'),
    c.gray('  measured live from real /api/ping round-trips — no synthetic data.'),
  ]).join('\n');
}

async function postFault(body) {
  try {
    const r = await fetch('/api/fault', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 404) return { offline: true };
    return await r.json();
  } catch (_) { return { offline: true }; }
}

function offlineMsg() {
  return c.red('chaos: edge offline.') + c.gray(' Real fault injection needs the Pages Functions + KV. Run ') +
    c.cyan('npx wrangler pages dev public --kv HERMIT_KV') + c.gray(' or use the deployed site. it will not fake it.');
}

function argVal(args, flag) {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  // also support --flag=value
  const eq = args.find(a => a.startsWith(flag + '='));
  return eq ? eq.split('=')[1] : null;
}
function parseUnit(v, unit) {
  if (!v) return 0;
  return parseFloat(String(v).replace(unit, '').replace('ms', '').replace('%', '').replace('s', '')) || 0;
}
