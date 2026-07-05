/* ===================================================================
   hermit — `sheaf` / `glue` : a real CRDT (conflict-free replicated
   data type), reclaiming the sheaf metaphor honestly.

   A sheaf is about GLUING consistent local data over overlapping regions
   into a single global section. The computer-science instance of exactly
   that is a CRDT: replicas hold divergent local state, and a merge (join)
   combines them into one global state — and because the join is
   commutative, associative and idempotent, the result is independent of
   order and message loss. That is the gluing condition, made to hold.

   This implements a state-based Observed-Remove Set (OR-Set): the standard
   add-wins set CRDT. Each add stamps a fresh unique tag; a remove tombstones
   only the tags it has OBSERVED. An element is present iff it has a live tag.
   Merge = union of adds ∪ union of tombstones. Concurrent add-vs-remove of
   the same element resolves ADD-WINS — the subtle-but-correct behaviour.
   =================================================================== */

import { c } from './shell.js';

let TAGSEQ = 0;
const uid = (replica) => `${replica}·${(++TAGSEQ).toString(36)}`;   // globally-unique op tag

/* ── the OR-Set itself (pure; exported for tests) ────────────────── */
export function newSet() { return { adds: new Map(), removes: new Set() }; }  // adds: elem -> Set(tags)
export function opAdd(s, elem, replica) {
  if (!s.adds.has(elem)) s.adds.set(elem, new Set());
  s.adds.get(elem).add(uid(replica));
}
export function opRemove(s, elem) {                                  // observed-remove
  const tags = s.adds.get(elem); if (!tags) return;
  for (const t of tags) s.removes.add(t);
}
export function present(s) {                                        // Set of currently-present elements
  const out = new Set();
  for (const [elem, tags] of s.adds) { for (const t of tags) { if (!s.removes.has(t)) { out.add(elem); break; } } }
  return out;
}
export function clone(s) {
  const n = newSet();
  for (const [e, tags] of s.adds) n.adds.set(e, new Set(tags));
  n.removes = new Set(s.removes);
  return n;
}
export function merge(a, b) {                                       // join = least upper bound
  const n = clone(a);
  for (const [e, tags] of b.adds) { if (!n.adds.has(e)) n.adds.set(e, new Set()); for (const t of tags) n.adds.get(e).add(t); }
  for (const t of b.removes) n.removes.add(t);
  return n;
}
export function equalState(a, b) {                                  // full-state equality (convergence proof)
  if (a.removes.size !== b.removes.size) return false;
  for (const t of a.removes) if (!b.removes.has(t)) return false;
  if (a.adds.size !== b.adds.size) return false;
  for (const [e, tags] of a.adds) {
    const tb = b.adds.get(e); if (!tb || tb.size !== tags.size) return false;
    for (const t of tags) if (!tb.has(t)) return false;
  }
  return true;
}
const sortedPresent = (s) => [...present(s)].sort();

/* ── replicas & the scripted partition scenario ──────────────────── */
function seedReplicas() {
  // a converged base: three replicas agreeing on the same tags (identical state)
  const base = newSet();
  for (const e of ['linux', 'k8s', 'rust']) opAdd(base, e, 'seed');
  return { A: clone(base), B: clone(base), C: clone(base), partitioned: false, glued: false };
}

// concurrent, divergent local edits — a real network partition
function applyPartition(r) {
  opAdd(r.A, 'wasm', 'A'); opRemove(r.A, 'k8s');                    // A: +wasm, −k8s
  opRemove(r.B, 'rust'); opAdd(r.B, 'go', 'B');                    // B: −rust, +go
  opAdd(r.C, 'rust', 'C'); opAdd(r.C, 'wasm', 'C');               // C: re-add rust (concurrent!), +wasm
  r.partitioned = true; r.glued = false;
}

const REPS = ['A', 'B', 'C'];
const setStr = (s) => { const p = sortedPresent(s); return p.length ? '{ ' + p.join(', ') + ' }' : '{ }'; };

