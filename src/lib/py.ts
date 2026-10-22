// Python (and SymPy, NumPy, SciPy, Matplotlib) running locally in WebAssembly via
// Pyodide. First use downloads the runtime from jsDelivr (~10 MB + packages); the
// service worker caches it so code blocks and the step-checker then work offline.
// Everything runs on-device — nothing is sent anywhere.

import { count, error as logErr, info, logError, track, warn } from "./telemetry";

const VERSION = "0.29.5";
const BASE = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;

// The slice of the Pyodide API we use.
export type Py = {
  runPythonAsync(code: string, opts?: { globals?: unknown }): Promise<unknown>;
  loadPackagesFromImports(code: string, opts?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<void>;
  loadPackage(names: string | string[], opts?: { messageCallback?: (m: string) => void }): Promise<void>;
  setStdout(o: { batched: (s: string) => void }): void;
  setStderr(o: { batched: (s: string) => void }): void;
  globals: { get(name: string): unknown; set(name: string, v: unknown): void };
  toPy?: (v: unknown) => unknown;
};

let pyP: Promise<Py> | null = null;
export type Status = (msg: string) => void;

export function loadPy(onStatus?: Status): Promise<Py> {
  if (!pyP) {
    pyP = (async () => {
      onStatus?.("Loading Python (the first time downloads about 10 MB)…");
      const mod = await import(/* @vite-ignore */ `${BASE}pyodide.mjs`);
      const py = (await mod.loadPyodide({ indexURL: BASE })) as Py;
      await py.runPythonAsync(`import os\nos.environ["MPLBACKEND"] = "AGG"`);
      return py;
    })().catch((e) => {
      pyP = null; // allow a retry (e.g. you were offline the first time)
      throw e;
    });
  }
  return pyP;
}

export type RunResult = { text: string; images: string[]; error?: string };

// Serialise runs: Pyodide is single-threaded and stdout redirection is global.
let queue: Promise<unknown> = Promise.resolve();

export function runPython(code: string, onStatus?: Status): Promise<RunResult> {
  const job = queue.then(() => runNow(code, onStatus));
  queue = job.catch(() => undefined);
  return job;
}

async function runNow(code: string, onStatus?: Status): Promise<RunResult> {
  const py = await loadPy(onStatus);
  const t0 = performance.now();
  count("python.run");
  const out: string[] = [];
  let error: string | undefined;
  try {
    await py.loadPackagesFromImports(code, { messageCallback: onStatus });
  } catch (e) {
    warn("python", "a package failed to load", { err: String((e as Error)?.message ?? e).slice(0, 120), online: navigator.onLine });
    onStatus?.(`Couldn't load a package: ${(e as Error).message}`);
  }
  py.setStdout({ batched: (s) => out.push(s) });
  py.setStderr({ batched: (s) => out.push(s) });
  try {
    const result = await py.runPythonAsync(code);
    if (result !== undefined && result !== null) {
      const r = result as { toString?: () => string; destroy?: () => void };
      out.push(String(r.toString ? r.toString() : result));
      r.destroy?.();
    }
  } catch (e) {
    // Keep only the user-facing part of the traceback (drop Pyodide internals).
    const msg = String((e as Error).message ?? e);
    const lines = msg.split("\n").filter((l) => !/_pyodide|pyodide\/|\/lib\/python3/.test(l));
    error = lines.join("\n").trim();
  }
  let images: string[] = [];
  try {
    const got = (await py.runPythonAsync(`
import sys, io, base64
_pn_imgs = []
if 'matplotlib.pyplot' in sys.modules:
    import matplotlib.pyplot as _plt
    for _n in _plt.get_fignums():
        _b = io.BytesIO()
        _plt.figure(_n).savefig(_b, format='png', dpi=110, bbox_inches='tight')
        _pn_imgs.append(base64.b64encode(_b.getvalue()).decode())
    _plt.close('all')
_pn_imgs
`)) as { toJs?: () => string[]; destroy?: () => void } | undefined;
    images = (got?.toJs?.() ?? []).map((b) => `data:image/png;base64,${b}`);
    got?.destroy?.();
  } catch {
    /* no plots */
  }
  return { text: out.join("\n").replace(/\n+$/, ""), images, error };
}

/**
 * Run Python that returns a JSON string and parse it. `vars` are injected as
 * Python string globals first (so large inputs never need escaping into source).
 */
export async function evalPyJson<T>(code: string, vars: Record<string, string>, packages: string[] = [], onStatus?: Status): Promise<T> {
  const job = queue.then(async () => {
    const py = await loadPy(onStatus);
    if (packages.length) await py.loadPackage(packages, { messageCallback: onStatus });
    for (const [k, v] of Object.entries(vars)) py.globals.set(k, v);
    const out = await py.runPythonAsync(code);
    const s = typeof out === "string" ? out : String((out as { toString?: () => string })?.toString?.() ?? out);
    return JSON.parse(s) as T;
  });
  queue = job.catch(() => undefined);
  return job;
}
