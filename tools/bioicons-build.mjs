// Builds the app's exam-diagram icon set from Bioicons (https://bioicons.com, github.com/duerrsimon/bioicons):
// one icon per exam concept below, open licences only (CC0, CC BY, MIT, BSD; share-alike skipped), small SVGs,
// sanitised. Writes public/bioicons/icons.json (name, svg as a data URL, licence, author) and src/lib/bioicon-names.ts
// (the names the exam writer may use).
//   node tools/bioicons-build.mjs          (needs network: GitHub)
import { mkdirSync, writeFileSync } from "node:fs";
import { writeLicence } from "./bioicons-licence.mjs";

// concept name (what the exam writer asks for) -> pattern for Bioicons file names, most specific first
const CONCEPTS = {
  // cells and organelles
  // (the only general cell icon is a columnar epithelial cell with microvilli, so it is named for what it shows)
  "epithelial cell": /^(simple_cell|animal_cell|cell)\b/i, "plant cell": /plant_cell/i, "mitochondrion": /mitochond/i, "chloroplast": /chloroplast/i,
  "nucleus": /^nucleus/i, "ribosome": /ribosom/i, "golgi apparatus": /golgi/i, "endoplasmic reticulum": /endoplasm|_er\b|^er\b/i,
  "lysosome": /lysosom/i, "vesicle": /vesicle/i, "centrosome": /centrosom|centriole/i, "vacuole": /vacuole/i,
  // membranes and transport
  // (no good bilayer, water-molecule, leaf, tree or circuit-bulb icon exists in Bioicons: the writer draws those)
  "phospholipid": /phospholipid/i, "ion channel": /calcium_channel|ion_channel|^channel/i,
  "receptor": /^receptor|gpcr|receptor/i, "transporter": /transporter|pump/i, "atp synthase": /atp_synth/i,
  // molecules
  "atp": /^atp\b/i, "dna": /^dna|double_helix|dsdna/i, "rna": /^rna$/i, "trna": /^tRNA$/, "chromosome": /chromosom/i, "protein": /^protein\b|globular/i,
  "enzyme": /^enzyme-green$/i, "antibody": /^antibody\b|^igg/i, "glucose": /glucose/i, "amino acid": /^(alanine|glycine)/i,
  "lipid droplet": /lipid_droplet/i,
  // organisms and cell types
  "bacterium": /^(bacteria|bacterium|e_?coli|rod_bacteria)/i, "virus": /^virus|virion|bacteriophage|phage/i, "yeast": /yeast/i,
  "red blood cell": /red_?blood|erythrocyte|redbloodcell/i, "white blood cell": /white_?blood|leukocyte|neutrophil/i, "platelet": /platelet/i,
  "neuron": /^neuron|neurone/i, "muscle cell": /muscle_cell|myocyte|cardiomyocyte/i, "sperm": /^sperm/i, "egg cell": /oocyte|egg_cell/i,
  "stem cell": /stem_cell/i, "root": /^root/i, "flower": /^flower/i,
  "mouse": /^mouse\b/i, "rat": /^rat\b/i, "fish": /^(fish|zebrafish)/i, "frog": /frog|xenopus/i, "fly": /drosophila|fruit_fly/i,
  "worm": /c_?elegans|nematode|worm/i, "human": /^(human|person|man|woman)\b/i,
  // organs and body
  "heart": /^heart/i, "lung": /^lungs?\b/i, "kidney": /^kidney/i, "liver": /^liver/i, "brain": /^brain/i, "stomach": /^stomach/i,
  "intestine": /intestin|gut/i, "pancreas": /pancreas/i, "blood vessel": /blood_vessel|artery|vein|capillar/i, "skin": /^skin/i, "bone": /^bone/i,
  "eye": /^eye/i, "muscle": /^muscle\b|skeletal_muscle/i,
  // lab apparatus
  "beaker": /^beaker/i, "conical flask": /erlenmeyer|conical_flask|^flask/i, "round-bottom flask": /round_bottom/i, "test tube": /test_?tube/i,
  "pipette": /^pipette-glass$/i, "micropipette": /^micropipette$/i, "petri dish": /petri|cc_dish/i,
  // (no light microscope or upright burette exists in Bioicons: the writer draws those)
  "thermometer": /thermometer/i, "bunsen burner": /bunsen/i, "balance": /scale-balanced|^balance|weighing/i, "cuvette": /cuvette/i,
  "spectrophotometer": /spectrophotometer|spectrometer/i, "centrifuge": /centrifuge/i, "water bath": /water_bath/i, "syringe": /^syringe/i,
  "measuring cylinder": /measuring_cylinder|graduated_cylinder/i, "well plate": /well_plate/i, "gel electrophoresis": /electrophoresis|gel_box/i,
  "fume hood": /fume_hood/i, "hot plate": /hot_?plate|magnetic_stirrer/i, "electrode": /electrode/i, "pH meter": /ph_meter/i,
  // other science
  "sun": /^sun\b/i, "magnet": /^magnet/i,
};
const OK_LICENCES = ["cc-0", "mit", "bsd", "cc-by-4.0", "cc-by-3.0"];   // preference order
const MAX_BYTES = 30000;
// a few concepts only exist as slightly bigger files
const BIGGER = { "ion channel": 60000, "bunsen burner": 60000, "balance": 60000 };