export function crdtCommands(send) {
  const ensure = (ctx) => { if (!ctx.state.crdt) ctx.state.crdt = seedReplicas(); return ctx.state.crdt; };

  const status = (ctx, piped, extra) => {
    const r = ensure(ctx);
    const converged = equalState(r.A, r.B) && equalState(r.B, r.C);
    const lines = [
      c.cyan('CRDT · OR-Set (observed-remove) — three replicas of one set'),
      c.gray('  a sheaf glues consistent local sections into a global one; a CRDT does it for real.'),
      '',
      ...REPS.map(k => c.gray('  replica ') + c.amber(k) + '  ' + c.green(setStr(r[k])) +
        (r.partitioned && !r.glued ? c.gray('   (partitioned — offline edits)') : '')),
      '',
      converged
        ? c.green('  convergence: CONVERGED') + c.gray('   all replicas hold the identical global section.')
        : c.red('  convergence: DIVERGENT') + c.gray('   replicas hold different local sections — ') + c.cyan('glue') + c.gray(' to merge them.'),
    ];
    if (extra) lines.push('', extra);
    return send(lines.join('\n'), ctx, piped);
  };

  return {
    sheaf: {
      desc: 'a real CRDT (OR-Set): local replicas you can diverge and glue', usage: 'sheaf [status|partition|add <A|B|C> <x>|rm <A|B|C> <x>|reset]',
      run(args, ctx, piped) {
        const r = ensure(ctx);
        const sub = args[0] || 'status';
        if (sub === 'partition' || sub === 'diverge') {
          applyPartition(r);
          ctx.bus.emit('orbifold:pulse', { kind: 'sheaf' });
          return status(ctx, piped, c.amber('  ⇢ network partition: concurrent offline edits applied. ') + c.gray('note replica C re-adds ') + c.cyan('rust') + c.gray(' while B removes it.'));
        }
        if (sub === 'reset') { ctx.state.crdt = seedReplicas(); return status(ctx, piped, c.gray('  reset to a converged base.')); }
        if (sub === 'add' || sub === 'rm' || sub === 'remove') {
          const rep = (args[1] || '').toUpperCase(); const elem = args[2];
          if (!REPS.includes(rep) || !elem) return send(c.gray('usage: sheaf ' + sub + ' <A|B|C> <element>'), ctx, piped);
          if (sub === 'add') opAdd(r[rep], elem, rep); else opRemove(r[rep], elem);
          r.partitioned = true; r.glued = false;
          return status(ctx, piped, c.gray(`  applied ${sub} ${elem} on replica ${rep} (local, un-glued).`));
        }
        return status(ctx, piped);
      },
    },

    glue: {
      desc: 'glue the local replicas into one global section (CRDT join)', usage: 'glue',
      run(args, ctx, piped) {
        const r = ensure(ctx);
        // the join, in three different orders — to PROVE order-independence
        const oABC = merge(merge(r.A, r.B), r.C);
        const oCBA = merge(merge(r.C, r.B), r.A);
        const oAssoc = merge(r.A, merge(r.B, r.C));
        const orderOK = equalState(oABC, oCBA) && equalState(oABC, oAssoc);
        // idempotence: merging the result with any replica changes nothing
        const idem = equalState(merge(oABC, r.A), oABC);
        const global = oABC;

        // explain the two interesting resolutions from the scripted partition
        const g = present(global);
        const notes = [];
        if (r.partitioned) {
          if (!g.has('k8s')) notes.push(c.gray('  k8s  removed on A, never re-added ') + c.red('→ dropped') + c.gray(' (remove observed).'));
          if (g.has('rust')) notes.push(c.gray('  rust removed on B but concurrently re-added on C ') + c.green('→ ADD-WINS, kept') + c.gray('.'));
        }

        // converge every replica onto the glued global section
        ctx.state.crdt = { A: clone(global), B: clone(global), C: clone(global), partitioned: false, glued: true };
        ctx.bus.emit('orbifold:pulse', { kind: 'glue' });

        return send([
          c.cyan('gluing 3 local sections via CRDT join (least upper bound)…'),
          '  ' + c.gray('A ⊔ B ⊔ C = ') + c.green(setStr(global)),
          ...notes,
          '',
          c.gray('  order-independence  ') + (orderOK ? c.green('✓') : c.red('✗')) +
            c.gray('  (A⊔B)⊔C == A⊔(B⊔C) == (C⊔B)⊔A   — commutative + associative'),
          c.gray('  idempotent          ') + (idem ? c.green('✓') : c.red('✗')) +
            c.gray('  merging an already-merged replica changes nothing'),
          '',
          c.green('  all replicas now converge to the identical global section.') +
            c.gray('  the local sections glue.'),
        ].join('\n'), ctx, piped);
      },
    },
  };
}
