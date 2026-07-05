/* Real logic tests — run in CI (node --test) and locally.
   These assert the actual mathematics the site claims, so a green check
   on the résumé's `ci` command means these genuinely passed. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { benettinLorenz } from '../public/js/dynamics.js';
import { analyze as kamAnalyze } from '../public/js/kam.js';
import { newSet, opAdd, opRemove, present, clone, merge, equalState } from '../public/js/crdt.js';

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