const tree = await (await fetch("https://api.github.com/repos/duerrsimon/bioicons/git/trees/main?recursive=1", { headers: { "User-Agent": "PipitNotes-build" } })).json();
const files = tree.tree.filter((x) => x.path.startsWith("static/icons/") && x.path.endsWith(".svg")).map((x) => {
  const [, , licence, category, author, ...rest] = x.path.split("/");
  return { path: x.path, size: x.size, licence, category, author: author.replace(/[-_]/g, " "), file: rest.join("/").replace(/\.svg$/, "") };
}).filter((f) => OK_LICENCES.includes(f.licence) && f.size > 300 && f.size < 60000 && !/3d|_dark|_black|outline/i.test(f.file));

const chosen = [];
for (const [name, re] of Object.entries(CONCEPTS)) {
  const hits = files.filter((f) => re.test(f.file) && f.size < (BIGGER[name] ?? MAX_BYTES));
  if (!hits.length) { console.log(`  (no icon for ${name})`); continue; }
  hits.sort((a, b) => OK_LICENCES.indexOf(a.licence) - OK_LICENCES.indexOf(b.licence) || a.file.length - b.file.length || a.size - b.size);
  chosen.push({ name, ...hits[0] });
}

// fetch and sanitise: no scripts, no event handlers, no external references; keep the viewBox
const clean = (svg) => svg
  .replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/gi, "")
  .replace(/<(script|foreignObject|metadata|sodipodi:[a-z]+|inkscape:[a-z]+)[\s\S]*?<\/\1>/gi, "")
  .replace(/<(sodipodi|inkscape):[^>]*\/>/gi, "")
  .replace(/\s(on\w+|xlink:href|href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
  .replace(/\s+/g, " ").trim();
const out = [];
for (const c of chosen) {
  const res = await fetch(`https://raw.githubusercontent.com/duerrsimon/bioicons/main/${c.path.split("/").map(encodeURIComponent).join("/")}`);
  if (!res.ok) { console.log(`  couldn't fetch ${c.path}`); continue; }
  const svg = clean(await res.text());
  if (!/<svg[\s>]/i.test(svg) || !/viewBox/i.test(svg)) { console.log(`  skipped ${c.file} (no viewBox)`); continue; }
  const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(/[\s,]+/).map(Number);
  out.push({ name: c.name, src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, licence: c.licence, author: c.author, file: c.file, category: c.category, aspect: +(vb[2] / vb[3]).toFixed(3) });
}
mkdirSync("public/bioicons", { recursive: true });
writeFileSync("public/bioicons/icons.json", JSON.stringify({ version: 1, source: "https://bioicons.com", icons: out }));
writeFileSync("src/lib/bioicon-names.ts", `// Generated by tools/bioicons-build.mjs: the Bioicons the exam writer may place in diagrams (public/bioicons/icons.json).\nexport const BIOICON_NAMES: string[] = ${JSON.stringify(out.map((i) => i.name))};\n/** width / height of each icon, so a label can find a part inside the box the icon is fitted into */\nexport const BIOICON_ASPECT: Record<string, number> = ${JSON.stringify(Object.fromEntries(out.map((i) => [i.name, i.aspect])))};\n`);
writeLicence(out);
const kb = Math.round(JSON.stringify(out).length / 1024);
console.log(`\n${out.length} icons, ${kb} KB: ${out.map((i) => `${i.name} (${i.licence})`).join(", ")}`);
