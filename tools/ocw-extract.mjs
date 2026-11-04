// Builds the built-in past exams (public/ocw/exams.json) from MIT OpenCourseWare PDFs downloaded into data/ocw-src/
// (see data/ocw-src/list.tsv: subject, course slug, resource id, url, bytes). Text only; scans and PDFs whose
// fonts have no readable text are skipped.
//   node tools/ocw-extract.mjs            report what is readable
//   node tools/ocw-extract.mjs --write    also write public/ocw/exams.json
// The exam text is MIT OpenCourseWare material under CC BY-NC-SA 4.0 (see public/ocw/LICENSE.md), not the app's MIT licence.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const COURSES = {
  "18-05-introduction-to-probability-and-statistics-spring-2022": { code: "18.05", name: "Introduction to Probability and Statistics", term: "Spring 2022", by: "Jeremy Orloff and Jennifer French Kamrin" },
  "5-111sc-principles-of-chemical-science-fall-2014": { code: "5.111SC", name: "Principles of Chemical Science", term: "Fall 2014", by: "Catherine Drennan" },
  "7-012-introduction-to-biology-fall-2004": { code: "7.012", name: "Introduction to Biology", term: "Fall 2004", by: "Eric Lander, Robert Weinberg, Andrew Chess and Claudette Gardel" },
  "8-01l-physics-i-classical-mechanics-fall-2005": { code: "8.01L", name: "Physics I: Classical Mechanics", term: "Fall 2005", by: "George Stephans" },
  "14-01-principles-of-microeconomics-fall-2023": { code: "14.01", name: "Principles of Microeconomics", term: "Fall 2023", by: "Jonathan Gruber" },
};
// display titles, and which file holds each exam's solutions (practice files that already end in solutions stand alone)
const TITLES = {
  mit18_05_s22_exam01_pdf: "Exam 1", mit18_05_s22_exam02_pdf: "Exam 2", mit18_05_s22_exam_final_pdf: "Final exam",
  mit5_111f14_exam1: "Exam 1", mit5_111f14_exam2: "Exam 2", mit5_111f14_finalexam: "Final exam",
  quiz1prac: "Practice quiz 1", quiz2prac: "Practice quiz 2", quiz3prac: "Practice quiz 3", finalprac: "Practice final",
  practice_exam1: "Practice exam 1", practice_exam2: "Practice exam 2", practice_2_solut: "Practice exam 2", practice_final: "Practice final",
  mit14_01_f23_midterm_pdf: "Midterm", mit14_01_f23_final_pdf: "Final exam",
};
const SOLUTIONS_OF = {
  mit18_05_s22_exam01_sol_pdf: "mit18_05_s22_exam01_pdf", mit18_05_s22_exam02_sol_pdf: "mit18_05_s22_exam02_pdf", mit18_05_s22_exam_final_sol_pdf: "mit18_05_s22_exam_final_pdf",
  mit5_111f14_exam1sol: "mit5_111f14_exam1", mit5_111f14_exam2sol: "mit5_111f14_exam2", mit5_111f14_finalexamsol: "mit5_111f14_finalexam",
  practice_1_solut: "practice_exam1", practice_2_solut: "practice_exam2", prac_final_solut: "practice_final",
};
// these files contain the questions AND their solutions
const WITH_SOLUTIONS = new Set(["quiz1prac", "quiz2prac", "quiz3prac", "finalprac", "mit14_01_f23_midterm_pdf", "mit14_01_f23_final_pdf"]);
const SUBJECT = { stats: "Statistics", chem: "Chemistry", bio: "Biology", phys: "Physics", econ: "Economics" };

// characters that mean the PDF's font has no usable text mapping: the replacement char, private-use glyphs, controls
const JUNK = /[�-\u0000-\u0008]/g;

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
async function pages(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    const text = tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("");
    // NFKC turns maths letters (𝑋, 𝑃) into plain ones
    out.push(text.normalize("NFKC").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim());
  }
  return out;
}

const rows = readFileSync("data/ocw-src/list.tsv", "utf8").trim().split("\n").map((l) => l.split("\t"));
const items = [];
for (const [subj, course, res, url] of rows) {
  const p = await pages(`data/ocw-src/${subj}__${res}.pdf`);
  const chars = p.reduce((n, t) => n + t.length, 0);
  const perPage = chars / Math.max(1, p.length);
  const all = p.join("");
  const junk = (all.match(JUNK) ?? []).length / Math.max(1, all.replace(/\s/g, "").length);
  const readable = perPage > 250 && junk < 0.03;
  items.push({ subj, course, res, url, pages: p, solutions: /sol/i.test(res), readable });
  const verdict = perPage <= 250 ? "SCAN (no text)" : junk >= 0.03 ? `UNREADABLE FONT (${Math.round(junk * 100)}% junk)` : "ok";
  console.log(`${subj.padEnd(5)} ${res.padEnd(32)} ${String(p.length).padStart(2)} pages ${String(Math.round(perPage)).padStart(5)} chars/page  ${verdict}`);
}

if (process.argv.includes("--write")) {
  const ok = items.filter((i) => i.readable);
  const byRes = new Map(ok.map((i) => [i.res, i]));
  const exams = [];
  for (const i of ok) {
    const examRes = SOLUTIONS_OF[i.res];
    if (examRes && byRes.has(examRes)) continue;         // folded into its exam below
    const solved = Object.entries(SOLUTIONS_OF).find(([, e]) => e === i.res)?.[0];
    const sol = solved ? byRes.get(solved) : undefined;
    const c = COURSES[i.course];
    if (!TITLES[i.res]) throw new Error(`no title for ${i.res}`);
    exams.push({
      id: `ocw:${c.code}:${i.res}`, subject: SUBJECT[i.subj], course: `${c.code} ${c.name}`, term: c.term, title: `MIT ${c.code} ${TITLES[i.res]}`,
      // a solutions file with no readable exam stands in for it: its problems are restated with the answers
      solutions: !!sol || WITH_SOLUTIONS.has(i.res) || !!examRes,
      credit: `${c.by}. ${c.code} ${c.name}, ${c.term}. Massachusetts Institute of Technology: MIT OpenCourseWare. License: CC BY-NC-SA 4.0.`,
      source: `https://ocw.mit.edu/courses/${i.course}/`, pages: i.pages, ...(sol ? { solutionPages: sol.pages } : {}),
    });
  }
  mkdirSync("public/ocw", { recursive: true });
  writeFileSync("public/ocw/exams.json", JSON.stringify({ version: 1, exams }));
  console.log(`\nwrote public/ocw/exams.json: ${exams.length} exams, ${Math.round(JSON.stringify({ exams }).length / 1024)} KB`);
  for (const e of exams) console.log(`  ${e.title}`);
}
