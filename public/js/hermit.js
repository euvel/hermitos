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
          ctx.state.ritual = ctx.state.ritual || {};
          ctx.state.ritual.collapse = true;
          ctx.bus.emit('orbifold:pulse', { kind: 'collapse' });
          tryElevate(ctx);
          return send(c.amber('baseline collapse requested. the projection trembles but holds.\nif the gluing preceded this, the kernel will wake.'), ctx, piped);
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
      desc: 'split view: clean resume | raw kernel',
      run(args, ctx, piped) {
        ctx.state.dissociated = !ctx.state.dissociated;
        ctx.bus.emit('dissociate', { on: ctx.state.dissociated });
        return send(ctx.state.dissociated
          ? c.amber('dissociated. left: the section you are allowed to read. right: the raw kernel stream.\nthe two do not glue. that is not a bug; it is the persona.')
          : c.gray('re-associated. the global section is, once again, refused — but hidden.'), ctx, piped);
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
        ctx.state.ritual = ctx.state.ritual || {};
        ctx.state.ritual.glued = [args[0], args[1]];
        ctx.bus.emit('orbifold:pulse', { kind: 'glue' });
        tryElevate(ctx);
        return send([
          c.amber(`attempting to glue ${args[0]} ⊔ ${args[1]} ...`),
          c.gray('  checking agreement on the overlap ............ consistent'),
          c.green('  local identification forced.'),
          c.gray('  but the global section still does not exist. you have only')
          + c.gray(' begun the ritual. continue: ') + c.green('sheaf glue --force "inhomogeneous metric degeneracy"'),
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
          ctx.state.ritual.phrase = true;
          ctx.bus.emit('orbifold:pulse', { kind: 'sheaf' });
          tryElevate(ctx);
          return send([
            c.amber('the kernel hears the first degeneracy named correctly.'),
            c.gray('two of three steps complete. finish with: ') + c.green('observe --collapse-baseline'),
          ].join('\n'), ctx, piped);
        }
        return send(c.red('the kernel does not recognize that phrase. name the degeneracies exactly as the README does.'), ctx, piped);
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

    boot: {
      desc: 'boot a kernel', usage: 'boot kernel [--real]',
      async run(args, ctx, piped) {
        if (args[0] !== 'kernel') return send(c.gray('usage: boot kernel [--real]'), ctx, piped);
        if (args.includes('--real')) {
          const { bootRealLinux } = await import('./vm.js');   // lazy: v86 only when asked
          await bootRealLinux(ctx);
          return '';
        }
        const seq = [
          'SeaBIOS (HERMIT-OS edition)',
          'Loading non-ergodic singular orbifold .....',
          'Probing degenerate metric tensor ......... ok',
          'Mounting invariant trapping sets ......... ok (ro, entry-only)',
          'Starting AIWASS resident intelligence .... ok',
          'Refusing to glue global section .......... by design',
          'observable baseline ...................... const',
        ];
        for (const s of seq) { ctx.term.write(c.gray('[boot] ') + c.cyan(s) + '\r\n'); await sleep(140); }
        return send(c.green('kernel booted into the projection. you are already inside it.'), ctx, piped);
      },
    },
  };
}

function tryElevate(ctx) {
  const r = ctx.state.ritual || {};
  if (r.glued && r.phrase && r.collapse && !ctx.state.elevated) {
    ctx.state.elevated = true;
    ctx.bus.emit('elevate', { on: true });
    setTimeout(() => {
      ctx.shell.out('');
      ctx.shell.out(c.red('████ THE LOCAL SECTIONS HAVE GLUED ████'));
      ctx.shell.out(c.amber('the global section that should not exist… momentarily does.'));
      ctx.shell.out(c.green('elevation granted. you are now in KERNEL MODE.'));
      ctx.shell.out(c.gray('verbs unlocked: ') + c.green('kernel edit') + c.gray(' · ') + c.green('kernel add') + c.gray(' · ') + c.green('aiwass retrain') + c.gray(' · ') + c.green('kernel ls'));
      ctx.shell.out(c.gray('the prompt has changed. so have you.'));
    }, 200);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
