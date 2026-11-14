// In-app replacements for the browser's confirm() and prompt(), which look like a website's pop-ups in an installed
// app. Call confirmBox / askText from anywhere; one <DialogHost /> (in App) shows them. Both return promises.
import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";

type ConfirmReq = { kind: "confirm"; title: string; body?: string; ok: string; danger: boolean; resolve: (v: boolean) => void };
type AskReq = { kind: "ask"; title: string; label?: string; value: string; placeholder?: string; ok: string; resolve: (v: string | null) => void };
type Req = ConfirmReq | AskReq;

let show: ((r: Req) => void) | null = null;
const queue: Req[] = [];

/** Ask a yes/no question. `danger` makes the confirm button red (deleting, leaving with unsaved work). */
export function confirmBox(title: string, opts: { body?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const r: Req = { kind: "confirm", title, body: opts.body, ok: opts.ok ?? "OK", danger: !!opts.danger, resolve };
    if (show) show(r); else queue.push(r);
  });
}

/** Ask for a line of text. Resolves to the text, or null if cancelled. */
export function askText(title: string, opts: { label?: string; value?: string; placeholder?: string; ok?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const r: Req = { kind: "ask", title, label: opts.label, value: opts.value ?? "", placeholder: opts.placeholder, ok: opts.ok ?? "OK", resolve };
    if (show) show(r); else queue.push(r);
  });
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    show = (r) => { setReq((cur) => { if (cur) { queue.push(r); return cur; } if (r.kind === "ask") setText(r.value); return r; }); };
    const first = queue.shift(); if (first) show(first);
    return () => { show = null; };
  }, []);
  useEffect(() => {
    if (!req) return;
    // focus the field (selected, ready to overtype) or the confirm button, so Enter and Escape just work
    const t = setTimeout(() => { if (req.kind === "ask") { input.current?.focus(); input.current?.select(); } else okBtn.current?.focus(); }, 30);
    return () => clearTimeout(t);
  }, [req]);
  if (!req) return null;
  const finish = (v: boolean | string | null) => {
    if (req.kind === "confirm") req.resolve(v === true); else req.resolve(typeof v === "string" ? v : null);
    const next = queue.shift();
    if (next?.kind === "ask") setText(next.value);
    setReq(next ?? null);
  };
  return (
    <Modal title={req.title} onClose={() => finish(req.kind === "confirm" ? false : null)}>
      <form onSubmit={(e) => { e.preventDefault(); finish(req.kind === "ask" ? text : true); }}>
        {req.kind === "confirm" && req.body && <p className="text-sm text-foreground-muted">{req.body}</p>}
        {req.kind === "ask" && (
          <label className="block text-sm">
            {req.label && <span className="mb-1 block text-foreground-muted">{req.label}</span>}
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={req.placeholder} enterKeyHint="done" autoCapitalize="sentences"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary [@media(pointer:coarse)]:min-h-11" />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={() => finish(req.kind === "confirm" ? false : null)}>Cancel</Button>
          <Button type="submit" ref={okBtn} variant={req.kind === "confirm" && req.danger ? "danger" : "primary"}>{req.ok}</Button>
        </div>
      </form>
    </Modal>
  );
}
