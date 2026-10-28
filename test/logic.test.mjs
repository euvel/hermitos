/* Real logic tests — run in CI (node --test) and locally.
   These assert the actual mathematics (and agent routing) the site claims, so a green check
   on the résumé's `ci` command means these genuinely passed. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { benettinLorenz } from '../public/js/dynamics.js';
import { analyze as kamAnalyze } from '../public/js/kam.js';
import { newSet, opAdd, opRemove, present, clone, merge, equalState } from '../public/js/crdt.js';
import { heuristicStep, keywordFor, synth } from '../public/js/agent.js';

test('Lorenz Lyapunov exponent: stable below onset, chaotic above', () => {
  assert.ok(benettinLorenz(14) < 0, 'rho=14 should be non-chaotic (lambda < 0)');
  assert.ok(benettinLorenz(28) > 0.5, 'rho=28 should be chaotic (lambda > 0.5)');
});

test('Chirikov standard map: transport barrier holds below K_c, breaks above', () => {
  const lo = kamAnalyze(0.5);
  const hi = kamAnalyze(2.0);
  assert.ok(!lo.broken, 'K=0.5: the KAM barrier should confine chaotic orbits');
  assert.ok(hi.broken, 'K=2.0: the last torus is gone, global transport');
  assert.ok(hi.lam > lo.lam, 'mean Lyapunov exponent should grow with K');
});

test('OR-Set CRDT: join is order-independent + idempotent, with add-wins', () => {
  const base = newSet();
  for (const e of ['linux', 'k8s', 'rust']) opAdd(base, e, 'seed');
  const A = clone(base), B = clone(base), C = clone(base);
  opAdd(A, 'wasm', 'A'); opRemove(A, 'k8s');       // A: +wasm, -k8s
  opRemove(B, 'rust'); opAdd(B, 'go', 'B');        // B: -rust, +go
  opAdd(C, 'rust', 'C');                            // C: concurrently re-add rust

  const g1 = merge(merge(A, B), C);
  const g2 = merge(merge(C, B), A);
  const g3 = merge(A, merge(B, C));
  assert.ok(equalState(g1, g2) && equalState(g1, g3), 'join must be commutative + associative');
  assert.ok(equalState(merge(g1, A), g1), 'join must be idempotent');
  assert.ok(present(g1).has('rust'), 'add-wins: concurrent re-add survives the remove');
  assert.ok(!present(g1).has('k8s'), 'an observed remove with no concurrent add sticks');
});

test('AIWASS fallback planner: routes to the real box, never to filler-word résumé searches', () => {
  const booted = { state: { linux: { ready: true } } };
  const cold = { state: {} };
  const goal = 'can you demonstrate file descriptor concept in the box?';

  const s1 = heuristicStep(goal, booted, 1);
  assert.equal(s1.action, 'shell', 'a box demo must run on the real kernel');
  assert.match(s1.input, /\/proc\/\$\$\/fd/, 'the fd demo lists the shell’s own descriptors');

  const off = heuristicStep(goal, cold, 1);
  assert.equal(off.action, 'final', 'no kernel → say so, do not search the résumé');
  assert.match(off.input, /kernel boot real/);

  assert.notEqual(keywordFor(goal), 'demonstrate', 'filler words are never the search term');
  assert.equal(heuristicStep('what kubernetes projects has Euvel run?', booted, 1).input, 'kubernetes',
    'questions about the owner still search the record');
  assert.equal(heuristicStep('compute 17 * 23', cold, 1).action, 'python');
});

test('AIWASS fallback planner: the summary reports what the tools found, never a canned verdict', () => {
  const none = synth('g', 'kubernetes', [{ action: 'grep', display: 'no matches for "kubernetes"' }, { action: 'sql', display: '(0 rows)' }]);
  assert.match(none, /Nothing .* matched "kubernetes"/);
  assert.doesNotMatch(none, /supports the goal/);
  const some = synth('g', 'kubernetes', [{ action: 'grep', display: '3 match(es); e.g. /skills/devops/orchestration.k8s:1' }]);
  assert.match(some, /grep → 3 match\(es\)/);
});
