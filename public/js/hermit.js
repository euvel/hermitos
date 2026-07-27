/* ===================================================================
   HERMIT-OS — custom orbifold verbs
   These perturb the 3D dynamical system and drive the elevation ritual.
   =================================================================== */

import { c } from './shell.js';
import { benettinLorenz, RHO_CRIT } from './dynamics.js';
import { observerReadout } from './observer.js';

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
        // the "internal state" is no longer faked — it is the REAL interior
        // energy the watch has measured off you (see `observer`).
        const o = ctx.state.observer;
        const i = (o ? o.internal : 0).toFixed(6);
        ctx.bus.emit('orbifold:pulse', { kind: 'observe' });
        return send([
          c.cyan('observable measurement'),
          `  observable_value ...... ${c.green('const')}`,
          `  observed_gradient ..... ${c.green(g)}  ${c.gray('(clamped; Lipschitz L=1)')}`,
          `  internal_state ........ ${c.amber(i)}  ${c.gray('(your own measured interior energy — real, sampled live)')}`,
          c.gray('  the act of observing perturbs the interior but not the projection.'),
          c.gray('  the interior is reading you back — ') + c.green('observer') + c.gray(' shows what it has measured.'),
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
      desc: 'drive the interior across its bifurcation and MEASURE the chaos', usage: 'induce turbulence',
      async run(args, ctx, piped) {
        if (args[0] && args[0] !== 'turbulence') return send(c.gray('usage: induce turbulence'), ctx, piped);
        const t = ctx.term;
        t.write('\r\n' + c.cyan('driving the interior (a real Lorenz flow) across its bifurcation') + c.gray(' — measuring the largest Lyapunov exponent live (Benettin).') + '\r\n\r\n');
        const sweep = [10, 14, 20, 24, 28];
        let lam = 0;
        for (const rho of sweep) {
          lam = benettinLorenz(rho, { time: 60 });          // a real measurement, not a script
          const chaotic = lam > 0.02;
          const col = chaotic ? c.red : lam < -0.02 ? c.green : c.amber;
          const n = Math.max(0, Math.min(10, Math.round((lam + 0.5) * 6)));
          const bar = col('█'.repeat(n)) + c.gray('░'.repeat(10 - n));
          t.write('  ρ=' + String(rho).padStart(2) + '   λ₁ = ' + col((lam >= 0 ? '+' : '') + lam.toFixed(3)).padEnd(0) + '  ' + bar + '  ' +
            (chaotic ? c.red('sensitive dependence — turbulent') : c.green('trajectories converge — laminar')) + '\r\n');
          ctx.bus.emit('orbifold:stress', { v: Math.max(0, Math.min(1, lam)) });
          await sleep(340);
        }
        ctx.state.turbulence = lam > 0;
        ctx.bus.emit('turbulence', { on: ctx.state.turbulence });
        t.write('\r\n' + c.gray('  measured, not asserted: past ρ ≈ ') + c.cyan(RHO_CRIT.toFixed(2)) + c.gray(' the largest Lyapunov exponent turns positive —') + '\r\n');
        t.write(c.gray('  nearby interior states diverge exponentially. the interior is turbulent; the ') + c.green('observable stays bounded') + c.gray('.') + '\r\n');
        t.write(c.gray('  quiesce with ') + c.green('chaos recover') + c.gray('  ·  see it in phase space with ') + c.green('lyapunov') + c.gray('.') + '\r\n');
        return '';
      },
    },

    observer: {
      desc: 'the projection reads you back — this instance + what it has measured',
      run(args, ctx, piped) {
        ctx.bus.emit('orbifold:pulse', { kind: 'observer' });
        return send(observerReadout(ctx), ctx, piped);
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
