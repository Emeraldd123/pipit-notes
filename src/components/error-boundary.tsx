import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { logError } from "@/lib/telemetry";
import { useDiagFlow } from "@/components/diag-flow";
import { Button, Toast, Wordmark } from "@/components/ui";

/** A rendering crash would otherwise leave a blank page. Show a recovery screen and log it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    logError("ui", error, { component: String(info.componentStack ?? "").split("\n").slice(0, 4).join(" ").slice(0, 280) });
  }
  render() {
    return this.state.crashed ? <CrashScreen /> : this.props.children;
  }
}

function CrashScreen() {
  const [toast, setToast] = useState<string | null>(null);
  const diag = useDiagFlow((m) => { setToast(m); setTimeout(() => setToast(null), 3500); }, "crash");
  return (
    <div className="paper-bg flex min-h-full items-center justify-center px-6 py-10">
      <div className="max-w-md rounded-2xl border border-border bg-surface px-7 py-8 text-center shadow-sm">
        <Wordmark size="sm" />
        <AlertTriangle className="mx-auto mt-6 text-negative" size={28} />
        <h1 className="serif mt-3 text-3xl">Something went wrong</h1>
        <p className="mt-2 text-sm text-foreground-muted">Your notes are safe — they&apos;re stored on this device and were saved as you wrote. The problem was logged. Reloading usually fixes it.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => { location.hash = "#/"; location.reload(); }}>Reload</Button>
          <Button onClick={diag.start} disabled={diag.building}>{diag.building ? "Building…" : "Save a problem report"}</Button>
        </div>
        <p className="mt-4 text-xs text-foreground-muted">The report has no note content — only what broke, timings and device info.</p>
      </div>
      {diag.modal}
      <Toast msg={toast} />
    </div>
  );
}
