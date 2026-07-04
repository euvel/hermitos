/* ===================================================================
   hermit — SRE console: REAL self-telemetry + REAL chaos engineering,
   fused with a dynamical-systems view of failure.

   `watch slo`   live dashboard timing real /api/ping round-trips AND
                 running system-identification on the measured series:
                 recovery rate (from lag-1 autocorrelation), Hurst (DFA),
                 and a critical-slowing-down early-warning that fires
                 BEFORE the SLO breaches. (Exact λ₁ lives in `lyapunov`.)
   `chaos inject --model lorenz --rho 28`   structured chaotic latency
   `chaos inject --ramp`                     walk toward a tipping point
   `chaos inject --latency 300ms | --errors 25%`   flat global fault (KV)
   `chaos node [COLO]` · `chaos recover` · `chaos status`

   Everything measures or perturbs this site's real edge. The Lorenz /
   AR(1) injectors drive a latency the edge really sleeps for; the
   estimators run on latencies really measured. Nothing is mocked.
   =================================================================== */

import { c } from './shell.js';
import { makeLorenzInjector, makeRampInjector, analyze, RHO_CRIT } from './dynamics.js';

// SLO definition (the contract we hold ourselves to)
const SLO = { avail: 99.9, p95: 400 };      // % availability, ms p95 latency (edge RTT-realistic)
const WINDOW = 40;                           // rolling display samples
const RING = 128;                            // analysis series (for the estimators)
const INTERVAL = 1000;                       // ms between probes → fs = 1/s
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

