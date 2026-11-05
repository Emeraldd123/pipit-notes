// Writes public/bioicons/LICENSE.md: every bundled icon with its author and licence (CC BY requires the credit).
//   node tools/bioicons-licence.mjs      (from the icons already in public/bioicons/icons.json; no download)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LIC = { "cc-0": "[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)", "cc-by-3.0": "[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)", "cc-by-4.0": "[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)", mit: "MIT", bsd: "BSD" };

export function writeLicence(icons) {
  const rows = icons.map((i) => `| ${i.name} | ${i.file} | ${i.author} | ${LIC[i.licence] ?? i.licence} |`).join("\n");
  writeFileSync("public/bioicons/LICENSE.md", `# Exam-diagram icons: Bioicons

\`icons.json\` holds icons from [Bioicons](https://bioicons.com) ([source](https://github.com/duerrsimon/bioicons)), used as
parts of the diagrams Pipit Notes draws in practice exams. They are **not** covered by the app's MIT licence: each icon
keeps its own licence below. CC BY icons require credit, which the app shows under every diagram that uses them.
Only open licences were included (CC0, CC BY, MIT, BSD; no share-alike). The SVGs were cleaned (comments, editor
metadata and any scripts or external references removed) but are otherwise unchanged.

Many CC BY 3.0 icons are by [Servier Medical Art](https://smart.servier.com/), shared through Bioicons.

| Name in the app | Bioicons file | Author | Licence |
|---|---|---|---|
${rows}

Rebuilt with \`node tools/bioicons-build.mjs\`.
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { icons } = JSON.parse(readFileSync("public/bioicons/icons.json", "utf8"));
  writeLicence(icons);
  console.log(`wrote public/bioicons/LICENSE.md (${icons.length} icons)`);
}
