import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { requestPersistentStorage } from "./lib/db";
import { bootChecks } from "./lib/health";
import { startReporter } from "./lib/report";
import { count, info, installGlobalHandlers, logError, warn } from "./lib/telemetry";

// Monitoring first, so anything that goes wrong during startup is captured.
installGlobalHandlers();

// Anything the Content-Security-Policy blocks (or, while it is report-only, would block) goes
// into the diagnostics log, so a policy gap shows up on an iPad with no console. See netlify.toml.
const cspSeen = new Set<string>();
document.addEventListener("securitypolicyviolation", (e) => {
  try {
    // only the origin of what was blocked ("data", "blob", "inline", "eval" come through as they are)
    let blocked = (e.blockedURI || "").slice(0, 200);
    try { if (/^https?:/i.test(blocked)) blocked = new URL(blocked).origin; } catch { /* keep the raw value */ }
    const key = `${e.effectiveDirective}|${blocked}|${e.disposition}`;
    if (cspSeen.has(key) || cspSeen.size >= 40) return; // once per kind, and never a flood
    cspSeen.add(key);
    const source = e.sourceFile ? `${e.sourceFile.split(/[?#]/)[0].slice(-80)}:${e.lineNumber}` : undefined;
    warn("csp", e.disposition === "enforce" ? "blocked by the content security policy" : "would be blocked by the content security policy", { directive: e.effectiveDirective, blocked, source });
  } catch { /* monitoring must never break the app */ }
});

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
