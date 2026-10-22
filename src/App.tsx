import { useEffect } from "react";
import { useRoute } from "./router";
import { Library } from "./pages/Library";
import { EditorPage } from "./pages/Editor";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { applyTheme, getSettings } from "./lib/settings";

export function App() {
  const route = useRoute();
  useEffect(() => { applyTheme(getSettings().theme); }, []);

  switch (route.name) {
    case "note": return <EditorPage id={route.id} page={route.page} />;
    case "search": return <SearchPage />;
    case "settings": return <SettingsPage />;
    default: return <Library notebook={route.notebook} q={route.q} />;
  }
}
