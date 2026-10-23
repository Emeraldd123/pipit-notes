import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { APP } from "@/lib/telemetry";

/** Shown once after an update that moves things around, so nothing feels "gone". Bump the list with the version. */
const NOTES: { title: string; body: string }[] = [
  { title: "Tools moved into two menus", body: "Shapes, text, graph, maths, Python, images, templates, the ruler and the protractor are under the ＋ Insert button in the tool rail. Snap-to-shape and scribble-to-erase are under the wand." },
  { title: "Left-handed?", body: "Put the tool rail on the right in Settings → Appearance & handedness." },
  { title: "Deleting is undoable", body: "Deleted notes wait in “Recently deleted” for 30 days, and every delete has an Undo." },
  { title: "Study got smarter", body: "Reviews are now scheduled with FSRS (the method Anki moved to: fewer reviews for the same memory), and streak freezes save your streak if you miss a day." },
  { title: "Report what's wrong", body: "Flag a broken exam question and it stops counting toward your score. In Explain, “Not right? Ask again” gets a more careful answer." },
  { title: "Textbooks", body: "“Add textbook” in the Library brings in a book's text only (fast and small). Practice exams can then use its real problems, but only ones your notes cover. Add a book on your laptop and move the small file it saves to your iPad." },
  { title: "Tougher answer choices", body: "Multiple-choice wrong answers now come from real mistakes, not from other cards. Older cards can get theirs with “Write answer choices” in the Cards tab." },
  { title: "Lower AI bills", body: "Simple jobs use a cheaper model, repeats are free, and Settings shows what you've spent this month (you can set a budget)." },
];
const KEY = "pipit.seenVersion";

export function WhatsNew({ hasNotes }: { hasNotes: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem(KEY);
      if (seen === APP.version || APP.version === "dev") return;
      if (!hasNotes) { localStorage.setItem(KEY, APP.version); return; }   // a brand-new user has nothing to re-learn
      setOpen(true);
    } catch { /* private mode: just don't show it */ }
  }, [hasNotes]);
  if (!open) return null;
  const close = () => { try { localStorage.setItem(KEY, APP.version); } catch { /* */ } setOpen(false); };
  return (
    <Modal title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-primary" /> What&apos;s new in Pipit Notes {APP.version}</span>} onClose={close}>
      <ul className="space-y-3">
        {NOTES.map((n) => (
          <li key={n.title} className="text-sm"><p className="font-semibold">{n.title}</p><p className="text-foreground-muted">{n.body}</p></li>
        ))}
      </ul>
      <Button variant="primary" className="mt-5 w-full" onClick={close}>Got it</Button>
    </Modal>
  );
}
