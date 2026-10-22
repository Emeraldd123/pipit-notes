import { useEffect, useState } from "react";
import { useRoute } from "./router";
import { Library } from "./pages/Library";
import { EditorPage } from "./pages/Editor";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { GraphPage } from "./pages/GraphPage";
import { StudyPage } from "./pages/StudyPage";
import { applyTheme, getSettings } from "./lib/settings";

export function App() {
  const route = useRoute();
  // Dev-only hook to exercise the crash screen (compiled out of production builds).
  if (import.meta.env.DEV && location.hash === "#/__crash") throw new Error("test crash (dev only)");
  useEffect(() => { applyTheme(getSettings().theme); }, []);
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
  return <>{banner}{page}</>;
}
