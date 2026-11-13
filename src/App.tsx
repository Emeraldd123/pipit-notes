import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRoute } from "./router";
import { Library } from "./pages/Library";
import { applyTheme, getSettings } from "./lib/settings";

// Only the Library is in the first chunk. Every other screen is its own chunk, fetched the first
// time it is opened; the service worker precaches every chunk, so they all open offline after one
// load. The Editor (which carries KaTeX) is the screen people open next, so it is fetched in the
// background as soon as the Library has painted instead of waiting for the first tap on a note.
const loadEditor = () => import("./pages/Editor");
const EditorPage = lazy(() => loadEditor().then((m) => ({ default: m.EditorPage })));
const SearchPage = lazy(() => import("./pages/SearchPage").then((m) => ({ default: m.SearchPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const GraphPage = lazy(() => import("./pages/GraphPage").then((m) => ({ default: m.GraphPage })));
const StudyPage = lazy(() => import("./pages/StudyPage").then((m) => ({ default: m.StudyPage })));

// Same look as the Editor's own "Opening…" state, so the hand-over between the two is not a visible jump.
const PageLoading = () => (
  <div className="flex h-full items-center justify-center text-sm text-foreground-muted"><Loader2 size={16} className="mr-2 animate-spin" /> Loading…</div>
);

function warmEditor() {
  // A failure here (offline before the first full load) is harmless: opening a note asks again.
  const run = () => { void loadEditor().catch(() => undefined); };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 800); // Safari has no requestIdleCallback
}

export function App() {
  const route = useRoute();
  // Dev-only hook to exercise the crash screen (compiled out of production builds).
  if (import.meta.env.DEV && location.hash === "#/__crash") throw new Error("test crash (dev only)");
  useEffect(() => { applyTheme(getSettings().theme); }, []);
  useEffect(warmEditor, []);
  const [updateWaiting, setUpdateWaiting] = useState(false);
  useEffect(() => {
    const on = () => setUpdateWaiting(true);
    window.addEventListener("pipit:db-blocking", on);
    return () => window.removeEventListener("pipit:db-blocking", on);
  }, []);
  const banner = updateWaiting && (
    <div className="safe-t fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-3 bg-primary px-4 py-2 text-sm text-white">
      <span>A newer version of Pipit Notes is waiting to update.</span>
      <button onClick={() => location.reload()} className="rounded-lg bg-white/20 px-3 py-1.5 font-semibold [@media(pointer:coarse)]:min-h-11">Reload now</button>
    </div>
  );

  const page = ((): React.ReactNode => { switch (route.name) {
    case "note": return <EditorPage id={route.id} page={route.page} hl={route.hl} />;
    case "split":
      return (
        <div className="flex h-full">
          <div className="min-w-0 flex-1 border-r border-border"><EditorPage id={route.a} splitWith={route.b} /></div>
          <div className="min-w-0 flex-1"><EditorPage id={route.b} splitWith={route.a} /></div>
        </div>
      );
    case "graph": return <GraphPage mapId={route.map} />;
    case "search": return <SearchPage />;
    case "settings": return <SettingsPage />;
    case "study": return <StudyPage view={route.view} />;
    default: return <Library notebook={route.notebook} q={route.q} />;
  } })();
  return <>{banner}<Suspense fallback={<PageLoading />}>{page}</Suspense></>;
}
