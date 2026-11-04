# Built-in past exams: MIT OpenCourseWare

`exams.json` in this folder holds the text of past exams and solutions from MIT OpenCourseWare courses. Pipit Notes
shows them to its exam writer as examples of exam *format* only; practice exams copy how these papers are built and
never their questions.

This material is **not** covered by the app's MIT licence. It is licensed under
[Creative Commons Attribution-NonCommercial-ShareAlike 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
(CC BY-NC-SA 4.0), as published by MIT OpenCourseWare. It may only be used non-commercially, with credit, and any
adaptation must be shared under the same licence. The text was extracted automatically from the PDFs (layout,
figures and some maths formatting are lost). See [ocw.mit.edu/terms](https://ocw.mit.edu/terms) for MIT's terms.

| Course | Term | Instructors | Exams |
|---|---|---|---|
| [18.05 Introduction to Probability and Statistics](https://ocw.mit.edu/courses/18-05-introduction-to-probability-and-statistics-spring-2022/) | Spring 2022 | Jeremy Orloff, Jennifer French Kamrin | Exam 1, Exam 2, Final (each with solutions) |
| [5.111SC Principles of Chemical Science](https://ocw.mit.edu/courses/5-111sc-principles-of-chemical-science-fall-2014/) | Fall 2014 | Catherine Drennan | Exam 1, Exam 2, Final (each with solutions) |
| [7.012 Introduction to Biology](https://ocw.mit.edu/courses/7-012-introduction-to-biology-fall-2004/) | Fall 2004 | Eric Lander, Robert Weinberg, Andrew Chess, Claudette Gardel | Practice quizzes 1–3, practice final (solutions included) |
| [8.01L Physics I: Classical Mechanics](https://ocw.mit.edu/courses/8-01l-physics-i-classical-mechanics-fall-2005/) | Fall 2005 | George Stephans | Practice exams 1–2, practice final (with solutions) |
| [14.01 Principles of Microeconomics](https://ocw.mit.edu/courses/14-01-principles-of-microeconomics-fall-2023/) | Fall 2023 | Jonathan Gruber | Midterm, final (solutions included) |

Credit line for each exam, as shown in the app: *Instructors. Course number and name, term. Massachusetts Institute of
Technology: MIT OpenCourseWare. License: CC BY-NC-SA 4.0.*

Rebuilt with `node tools/ocw-extract.mjs --write` from PDFs downloaded into `data/ocw-src/` (not committed).
