/* ===================================================================
   hermit — the observer field: collapse + watch (one real signal, two payoffs)

   1) COLLAPSE. Real entropy — the edge PoP/ASN/TLS actually serving you, your
      device, this session, and the rhythm of your own input — is hashed into a
      per-visit SEED that deterministically parameterizes THIS instance: the
      attractor's exact look, a small persona bias, an id. It is unrepeatable
      and ephemeral. Nothing is stored; it dies when the tab closes. A
      screenshot is just one collapse of many.

   2) WATCH. Your real behaviour — dwell, path, command variety, hesitation,
      pointer motion — is measured live, entirely in the browser. Nothing is
      sent anywhere. No PII. It feeds the field, AIWASS's read of you, and the
      honest readouts — replacing the last fabricated numbers with your own.
   =================================================================== */

import { c } from './shell.js';

/* deterministic PRNG: xmur3 string-hash → mulberry32 */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return h >>> 0; };
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* command → coarse area, for measuring reach (no content, just topology) */
const AREA = {
  read:    ['ls', 'cat', 'tree', 'find', 'grep', 'head', 'tail', 'wc', 'stat', 'file', 'du', 'whoami', 'id', 'man', 'neofetch', 'source', 'git', 'help'],
  systems: ['kernel', 'python3', 'python', 'sql', 'edge', 'ci', 'deploy'],
  sre:     ['chaos', 'watch', 'induce', 'lyapunov', 'kam', 'observe'],
  labs:    ['train', 'sheaf', 'glue', 'nn'],
  cluster: ['kubectl', 'helm'],
  net:     ['ping', 'dig', 'curl', 'traceroute', 'ip', 'ss', 'bpftrace', 'perf'],
  intel:   ['aiwass', 'observer'],
};
function areaOf(name) { for (const k in AREA) if (AREA[k].includes(name)) return k; return 'misc'; }

function cmdEntropy(counts) {
  const vals = Object.values(counts); const n = vals.reduce((a, b) => a + b, 0);
  if (!n) return 0; let h = 0; for (const v of vals) { const p = v / n; h -= p * Math.log2(p); } return h;
}

function classify(f) {
  const total = f.activeMs + f.idleMs;
  if (f.cmds === 0 && f.clicks === 0 && total < 8000) return 'newcomer';
  const has = (a) => f.areas.has(a);
  const ops = ['systems', 'sre', 'cluster', 'net', 'real-linux', 'kernel'].filter(has).length;
  if (has('kernel') || has('real-linux') || ops >= 2) return 'operator';
  if (has('labs') || has('sre')) return 'curious';
  if (f.clicks >= 2 && f.cmds <= 2) return 'recruiter';
  if (has('read') && f.cmds >= 1 && cmdEntropy(f.cmdCounts) < 1.4) return 'reader';
  if (f.cmds >= 3 && cmdEntropy(f.cmdCounts) > 1.3) return 'explorer';
  return 'wanderer';
}

function internalEnergy(f, idleMs) {
  const ptr = Math.min(1, (f.ptrEMA || 0) / 1.5);
  const act = Math.min(1, f.cmds / 10);
  const base = ptr * 0.4 + act * 0.6;
  return Math.max(0, Math.min(0.999, base * Math.exp(-idleMs / 8000)));
}

