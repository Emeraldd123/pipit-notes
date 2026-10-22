import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { requestPersistentStorage } from "./lib/db";
import { bootChecks } from "./lib/health";
import { startReporter } from "./lib/report";
import { count, info, installGlobalHandlers, logError } from "./lib/telemetry";

// Monitoring first, so anything that goes wrong during startup is captured.
installGlobalHandlers();

// Auto-update the service worker quietly; the app is fully usable offline.
registerSW({
  immediate: true,
  onRegisterError: (e) => logError("sw", e),
  onOfflineReady: () => info("sw", "ready to work offline"),
  onNeedRefresh: () => info("sw", "an update is available"),
});

// Ask the browser to keep our storage (don't evict it under pressure). On iOS this
// is granted for installed (Home Screen) web apps — see Settings for status.
void requestPersistentStorage();

// Data-loss tripwires (wiped storage / unsaved edits at last exit), then reporting.
void bootChecks().then(() => { count("app.start"); startReporter(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
