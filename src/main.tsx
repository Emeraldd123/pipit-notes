import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import { App } from "./App";
import { requestPersistentStorage } from "./lib/db";

// Auto-update the service worker quietly; the app is fully usable offline.
registerSW({ immediate: true });

// Ask the browser to keep our storage (don't evict it under pressure). On iOS this
// is granted for installed (Home Screen) web apps — see Settings for status.
void requestPersistentStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