export function initObserver(ctx) {
  const { bus, state } = ctx;
  const nav = navigator, scr = screen;
  const clientEntropy = [
    (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
    scr.width + 'x' + scr.height + 'x' + (window.devicePixelRatio || 1),
    nav.hardwareConcurrency || 0, nav.deviceMemory || 0, nav.language || '',
    nav.platform || '', (nav.userAgentData && nav.userAgentData.platform) || '',
    performance.now().toFixed(1),
    Math.random().toString(36).slice(2),   // session nonce → per-visit uniqueness
  ].join('|');

  const obs = state.observer = {
    id: null, params: null, edge: null, startedAt: Date.now(),
    f: { activeMs: 0, idleMs: 0, keys: 0, cmds: 0, clicks: 0, pointerPath: 0, hesEMA: 0, ptrEMA: 0, areas: new Set(), cmdCounts: Object.create(null) },
    class: 'newcomer', internal: 0,
  };

  const seedFrom = (edgeStr) => {
    if (obs.id) return;                                     // seed once
    const seed = xmur3(clientEntropy + '||' + (edgeStr || ''))();
    const rnd = mulberry32(seed);
    obs.id = seed.toString(36).slice(0, 7);
    obs.params = {
      hue: (rnd() * 2 - 1) * 0.05,        // subtle palette rotation, stays in family
      camYaw: rnd() * Math.PI * 2,
      camPitch: (rnd() * 2 - 1) * 0.5,
      spin: rnd() < 0.5 ? -1 : 1,
      bJit: (rnd() * 2 - 1) * 0.02,
      lead: Math.floor(rnd() * 5),
    };
    bus.emit('observer:ready', { instance: { id: obs.id, params: obs.params, edge: obs.edge } });
  };

  // fold the real edge into the seed (or client-only if the edge is unreachable)
  fetch('/api/whereami').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d && d.edge) {
      obs.edge = { colo: d.colo, asn: d.asn, org: d.asOrganization, tls: d.tlsVersion, proto: d.httpProtocol, country: d.country };
      seedFrom([d.colo, d.asn, d.tlsVersion, d.httpProtocol, d.country].join('~'));
    } else seedFrom('');
  }).catch(() => seedFrom(''));
  setTimeout(() => seedFrom(''), 900);                      // don't wait forever on the edge

  // ── watch (client-only; nothing sent, no PII) ──
  let lastActivity = performance.now(), lastKey = 0, lastPtr = 0, px = 0, py = 0;
  const active = () => { lastActivity = performance.now(); };
  window.addEventListener('keydown', (e) => {
    const now = performance.now();
    // rhythm = real typing cadence within a line: skip Enter (it starts a new
    // line) and think-pauses (> 2s) so the number reflects keystroke speed, not
    // the time spent deciding what to run.
    if (e.key === 'Enter') { lastKey = 0; obs.f.keys++; active(); return; }
    if (lastKey) { const dt = now - lastKey; if (dt < 2000) obs.f.hesEMA = obs.f.hesEMA ? obs.f.hesEMA * 0.8 + dt * 0.2 : dt; }
    lastKey = now; obs.f.keys++; active();
  }, { passive: true });
  window.addEventListener('pointermove', (e) => {
    const now = performance.now(); const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
    if (lastPtr) { const dt = Math.max(1, now - lastPtr); const v = Math.hypot(dx, dy) / dt; obs.f.ptrEMA = obs.f.ptrEMA * 0.9 + v * 0.1; obs.f.pointerPath += Math.hypot(dx, dy); }
    lastPtr = now; active();
  }, { passive: true });
  window.addEventListener('pointerdown', () => { obs.f.clicks++; active(); }, { passive: true });

  // real command traffic → variety + reach (shell tags each run with name + whether it exists)
  bus.on('orbifold:cmd', ({ name, known }) => {
    active();
    if (!name || known === false) return;    // typos are activity, but not a command run
    obs.f.cmds++; obs.f.cmdCounts[name] = (obs.f.cmdCounts[name] || 0) + 1;
    obs.f.areas.add(areaOf(name));
  });
  bus.on('mode', ({ mode }) => { if (mode === 'real') obs.f.areas.add('real-linux'); });
  bus.on('elevate', ({ on }) => { if (on) obs.f.areas.add('kernel'); });

  // dwell accounting + classify + interior energy, once a second
  let prev = performance.now();
  setInterval(() => {
    const now = performance.now(); const dt = now - prev; prev = now;
    if (!document.hidden) { if (now - lastActivity < 4000) obs.f.activeMs += dt; else obs.f.idleMs += dt; }
    obs.class = classify(obs.f);
    obs.internal = internalEnergy(obs.f, now - lastActivity);
    bus.emit('observer:tick', { class: obs.class, internal: obs.internal });
    bus.emit('observer:energy', { e: obs.internal });
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) active(); });

  return obs;
}

/* one honest line reading the inferred class back to the observer */
const READS = {
  operator:  'You go straight for the systems and move fast — this reads as an operator, not a browser.',
  curious:   'You reach for the labs and the dynamics: you want to see how it behaves, not just what it claims.',
  recruiter: 'You click more than you type, and you read — assessing, not playing. Ask `whoami` for the short version.',
  reader:    'You are reading the record deliberately, top-down. `aiwass ask "…"` if you want the person behind it.',
  explorer:  'You range widely and try many things — high curiosity, low commitment. Fitting, for an observer.',
  wanderer:  'You are drifting, taking it in. No rush — push on anything that catches you.',
  newcomer:  'You just arrived; I have barely read you yet. Do something and ask me again.',
};

/* the `observer` command's body: the projection reads you back (all real) */
export function observerReadout(ctx) {
  const o = ctx.state.observer;
  if (!o || !o.id) return c.gray('the observer field is still resolving — try again in a moment.');
  const f = o.f, e = o.edge || {};
  const kv = (k, v) => c.gray('    ' + k.padEnd(16)) + c.cyan(v);
  const distinct = Object.keys(f.cmdCounts).length;
  return [
    '',
    c.mag('  ◍ observer') + c.gray('  — the projection reads you back'),
    c.gray('  ────────────────────────────────────────────────────'),
    c.white('  instance ') + c.amber('#' + o.id),
    c.gray('    collapsed from real entropy: this edge (') + c.cyan((e.colo || '—') + (e.org ? ' · ' + e.org : '')) + c.gray('),'),
    c.gray('    your device, this session, and the rhythm of your input.'),
    c.gray('    it has never existed before and ends when you close this tab —'),
    c.gray('    a screenshot is just one collapse of many.'),
    '',
    c.white('  what the interior has measured off you:'),
    kv('class', o.class),
    kv('dwell', (f.activeMs / 1000).toFixed(0) + 's active · ' + (f.idleMs / 1000).toFixed(0) + 's idle'),
    kv('commands', f.cmds + ' run · ' + distinct + ' distinct · entropy ' + cmdEntropy(f.cmdCounts).toFixed(2) + ' bits'),
    kv('reach', [...f.areas].join(', ') || '—'),
    kv('rhythm', f.hesEMA ? '≈' + Math.round(f.hesEMA) + 'ms between keys' : '—'),
    kv('interior energy', o.internal.toFixed(3)),
    '',
    c.gray('  ' + (READS[o.class] || READS.wanderer)),
    c.gray('  nothing here leaves your browser — no PII, nothing sent, nothing stored.'),
    '',
  ].join('\n');
}
