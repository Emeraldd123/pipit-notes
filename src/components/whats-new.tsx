import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { APP } from "@/lib/telemetry";

/** Shown once after an update that moves things around, so nothing feels "gone". Bump the list with the version. */
const NOTES: { title: string; body: string }[] = [
  { title: "Real science icons in exam diagrams", body: "Exam diagrams can now use real scientific icons (cells, organelles, organs, organisms, lab glassware) from Bioicons, with credit shown under each diagram. Structures to identify are labelled with letters, like a real paper." },
  { title: "Fresh cases every exam", body: "Practice exams now remember the real-world situations they used, so the next exam on the same notes picks different ones. You practise the ideas, not a few favourite examples." },
  { title: "Explanations fold away", body: "A pinned explanation is now a small “Explain” chip on what you circled. Tap it to read it in the bottom half of the screen. Highlighted something? Tap the Explain button that pops up, or tap the highlight with the Explain tool." },
  { title: "Sticky notes", body: "＋ Insert → Sticky note. It sits on the page as a small chip and opens when you tap it." },
  { title: "Sizes stick per tool", body: "Pens, pencils, markers and highlighters each remember the size you last used." },
  { title: "Math check", body: "Turn it on under the wand. Each line of maths or chemistry you finish with = or an arrow is checked, and mistakes are boxed in red. Tap the red label for the fix. It uses the cheap model, a fraction of a cent per line." },
  { title: "Exports you can find", body: "PNG, SVG, LaTeX and PDF now open the share sheet, so pick Save to Files (or AirDrop, Mail)." },
  { title: "Exams shaped like real MIT exams", body: "Practice exams can copy the format of a real MIT OpenCourseWare exam: points, numbering, kinds of problem, wording. 15 exams with solutions are built in (statistics, chemistry, biology, physics, economics), and the closest one for your notes is picked automatically. The questions are always new and come from your notes. You can also add your own course's past exams with “Add past exam” in the Library." },
  { title: "LaTeX that looks typeset", body: "Save as LaTeX now keeps headings, lines up working at the = signs, and makes real tables, chemical equations and boxed definitions. Graphs, charts, flowcharts and simple circuits are redrawn neatly. Other drawings come in as clean pictures without the ruled lines. You check each diagram first. It saves a .zip: in Overleaf use New Project → Upload Project." },
  { title: "Tools moved into two menus", body: "Shapes, text, graph, maths, Python, images, templates, the ruler and the protractor are under the ＋ Insert button in the tool rail. Snap-to-shape and scribble-to-erase are under the wand." },
  { title: "Left-handed?", body: "Put the tool rail on the right in Settings → Appearance & handedness." },
  { title: "Deleting is undoable", body: "Deleted notes wait in “Recently deleted” for 30 days, and every delete has an Undo." },
  { title: "Study got smarter", body: "Reviews are now scheduled with FSRS (the method Anki moved to: fewer reviews for the same memory), and streak freezes save your streak if you miss a day." },
  { title: "Report what's wrong", body: "Flag a broken exam question and it stops counting toward your score. In Explain, “Not right? Ask again” gets a more careful answer." },
  { title: "Study, sorted", body: "Learn, Flashcards, Quizzes and Exams are now separate tabs. Each has its own notebook and topic picker. In a lesson, “Off topic” drops that unit and restarts. Study settings can reset your cards, exams and XP." },
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
