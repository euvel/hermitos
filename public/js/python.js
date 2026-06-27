/* ===================================================================
   HERMIT-OS — REAL Python, in the browser, via Pyodide (CPython→WASM)
   `python3 -c "..."`   run a snippet
   `python3 <file>`     run a file from the projection FS
   `python3`            interactive REPL (real codeop/displayhook semantics)
   This executes genuine CPython. Nothing is simulated. Needs network on
   first use to fetch the ~10MB runtime from the jsDelivr CDN.
   =================================================================== */

import { c } from './shell.js';
import { resolve, readFile } from './filesystem.js';

const PYODIDE_VER = '0.26.4';
const BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VER}/full/`;

const REPL_SETUP = `
import sys, codeop, traceback
__hermit_cc = codeop.CommandCompiler()
__hermit_buf = []
__hermit_ns = {"__name__": "__main__"}
def __hermit_feed(line):
    __hermit_buf.append(line)
    source = "\\n".join(__hermit_buf)
    try:
        code = __hermit_cc(source, "<hermit>", "single")
    except (OverflowError, SyntaxError, ValueError):
        __hermit_buf.clear()
        traceback.print_exc()
        return "done"
    if code is None:
        return "more"
    __hermit_buf.clear()
    try:
        exec(code, __hermit_ns)
    except SystemExit:
        return "exit"
    except BaseException:
        traceback.print_exc()
    return "done"
`;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('network'));
    document.head.appendChild(s);
  });
}

async function ensurePyodide(ctx) {
  if (ctx.state.pyodide) return ctx.state.pyodide;
  if (ctx.state.pyLoadError) throw new Error(ctx.state.pyLoadError);

  ctx.shell.out(c.gray('python3: fetching the real CPython runtime (Pyodide ' + PYODIDE_VER + ', ~10MB) …'));
  ctx.shell.out(c.gray('         (cached by the browser after first load)'));
  try {
    if (!window.loadPyodide) await loadScript(BASE + 'pyodide.js');
    const py = await window.loadPyodide({ indexURL: BASE });
    // route stdout/stderr to the terminal
    py.setStdout({ batched: (s) => ctx.term.write(s.replace(/\n/g, '\r\n')) });
    py.setStderr({ batched: (s) => ctx.term.write(c.red(s.replace(/\n/g, '\r\n'))) });
    await py.runPythonAsync(REPL_SETUP);
    ctx.state.pyodide = py;
    ctx.shell.out(c.green(`Python ${py.version} on WASM — real CPython, running in your browser.`));
    return py;
  } catch (e) {
    ctx.state.pyLoadError = 'python3 runtime unavailable (needs network to fetch Pyodide; it is not bundled).';
    throw new Error(ctx.state.pyLoadError);
  }
}

export function pythonCommands(send) {
  const py3 = {
    desc: 'real CPython (Pyodide) — REPL, -c, or run a file',
    usage: 'python3 [-c "code"] [file]   ·   bare `python3` = interactive REPL',
    async run(args, ctx, piped) {
      let pyodide;
      try { pyodide = await ensurePyodide(ctx); }
      catch (e) { return send(c.red(String(e.message || e)), ctx, piped); }

      // python3 -c "code"
      if (args[0] === '-c') {
        const code = args.slice(1).join(' ');
        try { await pyodide.runPythonAsync(code); }
        catch (e) { ctx.shell.out(c.red(String(e.message || e).split('\n').slice(-3).join('\n'))); }
        return '';
      }

      // python3 <file>
      const fileArg = args.find(a => !a.startsWith('-'));
      if (fileArg) {
        const node = resolve(ctx.shell.cwd.startsWith('/') ? joinPath(ctx.shell.cwd, fileArg) : fileArg);
        const src = readFile(node, ctx.state);
        if (src == null) return send(c.red(`python3: can't open file '${fileArg}': No such file`), ctx, piped);
        try { await pyodide.runPythonAsync(src); }
        catch (e) { ctx.shell.out(c.red(String(e.message || e).split('\n').slice(-3).join('\n'))); }
        return '';
      }

      // interactive REPL via shell sub-mode
      ctx.shell.out(c.gray('interactive Python — real CPython. ') + c.cyan('exit()') + c.gray(' or Ctrl-D to leave.'));
      ctx.shell.out(c.gray('try: ') + c.cyan('import sys; sys.version') + c.gray('  ·  ') + c.cyan('sum(range(100))') + c.gray('  ·  ') + c.cyan('[x*x for x in range(8)]'));
      ctx.shell.enterSubmode({
        prompt: c.cyan('>>> '),
        async onLine(line) {
          if (line.trim() === 'exit()' || line.trim() === 'quit()') { ctx.shell.exitSubmode(); return; }
          let status = 'done';
          try { status = await pyodide.runPythonAsync(`__hermit_feed(${JSON.stringify(line)})`); }
          catch (e) { ctx.shell.out(c.red(String(e.message || e))); }
          ctx.shell.submode && (ctx.shell.submode.prompt = status === 'more' ? c.cyan('... ') : c.cyan('>>> '));
          if (status === 'exit') ctx.shell.exitSubmode();
        },
        onExit() { ctx.shell.out(c.gray('left the Python REPL.')); },
      });
      return '';
    },
  };
  return { python3: py3, python: py3 };
}

function joinPath(cwd, p) {
  if (p.startsWith('/')) return p;
  return (cwd === '/' ? '' : cwd) + '/' + p;
}
