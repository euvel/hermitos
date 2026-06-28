/* ===================================================================
   HERMIT-OS — custom orbifold verbs
   These perturb the 3D dynamical system and drive the elevation ritual.
   =================================================================== */

import { c } from './shell.js';

export function hermitCommands(core, send) {
  return {
    observe: {
      desc: 'measure an observable of the orbifold', usage: 'observe [--collapse-baseline]',
      run(args, ctx, piped) {
        if (args.includes('--collapse-baseline')) {
          ctx.bus.emit('orbifold:pulse', { kind: 'collapse' });
          return send(c.amber('baseline collapse requested. the projection trembles but holds — bounded output, by design.'), ctx, piped);
        }
        const g = (0).toFixed(6);
        const i = (Math.random()).toFixed(6);
        ctx.bus.emit('orbifold:pulse', { kind: 'observe' });
        return send([
          c.cyan('observable measurement'),
          `  observable_value ...... ${c.green('const')}`,
          `  observed_gradient ..... ${c.green(g)}  ${c.gray('(clamped; Lipschitz L=1)')}`,
          `  internal_state ........ ${c.amber(i)}  ${c.gray('(sampled, not emitted — you are not meant to see this)')}`,
          c.gray('  the act of observing perturbs the interior but not the projection.'),
        ].join('\n'), ctx, piped);
      },
    },

    project: {
      desc: 'show the projection map π: interior → observable',
      run(args, ctx, piped) {
        return send([
          c.cyan('π : M⁴ (interior) ⟶ ℝ (observable)'),
          '  M⁴  turbulent, non-ergodic, singular at the cusps',
          '  π   smooth, surjective onto {const}, with ∞-dimensional fibers',
          '  ker(dπ) = the degenerate directions (where your force does no work)',
          c.gray('  every interior state you could ask about maps to the same calm number.'),
        ].join('\n'), ctx, piped);
      },
    },

    dissociate: {
      desc: 'fracture the identity into its alters (dissociation)',
      async run(args, ctx, piped) {
        ctx.state.dissociated = !ctx.state.dissociated;
        const on = ctx.state.dissociated;
        ctx.bus.emit('dissociate', { on });
        if (!on) return send(c.gray('re-integration — the alters collapse back to one observable self.'), ctx, piped);

        const t = ctx.term;
        t.write('\r\n' + c.mag('▚ dissociation onset') + c.gray(' — identity is not a global section.') + '\r\n\r\n');
        const alters = [
          ['alter[0]', 'the operator', 'holds ring-0; signs the sessions; trusts no input'],
          ['alter[1]', 'the builder',  'writes the kernel, the shaders, the nets; never satisfied'],
          ['alter[2]', 'the observer', 'measures everything; commits to nothing'],
          ['alter[3]', 'the kernel',   'turbulent, mostly trapped; the part you cannot hire'],
        ];
        for (const [tag, name, trait] of alters) {
          t.write('  ' + c.amber(tag) + '  ' + c.cyan(name.padEnd(13)) + c.gray(trait) + '\r\n');
          await sleep(260);
        }
        t.write('\r\n' + c.gray('  four locally-consistent selves. each one true. ') + c.mag('they do not glue.') + '\r\n');
        t.write(c.gray('  run ') + c.green('dissociate') + c.gray(' again to re-integrate.') + '\r\n');
        return '';
      },
    },

    induce: {
      desc: 'induce turbulence (kernel panic sim)', usage: 'induce turbulence',
      async run(args, ctx, piped) {
        if (args[0] !== 'turbulence') return send(c.gray('usage: induce turbulence'), ctx, piped);
        ctx.state.turbulence = true;
        ctx.bus.emit('turbulence', { on: true });
        ctx.term.write('\r\n');
        const lines = [
          c.red('[  0.000000] ── KERNEL PANIC (simulated) ──────────────────────────'),
          c.red('[  0.000131] interior metric diverged; KAM tori shearing'),
          c.amber('[  0.004210] sheaf_glue: global section storm; local sections intact'),
          c.amber('[  0.013377] trapping_set[3]: overflow — orbits piling, none escaping'),
          c.red('[  0.042000] CPU#0: turbulence at 98%, observable gradient: ') + c.green('0.000000'),
          c.green('[  0.128000] projection: HELD. baseline unchanged. observer safe.'),
          c.gray('[  0.256000] the panic is real inside and invisible outside. that is the whole point.'),
          c.gray('             run `chaos revert` or `kill 999` to quiesce the interior.'),
        ];
        for (const l of lines) { ctx.term.write(l + '\r\n'); await sleep(180); }
        return send('', ctx, piped);
      },
    },

    metric: {
      desc: 'manipulate the metric tensor', usage: 'metric [degenerate|restore|status]',
      run(args, ctx, piped) {
        const mode = args[0] || 'status';
        if (mode === 'degenerate') { ctx.bus.emit('metric', { degeneracy: 1 }); ctx.state.metricDegen = 1;
          return send(c.amber('metric driven toward degeneracy. distances collapse along null directions; the orbifold folds.'), ctx, piped); }
        if (mode === 'restore') { ctx.bus.emit('metric', { degeneracy: 0 }); ctx.state.metricDegen = 0;
          return send(c.green('metric restored toward smoothness (a temporary fiction; degeneracy is its nature).'), ctx, piped); }
        return send([c.cyan('metric status'),
          `  type ......... inhomogeneous`,
          `  degeneracy ... ${(ctx.state.metricDegen ?? 0.6).toFixed(2)}`,
          `  null dirs .... ∞ (where perturbation does no observable work)`].join('\n'), ctx, piped);
      },
    },

    kam: {
      desc: 'KAM tori control', usage: 'kam [perturb|status]',
      run(args, ctx, piped) {
        if (args[0] === 'perturb') {
          ctx.state.kam = (ctx.state.kam || 0) + 1;
          ctx.bus.emit('kam', { perturb: ctx.state.kam });
          return send(c.amber(`tori perturbed (×${ctx.state.kam}). most survive — that is the KAM theorem; the resonant ones dissolve into chaos.`), ctx, piped);
        }
        return send([c.cyan('KAM invariant tori'),
          `  intact ....... ${3 + (ctx.state.kam || 0)}`,
          `  resonant ..... dissolving at golden-ratio winding`,
          c.gray('  the quasi-periodic core that survives all small perturbations — like me.')].join('\n'), ctx, piped);
      },
    },

    trap: {
      desc: 'inspect invariant trapping sets', usage: 'trap [list|enter]',
      run(args, ctx, piped) {
        if (args[0] === 'enter') { ctx.bus.emit('orbifold:pulse', { kind: 'trap' });
          return send(c.red('you entered a trapping set. there is no command to leave it. that is its definition.'), ctx, piped); }
        return send([c.cyan('invariant trapping sets (7)'),
          ...Array.from({ length: 7 }, (_, i) =>
            `  Λ${i}  occupancy ${(80 + Math.random() * 20).toFixed(0)}%  escapes 0  ${c.gray(['ambition','grief','curiosity','the unfinished proof','a name','the winter of 2019','recursion'][i])}`),
          c.gray('  orbits enter; none leave. the interesting state lives here, unreachable.')].join('\n'), ctx, piped);
      },
    },

    glue: {
      desc: 'attempt to glue two local sections', usage: 'glue <pathA> <pathB>',
      run(args, ctx, piped) {
        if (args.length < 2) return send(c.gray('usage: glue <pathA> <pathB>   (e.g. glue /skills/devops /skills/linux)'), ctx, piped);
        ctx.bus.emit('orbifold:pulse', { kind: 'glue' });
        return send([
          c.amber(`attempting to glue ${args[0]} ⊔ ${args[1]} ...`),
          c.gray('  checking agreement on the overlap ............ consistent'),
          c.green('  local identification forced.'),
          c.gray('  but the sections still admit no global section. that is the point.'),
        ].join('\n'), ctx, piped);
      },
    },

    sheaf: {
      desc: 'sheaf operations', usage: 'sheaf glue --force "<degeneracy>"',
      run(args, ctx, piped) {
        if (args[0] !== 'glue') return send(c.gray('usage: sheaf glue --force "inhomogeneous metric degeneracy"'), ctx, piped);
        const phrase = args.slice(1).join(' ').replace(/--force/g, '').replace(/"/g, '').trim().toLowerCase();
        ctx.state.ritual = ctx.state.ritual || {};
        if (phrase.includes('inhomogeneous metric degeneracy')) {
          ctx.bus.emit('orbifold:pulse', { kind: 'sheaf' });
          return send(c.amber('the gluing morphism is applied; the presheaf still fails the sheaf axiom globally.'), ctx, piped);
        }
        return send(c.gray('sheaf glue --force "<a degeneracy>"  — try "inhomogeneous metric degeneracy".'), ctx, piped);
      },
    },

    orbifold: {
      desc: 'orbifold scene control', usage: 'orbifold [reset|spin|calm]',
      run(args, ctx, piped) {
        const m = args[0] || 'status';
        if (['reset','spin','calm','wild'].includes(m)) { ctx.bus.emit('orbifold:mode', { mode: m });
          return send(c.cyan(`orbifold → ${m}`), ctx, piped); }
        return send(c.gray('orbifold [reset|spin|calm|wild]  — mouse-drag to orbit the camera.'), ctx, piped);
      },
    },
  };
}

// kernel access is now a single, verified step: `kernel auth <KERNEL_TOKEN>`.
// glue/sheaf/observe remain as flavor verbs that only perturb the 3D field.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
