// The built-in past exams (MIT OpenCourseWare, CC BY-NC-SA 4.0; built by tools/ocw-extract.mjs). Served as a static
// file and cached by the service worker, so they work offline and never have to be imported on the iPad.
import type { PastExam } from "./past-exams";

export type BuiltinExam = PastExam & { subject: string; course: string; term: string; credit: string; source: string; solutions: boolean };

let cache: Promise<BuiltinExam[]> | null = null;

export function builtinExams(): Promise<BuiltinExam[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}ocw/exams.json`)
    .then((r) => (r.ok ? r.json() : { exams: [] }))
    .then((j: { exams?: BuiltinExam[] }) => (j.exams ?? []).map((e) => ({ ...e, id: e.id })))
    .catch(() => { cache = null; return []; });   // offline before the first load: try again next time
  return cache;
}