async function probe(injectMs) {
  const t0 = performance.now();
  const url = injectMs > 0 ? `/api/ping?inject=${Math.round(injectMs)}` : '/api/ping';
  try {
    const r = await fetch(url, { cache: 'no-store' });
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

        const st = { samples: [], series: [], inflight: 0, offline: false, fault: null, chaos: null, dyn: null, started: Date.now() };

        const tick = () => {
          // drive the client-side dynamical injector, if one is active
          let injectMs = 0; const ch = ctx.state.chaos;
          if (ch && Date.now() < ch.until) { injectMs = ch.next(); st.chaos = ch; }
          else { if (ch) ctx.state.chaos = null; st.chaos = null; }

          st.inflight++;
          probe(injectMs).then(s => {
            st.inflight--;
            if (s.offline) { st.offline = true; return; }
            st.offline = false;
            st.samples.push(s);
            if (st.samples.length > WINDOW) st.samples.shift();
            if (s.ok) { st.series.push(s.ms); if (st.series.length > RING) st.series.shift(); }
          });
          getFault().then(f => { st.fault = f && f.fault ? f.fault : null; st.faultOffline = !!f.offline; });
        };

        const render = () => {
          tick();
          // run system-identification on the measured latency series
          st.dyn = st.series.length >= 16 ? analyze(st.series, 1000 / INTERVAL) : null;
          return draw(st);
        };

        ctx.shell.runLive({
          render, intervalMs: INTERVAL,
          onExitMsg: c.gray('SRE console detached. the baseline persists.'),
        });
        return '';
      },
    },

    chaos: {
      desc: 'REAL chaos engineering against this site',
      usage: 'chaos inject --model lorenz --rho 28 | --ramp | --latency 300ms | --errors 25% · chaos node [COLO] · chaos recover · chaos status',
      async run(args, ctx, piped) {
        const sub = args[0] || 'status';

        // the dynamical-systems lab: Lorenz attractor + Lyapunov exponent
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
          if (!piped || !piped.piped) setTimeout(() => { if (!ctx.shell.liveMode) ctx.shell.run('kubectl get pods -w'); }, 700);
          return '';
        }

        if (sub === 'status') {
          const ch = ctx.state.chaos;
          if (ch && Date.now() < ch.until) {
            const left = Math.max(0, Math.round((ch.until - Date.now()) / 1000));
            const i = ch.info();
            return send(c.red('◉ dynamical fault active') + c.gray(`  ${i.label} · ${i.param} · client-driven structured latency · ${left}s left · `) + c.cyan('watch slo'), ctx, piped);
          }
          const f = await getFault();
          if (f.offline) return send(offlineMsg(), ctx, piped);
          if (!f.fault) return send(c.green('● steady state') + c.gray('  — no active fault. the real endpoints are healthy. inject one: ') + c.cyan('chaos inject --model lorenz --rho 28'), ctx, piped);
          const left = Math.max(0, Math.round((f.fault.until - Date.now()) / 1000));
          return send(c.red('◉ chaos active') + c.gray(`  kind=${f.fault.kind} latency=${f.fault.latency}ms errorRate=${(f.fault.errorRate*100).toFixed(0)}% · self-heals in ${left}s`), ctx, piped);
        }

        if (sub === 'recover' || sub === 'revert' || sub === 'heal') {
          ctx.state.chaos = null;                       // stop the client-side injector
          const r = await postFault({ clear: true });
          ctx.bus.emit('orbifold:stress', { v: 0 });
          if (r.offline) return send(c.green('dynamical fault cleared.') + c.gray(' (no global KV fault to clear — edge offline.)'), ctx, piped);
          return send(c.green('recovered. all faults cleared; real endpoints back to baseline.'), ctx, piped);
        }

        // ── dynamical injectors (client-driven, imposed at the edge) ──
        const wantRamp = sub === 'ramp' || args.includes('--ramp');
        const model = argVal(args, '--model');
        if (wantRamp || model === 'lorenz') {
          const ttl = parseUnit(argVal(args, '--ttl'), 's') || (wantRamp ? 100 : 60);
          let inj, headline, note;
          if (wantRamp) {
            inj = makeRampInjector({ ttl });
            headline = c.amber('⤴ ramp toward criticality armed') + c.gray(`  (AR(1), recovery rate → 0 over ${ttl}s)`);
            note = c.gray('  watch the console: autocorrelation & variance will rise — the ') + c.cyan('early-warning fires before the SLO breach') + c.gray('.');
          } else {
            const rho = parseFloat(argVal(args, '--rho')) || 28;
            inj = makeLorenzInjector({ rho, ttl });
            const chaotic = rho > RHO_CRIT;
            headline = c.amber('⚡ structured chaos armed') + c.gray(`  lorenz ρ=${rho} · ${chaotic ? c.red('past the bifurcation (λ>0)') : c.green('below ρ_c≈24.74 (λ≤0)')}${c.gray('')} · ${ttl}s`);
            note = c.gray('  injected latency traces a real Lorenz trajectory; the console reads its ') + c.cyan('autocorrelation & burstiness (Hurst)') + c.gray(' live. exact λ₁: ') + c.cyan('lyapunov') + c.gray('.');
          }
          ctx.state.chaos = inj;
          ctx.bus.emit('orbifold:stress', { v: wantRamp ? 0.3 : 0.5 });
          ctx.bus.emit('chaos:fail', { kind: 'dynamical' });
          ctx.shell.out(headline);
          ctx.shell.out(note);
          ctx.shell.out(c.green('  opening the SRE console…') + c.gray('  press ') + c.cyan('q') + c.gray(' to detach.'));
          if (!piped || !piped.piped) setTimeout(() => { if (!ctx.shell.liveMode) ctx.shell.run('watch slo'); }, 700);
          return '';
        }

        if (sub === 'inject' || sub === 'apply') {
          // flat, GLOBAL fault via KV (affects every visitor's real endpoints)
          const latency = parseUnit(argVal(args, '--latency'), 'ms');
          const errors = parseUnit(argVal(args, '--errors'), '%');
          const ttl = parseUnit(argVal(args, '--ttl'), 's') || 30;
          const blast = argVal(args, '--blast-radius');
          let lat = latency, err = errors;
          if (blast && !latency && !errors) { lat = blast === 'zone' ? 600 : blast === 'node' ? 350 : 180; }
          if (!lat && !err) return send([
            c.gray('usage:'),
            c.gray('  ') + c.cyan('chaos inject --model lorenz --rho 28') + c.gray('   structured chaotic latency (client-driven)'),
            c.gray('  ') + c.cyan('chaos inject --ramp') + c.gray('                    walk toward a tipping point (early-warning demo)'),
            c.gray('  ') + c.cyan('chaos inject --latency 300ms | --errors 25%') + c.gray('   flat GLOBAL fault (KV, affects everyone)'),
          ].join('\n'), ctx, piped);

          const r = await postFault({ latency: lat || 0, errorRate: err ? err / 100 : 0, ttl, kind: blast ? ('blast:' + blast) : (err ? 'errors' : 'latency') });
          if (r.offline) return send(offlineMsg(), ctx, piped);
          if (!r.ok) return send(c.red('chaos: ' + (r.error || 'injection failed')), ctx, piped);

          const sev = Math.min(1, ((lat || 0) / 800) + (err ? err / 100 : 0));
          ctx.bus.emit('orbifold:stress', { v: sev });
          ctx.bus.emit('chaos:fail', { kind: 'real' });

          return send([
            c.amber('⚡ flat fault injected into the REAL edge') + c.gray(`  (global, auto-heals in ${ttl}s)`),
            `  latency  ${c.cyan((lat || 0) + 'ms')}   errorRate ${c.cyan(((err || 0)) + '%')}   ttl ${c.cyan(ttl + 's')}`,
            c.gray('  affects real /api/ping and /api/aiwass for every visitor.'),
            c.green('  watch real impact: ') + c.cyan('watch slo') + c.gray('   ·   structured instead: ') + c.cyan('chaos inject --model lorenz --rho 28'),
          ].join('\n'), ctx, piped);
        }

        return send(c.gray('chaos inject --model lorenz --rho 28 | --ramp | --latency 300ms · chaos recover · chaos status   ·   watch slo'), ctx, piped);
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
  const budgetConsumed = errRate / (1 - SLO.avail / 100);
  const burn = budgetConsumed;
  const f = st.fault;
  const ch = st.chaos;
  const d = st.dyn;
  const degraded = !!f || !!ch || avail < SLO.avail || burn >= 1;

  const head = [
    c.amber('hermit') + c.gray(' · SRE console') + c.gray('  — live SLO + dynamical-systems analysis of real edge telemetry') + c.gray('   [q]uit'),
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

  let stateLine;
  if (ch) {
    const i = ch.info(); const left = Math.max(0, Math.round((ch.until - Date.now()) / 1000));
    stateLine = c.red('  ◉ DYNAMICAL FAULT') + c.gray(`   ${i.label} · ${i.param} · structured latency · heals in ${left}s`);
  } else if (degraded) {
    stateLine = c.red('  ◉ DEGRADED') + (f ? c.gray(`   chaos active: ${f.kind} · ${f.latency}ms · ${(f.errorRate*100).toFixed(0)}% err · heals in ${Math.max(0,Math.round((f.until-Date.now())/1000))}s`) : c.gray('   (error budget burning)'));
  } else {
    stateLine = c.green('  ● STEADY') + c.gray('   availability within SLO · ') + c.cyan('chaos inject --model lorenz --rho 28') + c.gray(' to perturb it');
  }

  const availCol = avail >= SLO.avail ? c.green : c.red;
  const p95Col = p95 <= SLO.p95 ? c.green : c.red;
  const burnCol = burn <= 1 ? c.green : burn <= 5 ? c.amber : c.red;

  return head.concat([
    c.gray('  endpoint   ') + c.cyan('/api/ping') + c.gray('   window ' + total + '/' + WINDOW + ' · analysis ' + st.series.length + '/' + RING + ' · ' + INTERVAL + 'ms · ' + st.inflight + ' in flight'),
    stateLine,
    '',
    c.gray('  Availability  ') + availCol((avail).toFixed(2) + '%') + c.gray('   SLO ' + SLO.avail + '%   budget ') + burnCol(bar(1 - Math.min(1, budgetConsumed))) + c.gray('   burn ') + burnCol(burn.toFixed(1) + '×'),
    c.gray('  Latency  p50  ') + c.cyan(String(p50).padStart(4) + 'ms') + c.gray('   p95 ') + p95Col(String(p95).padStart(4) + 'ms') + c.gray('   SLO p95<' + SLO.p95 + 'ms  ') + (p95 <= SLO.p95 ? c.green('✓') : c.red('✗')),
    c.gray('  Errors        ') + (errors ? c.red((errRate*100).toFixed(1) + '%') : c.green('0.0%')) + c.gray('   (' + errors + '/' + total + ')'),
    '',
    c.gray('  latency  ') + c.cyan(spark(lat.slice(-32), Math.max(SLO.p95, ...lat))) + c.gray('  (real ms, last ' + Math.min(32, lat.length) + ')'),
    '',
  ]).concat(dynBlock(d)).concat([
    c.gray('────────────────────────────────────────────────────────────────────'),
    c.gray('  ') + c.cyan('chaos inject --model lorenz --rho 28') + c.gray('  ·  ') + c.cyan('chaos inject --ramp') + c.gray('  ·  ') + c.cyan('chaos recover'),
    c.gray('  latency measured live from real /api/ping round-trips — structure injected by a real dynamical system.'),
  ]).join('\n');
}

// the dynamical-systems read-out: system-identification on the live series
function dynBlock(d) {
  if (!d) return [c.gray('  Dynamics   ') + c.gray('collecting samples…  (need ≥16 probes to estimate invariants)')];
  // recovery rate r = −ln(a)/Δt and relaxation time τ = 1/r
  let recStr, tauStr;
  if (d.recovery === Infinity) { recStr = c.green('recovery fast'); tauStr = c.gray('  τ ') + c.green('<1s'); }
  else if (d.recovery == null) { recStr = c.gray('recovery —'); tauStr = ''; }
  else {
    const col = d.recovery < 0.1 ? c.red : d.recovery < 0.3 ? c.amber : c.green;
    recStr = col('recovery ' + d.recovery.toFixed(2) + '/s');
    tauStr = c.gray('  τ ') + col('~' + d.tau.toFixed(1) + 's');
  }
  const hStr = d.H == null ? c.gray('H —')
    : (d.H > 0.6 ? c.amber('H ' + d.H.toFixed(2) + ' (long-range)') : d.H < 0.4 ? c.cyan('H ' + d.H.toFixed(2) + ' (anti-persist)') : c.green('H ' + d.H.toFixed(2) + ' (~white)'));
  const a1Col = d.a1 > 0.85 ? c.red : d.a1 > 0.6 ? c.amber : c.green;
  const a1Str = a1Col('AR(1) ' + d.a1.toFixed(2)) + (d.rising ? c.red('↑') : '');
  const cvStr = c.gray('CV ' + d.coefVar.toFixed(2));

  const lines = [
    c.gray('  Dynamics   ') + recStr + tauStr,
    c.gray('             ') + hStr + c.gray('   ') + a1Str + c.gray('   ') + cvStr,
  ];
  // the TIPPING claim requires the CSD trend (rising autocorr + variance).
  // high-but-flat autocorrelation is structured/bursty, not a transition.
  if (d.rising && d.warn === 'critical') {
    lines.push(c.red('  ⚠ EARLY WARNING  CRITICAL SLOWING DOWN') + c.gray(' — recovery rate → 0, τ → ∞ (autocorr & variance rising): a tipping point is near ') + c.red('BEFORE the SLO breaches.'));
  } else if (d.rising) {
    lines.push(c.amber('  ◍ critical-slowing-down building') + c.gray(' — recovery slowing and variance rising; the system is losing stability.'));
  } else if (d.a1 > 0.6) {
    lines.push(c.amber('  ◉ long memory / bursty') + c.gray(` — strongly autocorrelated (τ≈${d.tau != null && d.recovery !== Infinity ? d.tau.toFixed(1) + 's' : 'large'}) but stationary: structured latency, not approaching a tipping point.`));
  } else {
    lines.push(c.green('  ● no instability signature') + c.gray(' — perturbations decay quickly; no critical-slowing-down.'));
  }
  lines.push(c.gray('  ') + c.gray('exact λ₁ (Lyapunov): ') + c.cyan('lyapunov') + c.gray(' — Benettin on the full ODE state.'));
  return lines;
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
  const eq = args.find(a => a.startsWith(flag + '='));
  return eq ? eq.split('=')[1] : null;
}
function parseUnit(v, unit) {
  if (!v) return 0;
  return parseFloat(String(v).replace(unit, '').replace('ms', '').replace('%', '').replace('s', '')) || 0;
}
