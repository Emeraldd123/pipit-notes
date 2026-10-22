import { useEffect } from "react";
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

  switch (route.name) {
    case "note": return <EditorPage id={route.id} page={route.page} />;
    case "split":
      return (
        <div className="flex h-full">
          <div className="min-w-0 flex-1 border-r border-border"><EditorPage id={route.a} splitWith={route.b} /></div>
          <div className="min-w-0 flex-1"><EditorPage id={route.b} splitWith={route.a} /></div>
        </div>
      );
    case "graph": return <GraphPage />;
    case "search": return <SearchPage />;
    case "settings": return <SettingsPage />;
    case "study": return <StudyPage />;
    default: return <Library notebook={route.notebook} q={route.q} />;
  }
}
