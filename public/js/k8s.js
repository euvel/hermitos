/* ===================================================================
   hermit — kubectl + helm over a REAL miniature orchestrator.
   apply/scale/reconcile/schedule/self-heal are real; pods are real
   Web Workers; nodes are modeled on real Cloudflare PoPs; `kubectl get
   svc` probes the real edge Functions; helm really templates & rolls back.
   =================================================================== */

import { c } from './shell.js';
import { Cluster, renderChart, CHARTS, parseManifest } from './orchestrator.js';
import { getEdge } from './edge.js';

const IMAGES = ['primes', 'matmul', 'hash', 'fault'];
const MAX_REPLICAS = 16;   // each replica is a real Web Worker thread — keep it sane
const clampR = (n) => Math.max(0, Math.min(MAX_REPLICAS, n | 0));

async function cluster(ctx) {
  if (!ctx.state.k8s) {
    const cl = new Cluster({ onEvent: () => ctx.bus && ctx.bus.emit('orbifold:pulse', { kind: 'k8s' }) });
    let colo = null; try { const e = await getEdge(); colo = e && e.colo; } catch (_) {}
    cl.initNodes(colo);
    ctx.state.k8s = cl;
  }
  return ctx.state.k8s;
}

/* ── visible-length-aware table ──────────────────────────────────── */
const vlen = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - vlen(s)));
function table(headers, rows) {
  const w = headers.map((h, i) => Math.max(vlen(h), ...rows.map(r => vlen(r[i] ?? ''))));
  const line = (cells) => cells.map((cell, i) => pad(String(cell ?? ''), w[i])).join('   ');
  return [c.gray(line(headers)), ...rows.map(line)].join('\n');
}
const phaseColor = (s) => s === 'Running' ? c.green(s) : s === 'Pending' ? c.amber(s) : /Creating/.test(s) ? c.cyan(s) : c.red(s);
const ageOf = (t) => { const s = Math.floor((Date.now() - t) / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + (s % 60) + 's'; };

/* ── render helpers ──────────────────────────────────────────────── */
function getPods(cl) {
  return table(['NAME', 'READY', 'STATUS', 'RESTARTS', 'NODE', 'CPU', 'AGE'],
    cl.pods.map(p => [
      c.white(p.name), p.phase === 'Running' ? '1/1' : '0/1', phaseColor(p.phase),
      String(p.restarts), p.node ? c.cyan(p.node) : c.gray('<none>'),
      p.cpuReq + 'm', ageOf(p.createdAt),
    ]));
}
function getNodes(cl) {
  return table(['NAME', 'STATUS', 'COLO', 'REGION', 'PODS', 'CPU(used/cap)', 'MEM(used/cap)'],
    cl.nodes.map(n => {
      const u = cl.usage(n);
      return [
        c.white(n.name) + (n.serving ? c.green(' ◀ serving you') : ''),
        n.status === 'Ready' ? (n.cordoned ? c.amber('Ready,Cordoned') : c.green('Ready')) : c.red('NotReady'),
        n.colo, c.gray(n.city), String(u.pods),
        `${u.cpu}m/${n.cpu}m`, `${u.mem}Mi/${n.mem}Mi`,
      ];
    }));
}
function getDeploys(cl) {
  if (!cl.deploys.length) return c.gray('No deployments. Try: ') + c.green('kubectl create deployment web --image=primes --replicas=3') + c.gray(' or ') + c.green('helm install demo webapp');
  return table(['NAME', 'READY', 'UP-TO-DATE', 'IMAGE', 'REQUESTS'],
    cl.deploys.map(d => {
      const ready = cl.pods.filter(p => p.deploy === d.name && p.phase === 'Running').length;
      return [c.white(d.name), `${ready}/${d.replicas}`, String(ready), c.cyan(d.image), `${d.cpuReq}m·${d.memReq}Mi`];
    }));
}

/* ── kubectl ─────────────────────────────────────────────────────── */
export function k8sCommands(send) {
  const kubectl = {
    desc: 'control a real in-browser orchestrator (pods = real Web Workers)',
    usage: 'kubectl create deployment NAME --image=primes --replicas=3 | get pods|nodes|deploy|svc [-w] | scale | drain | delete | logs | top | describe',
    async run(args, ctx, piped) {
      const cl = await cluster(ctx);
      const sub = args[0];
      const rest = args.slice(1);
      const flag = (name, def) => { const a = args.find(x => x.startsWith('--' + name + '=')); return a ? a.split('=')[1] : def; };

      if (!sub || sub === 'help') {
        return send([
          c.amber('kubectl') + c.gray(' — a real reconciling orchestrator. pods are real Web Workers doing real CPU work;'),
          c.gray('the scheduler bin-packs by cpu/mem; killing a node really evicts and reschedules.'),
          '',
          c.cyan('  kubectl create deployment NAME --image=primes|matmul|hash|fault --replicas=N [--cpu=250 --memory=256]'),
          c.cyan('  kubectl get pods|nodes|deploy|svc [-w]') + c.gray('     -w = live watch'),
          c.cyan('  kubectl scale deploy/NAME --replicas=N'),
          c.cyan('  kubectl drain|cordon|uncordon NODE') + c.gray('         (chaos: watch it reschedule)'),
          c.cyan('  kubectl delete pod/NAME | deploy/NAME'),
          c.cyan('  kubectl logs POD') + c.gray(' · ') + c.cyan('describe pod/NAME|node/NAME') + c.gray(' · ') + c.cyan('top nodes|pods'),
          '',
          c.gray('  quickstart: ') + c.green('helm install demo webapp --set replicaCount=5') + c.gray(' then ') + c.green('kubectl get pods -w'),
        ].join('\n'), ctx, piped);
      }

      if (sub === 'create' && rest[0] === 'deployment') {
        const name = rest[1];
        if (!name) return send(c.red('usage: kubectl create deployment NAME --image=primes --replicas=3'), ctx, piped);
        const image = flag('image', 'primes');
        if (!IMAGES.includes(image)) return send(c.red(`unknown image '${image}' (have: ${IMAGES.join(', ')})`), ctx, piped);
        const replicas = clampR(parseInt(flag('replicas', '3'), 10));
        cl.applyDeployment({ name, app: name, replicas, image, cpuReq: parseInt(flag('cpu', '250'), 10), memReq: parseInt(flag('memory', '256'), 10) });
        return send(c.green(`deployment.apps/${name} created`) + c.gray(`  (image=${image}, replicas=${replicas})`), ctx, piped);
      }

      if (sub === 'get') {
        const what = rest[0] || 'pods';
        if (args.includes('-w') || args.includes('--watch')) return watch(ctx, cl, what);
        if (/^pod/.test(what)) return send(cl.pods.length ? getPods(cl) : c.gray('No resources found. Create some: ') + c.green('helm install demo webapp'), ctx, piped);
        if (/^node/.test(what)) return send(getNodes(cl), ctx, piped);
        if (/^deploy/.test(what)) return send(getDeploys(cl), ctx, piped);
        if (/^svc|^service/.test(what)) return send(await getServices(), ctx, piped);
        if (what === 'all') return send([getNodes(cl), '', getDeploys(cl), '', cl.pods.length ? getPods(cl) : ''].filter(Boolean).join('\n'), ctx, piped);
        return send(c.red(`unknown resource '${what}'`), ctx, piped);
      }

      if (sub === 'scale') {
        const name = (rest.find(x => !x.startsWith('-')) || '').replace(/^deploy(ment)?\//, '');
        const n = parseInt(flag('replicas', 'NaN'), 10);
        if (!name || isNaN(n)) return send(c.red('usage: kubectl scale deploy/NAME --replicas=N'), ctx, piped);
        const rn = clampR(n);
        return send(cl.scale(name, rn) ? c.green(`deployment.apps/${name} scaled to ${rn}`) : c.red(`deployment "${name}" not found`), ctx, piped);
      }

      if (sub === 'delete') {
        const ref = rest[0] || '';
        const [kind, nm] = ref.includes('/') ? ref.split('/') : [rest[0], rest[1]];
        if (/^pod/.test(kind)) { cl.removePod(nm); return send(c.green(`pod "${nm}" deleted`) + c.gray(' (the deployment will reconcile a replacement)'), ctx, piped); }
        if (/^deploy/.test(kind)) { cl.deleteDeployment(nm); return send(c.green(`deployment.apps "${nm}" deleted`), ctx, piped); }
        return send(c.red('usage: kubectl delete pod/NAME | deploy/NAME'), ctx, piped);
      }

      if (sub === 'drain' || sub === 'cordon' || sub === 'uncordon') {
        const node = rest[0];
        if (!node) return send(c.red(`usage: kubectl ${sub} NODE`), ctx, piped);
        if (sub === 'uncordon') return send(cl.cordon(node, false) ? c.green(`node/${node} uncordoned`) : c.red('node not found'), ctx, piped);
        if (sub === 'cordon') return send(cl.cordon(node, true) ? c.amber(`node/${node} cordoned (unschedulable)`) : c.red('node not found'), ctx, piped);
        const r = cl.drain(node);
        return send(r ? c.amber(`node/${node} drained`) + c.gray(`  — evicted ${r.evicted} pod(s); reconciler is rescheduling onto healthy nodes`) : c.red('node not found'), ctx, piped);
      }

      if (sub === 'logs') {
        const p = cl.pods.find(p => p.name === rest[0]) || cl.pods.find(p => p.name.startsWith(rest[0] || '~'));
        if (!p) return send(c.red(`pod "${rest[0]}" not found`), ctx, piped);
        return send([
          c.gray(`# pod ${p.name} · image=${p.image} · node=${p.node} · a real Web Worker thread`),
          c.gray(`[${(p.metrics.cpuMs / 1000).toFixed(1)}s] `) + c.white(p.metrics.detail || 'starting…') + c.gray(`  cpu=${p.metrics.cpuMs}ms iters=${(p.metrics.iters || 0).toLocaleString()}`),
          c.gray('(streaming real metrics from a live thread — run `kubectl top pods` for the fleet)'),
        ].join('\n'), ctx, piped);
      }

      if (sub === 'top') {
        const what = rest[0] || 'pods';
        if (/^node/.test(what)) {
          return send(table(['NODE', 'PODS', 'CPU(req)', 'MEM(req)', 'STATUS'], cl.nodes.map(n => {
            const u = cl.usage(n);
            return [c.white(n.name), String(u.pods), `${u.cpu}m`, `${u.mem}Mi`, n.status === 'Ready' ? c.green('Ready') : c.red('NotReady')];
          })), ctx, piped);
        }
        const run = cl.pods.filter(p => p.phase === 'Running');
        if (!run.length) return send(c.gray('no running pods'), ctx, piped);
        return send(table(['POD', 'CPU(time)', 'WORK', 'NODE', 'DETAIL'],
          run.map(p => [c.white(p.name), c.amber(p.metrics.cpuMs + 'ms'), String(p.metrics.work || 0), c.cyan(p.node), c.gray(p.metrics.detail || '')])), ctx, piped);
      }

      if (sub === 'describe') {
        const ref = rest[0] || '';
        const [kind, nm] = ref.includes('/') ? ref.split('/') : [rest[0], rest[1]];
        if (/^pod/.test(kind)) {
          const p = cl.pods.find(p => p.name === nm) || cl.pods.find(p => p.name.startsWith(nm || '~'));
          if (!p) return send(c.red('pod not found'), ctx, piped);
          return send([
            `${c.gray('Name:')}       ${p.name}`, `${c.gray('Node:')}       ${p.node || '<none>'}`,
            `${c.gray('Status:')}     ${phaseColor(p.phase)}${p.reason ? c.gray(' — ' + p.reason) : ''}`,
            `${c.gray('Image:')}      ${p.image}`, `${c.gray('Restarts:')}   ${p.restarts}`,
            `${c.gray('Requests:')}   cpu=${p.cpuReq}m memory=${p.memReq}Mi`,
            `${c.gray('Workload:')}   ${p.metrics.detail || '(starting)'}  (cpu=${p.metrics.cpuMs}ms)`,
          ].join('\n'), ctx, piped);
        }
        if (/^node/.test(kind)) {
          const n = cl.nodes.find(n => n.name === nm || n.colo.toLowerCase() === (nm || '').toLowerCase());
          if (!n) return send(c.red('node not found'), ctx, piped);
          const u = cl.usage(n);
          return send([
            `${c.gray('Name:')}        ${n.name}`, `${c.gray('PoP:')}         ${n.colo} (${n.city}) — a real Cloudflare edge location`,
            `${c.gray('Status:')}      ${n.status}${n.cordoned ? ', Cordoned' : ''}`,
            `${c.gray('Capacity:')}    cpu=${n.cpu}m memory=${n.mem}Mi`,
            `${c.gray('Allocated:')}   cpu=${u.cpu}m memory=${u.mem}Mi  (${u.pods} pods)`,
          ].join('\n'), ctx, piped);
        }
        return send(c.red('usage: kubectl describe pod/NAME | node/NAME'), ctx, piped);
      }

      return send(c.gray("unknown verb. try `kubectl help`"), ctx, piped);
    },
  };

  /* ── helm ──────────────────────────────────────────────────────── */
  const helm = {
    desc: 'real chart templating + release lifecycle over the orchestrator',
    usage: 'helm install NAME CHART [--set k=v] | template | upgrade | rollback | list | history | uninstall',
    async run(args, ctx, piped) {
      const cl = await cluster(ctx);
      const sub = args[0];
      const parseSet = () => {
        const i = args.indexOf('--set'); const out = {};
        if (i >= 0 && args[i + 1]) for (const kv of args[i + 1].split(',')) { const [k, v] = kv.split('='); out[k] = isNaN(+v) ? v : +v; }
        return out;
      };

      if (!sub || sub === 'help') {
        return send([
          c.amber('helm') + c.gray(' — real chart rendering + release lifecycle. charts: ') + Object.keys(CHARTS).map(k => c.cyan(k)).join(', '),
          c.cyan('  helm install NAME CHART [--set replicaCount=5,image=matmul]'),
          c.cyan('  helm template CHART [--set ...]') + c.gray('   render manifests (no install)'),
          c.cyan('  helm upgrade NAME CHART [--set ...]') + c.gray(' · ') + c.cyan('helm rollback NAME [REV]'),
          c.cyan('  helm list') + c.gray(' · ') + c.cyan('helm history NAME') + c.gray(' · ') + c.cyan('helm uninstall NAME'),
        ].join('\n'), ctx, piped);
      }

      if (sub === 'template') {
        const chart = args[1] || 'webapp';
        try { const { text } = renderChart(chart, parseSet(), 'RELEASE-NAME'); return send(c.gray('# rendered from chart ') + c.cyan(chart) + '\n' + dimYaml(text), ctx, piped); }
        catch (e) { return send(c.red('helm: ' + e.message), ctx, piped); }
      }

      if (sub === 'install' || sub === 'upgrade') {
        const name = args[1], chart = args[2] || 'webapp';
        if (!name) return send(c.red(`usage: helm ${sub} NAME CHART [--set k=v]`), ctx, piped);
        let rendered; try { rendered = renderChart(chart, parseSet(), name); } catch (e) { return send(c.red('helm: ' + e.message), ctx, piped); }
        const m = rendered.manifest;
        cl.applyDeployment({ name: m.name, app: m.app, replicas: clampR(m.replicas), image: IMAGES.includes(m.image) ? m.image : 'primes', cpuReq: m.cpu, memReq: m.memory });
        let rel = cl.releases.find(r => r.name === name);
        if (!rel) { rel = { name, chart, revision: 0, history: [] }; cl.releases.push(rel); }
        rel.revision++; rel.chart = chart; rel.status = 'deployed'; rel.manifest = m; rel.values = parseSet(); rel.updated = Date.now();
        rel.history.push({ revision: rel.revision, manifest: m, ts: Date.now(), desc: sub === 'install' ? 'Install complete' : 'Upgrade complete' });
        return send(c.green(`${sub === 'install' ? 'Released' : 'Upgraded'} ${name}`) + c.gray(`  revision=${rel.revision} chart=${chart}-${CHARTS[chart].version} → deployment ${m.name} (${m.replicas} replicas of ${m.image})`), ctx, piped);
      }

      if (sub === 'rollback') {
        const name = args[1]; const rel = cl.releases.find(r => r.name === name);
        if (!rel) return send(c.red(`release "${name}" not found`), ctx, piped);
        const targetRev = args[2] ? parseInt(args[2], 10) : rel.revision - 1;
        const h = rel.history.find(x => x.revision === targetRev);
        if (!h) return send(c.red(`revision ${targetRev} not found in history`), ctx, piped);
        const m = h.manifest;
        cl.applyDeployment({ name: m.name, app: m.app, replicas: clampR(m.replicas), image: IMAGES.includes(m.image) ? m.image : 'primes', cpuReq: m.cpu, memReq: m.memory });
        rel.revision++; rel.manifest = m; rel.status = 'deployed';
        rel.history.push({ revision: rel.revision, manifest: m, ts: Date.now(), desc: `Rollback to ${targetRev}` });
        return send(c.green(`Rollback was a success! Happy Helming!`) + c.gray(`  ${name} → revision ${rel.revision} (state of revision ${targetRev})`), ctx, piped);
      }

      if (sub === 'list' || sub === 'ls') {
        if (!cl.releases.length) return send(c.gray('No releases. Try: ') + c.green('helm install demo webapp'), ctx, piped);
        return send(table(['NAME', 'REVISION', 'STATUS', 'CHART', 'REPLICAS'],
          cl.releases.map(r => [c.white(r.name), String(r.revision), c.green(r.status), `${r.chart}-${CHARTS[r.chart].version}`, String(r.manifest.replicas)])), ctx, piped);
      }

      if (sub === 'history') {
        const rel = cl.releases.find(r => r.name === args[1]);
        if (!rel) return send(c.red(`release "${args[1]}" not found`), ctx, piped);
        return send(table(['REVISION', 'STATUS', 'DESCRIPTION', 'REPLICAS·IMAGE'],
          rel.history.map(h => [String(h.revision), h.revision === rel.revision ? c.green('deployed') : c.gray('superseded'), c.gray(h.desc), `${h.manifest.replicas}·${h.manifest.image}`])), ctx, piped);
      }

      if (sub === 'uninstall' || sub === 'delete') {
        const name = args[1]; const rel = cl.releases.find(r => r.name === name);
        if (!rel) return send(c.red(`release "${name}" not found`), ctx, piped);
        cl.deleteDeployment(rel.manifest.name);
        cl.releases = cl.releases.filter(r => r.name !== name);
        return send(c.green(`release "${name}" uninstalled`), ctx, piped);
      }

      return send(c.gray('unknown verb. try `helm help`'), ctx, piped);
    },
  };

  return { kubectl, helm, k: kubectl };
}

/* ── live watch (reuses the shell's full-screen mode) ────────────── */
function watch(ctx, cl, what) {
  ctx.shell.runLive({
    intervalMs: 700,
    onExitMsg: c.gray('stopped watching.'),
    render: () => {
      const head = c.amber('kubectl get ' + what + ' --watch') + c.gray('   (q to stop · pods are real Web Workers)') + '\n\n';
      const body = /^node/.test(what) ? getNodes(cl) : /^deploy/.test(what) ? getDeploys(cl) : (cl.pods.length ? getPods(cl) : c.gray('no pods yet'));
      const ready = cl.pods.filter(p => p.phase === 'Running').length;
      return head + body + '\n\n' + c.gray(`fleet: ${ready}/${cl.pods.length} running · ${cl.nodes.filter(n => n.status === 'Ready').length}/${cl.nodes.length} nodes Ready`);
    },
  });
  return '';
}

/* ── kubectl get svc → probe the REAL edge Functions ─────────────── */
async function getServices() {
  const eps = [['aiwass', '/api/aiwass'], ['ping', '/api/ping'], ['query', '/api/query'], ['agent', '/api/agent'], ['whereami', '/api/whereami'], ['content', '/api/content']];
  const rows = await Promise.all(eps.map(async ([name, path]) => {
    const t0 = performance.now();
    try {
      const r = await fetch(path, { method: 'GET', cache: 'no-store' });
      const ms = Math.round(performance.now() - t0);
      const up = r.status < 500;     // 405 (method not allowed) still means the function is up
      return [c.white(name), c.gray(path), up ? c.green('Ready') : c.red('Down'), `HTTP ${r.status}`, c.amber(ms + 'ms')];
    } catch (_) {
      return [c.white(name), c.gray(path), c.red('Unreachable'), '—', c.gray('—')];
    }
  }));
  return c.gray('# Services backed by real edge Functions (probed live):\n') +
    table(['NAME', 'ENDPOINT', 'STATUS', 'CODE', 'LATENCY'], rows);
}

function dimYaml(text) {
  return text.split('\n').map(l => {
    const m = l.match(/^(\s*)([\w.-]+):(.*)$/);
    if (m) return c.gray(m[1]) + c.cyan(m[2]) + c.gray(':') + c.white(m[3]);
    return c.gray(l);
  }).join('\n');
}
