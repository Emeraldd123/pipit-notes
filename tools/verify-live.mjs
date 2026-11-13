// Confirms the live site is running the commit that is checked out here.
//
//   npm run verify:live                    check https://bensnotes.netlify.app against git HEAD
//   node tools/verify-live.mjs <url>       check another copy (a deploy preview, say)
//   node tools/verify-live.mjs --expect abc1234
//
// Every build writes /version.json (see vite.config.ts): { commit, version, build, dirty }.
// A copy of the site that has no version.json, or whose commit differs from HEAD, is stale:
// the script says so and exits 1. Exit 2 means the site could not be reached at all. Exit 3
// means the build is current but the headers set in netlify.toml are not being sent.
import { execSync } from "node:child_process";

// let fetch's sockets finish closing before exiting (exiting at once trips a Node assertion on Windows)
const quit = async (code) => { process.exitCode = code; await new Promise((r) => setTimeout(r, 400)); process.exit(code); };

const DEFAULT_URL = "https://bensnotes.netlify.app";
const ATTEMPTS = 6;      // a fresh deploy can take a few seconds to reach every CDN node
const WAIT_MS = 5000;

const args = process.argv.slice(2);
let expect = "";
let site = process.env.PIPIT_LIVE_URL || DEFAULT_URL;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--expect") expect = args[++i] ?? "";
  else if (/^https?:\/\//.test(args[i])) site = args[i];
  else { console.error(`verify-live: unrecognised argument "${args[i]}"`); process.exit(2); }
}
site = site.replace(/\/+$/, "");

const git = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
if (!expect) {
  try { expect = git("git rev-parse --short HEAD"); }
  catch { console.error("verify-live: could not read the current commit (git rev-parse failed). Pass --expect <commit>."); process.exit(2); }
}
let localDirty = false;
try { localDirty = git("git status --porcelain --untracked-files=no").length > 0; } catch { /* not fatal */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// short hashes can differ in length between machines: compare by prefix
const sameCommit = (a, b) => a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));

/** → { stamp } when version.json was read, { missing } when the site has none, or throws when unreachable. */
async function readStamp() {
  const res = await fetch(`${site}/version.json?t=${Date.now()}`, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const body = await res.text();
  if (res.status === 404) return { missing: "the site has no /version.json (404)" };
  if (!res.ok) throw new Error(`${site}/version.json answered HTTP ${res.status}`);
  // The SPA fallback answers unknown paths with index.html, so "200 but not JSON" means the file is not there.
  try {
    const stamp = JSON.parse(body);
    if (stamp && typeof stamp.commit === "string") return { stamp, headers: res.headers };
    return { missing: "/version.json has no commit in it" };
  } catch {
    return { missing: "the site has no /version.json (the app shell came back instead)" };
  }
}

let last = "";
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  let unreachable = false;
  try {
    const r = await readStamp();
    if (r.stamp) {
      const { commit, version, build, dirty } = r.stamp;
      if (sameCommit(commit, expect)) {
        console.log(`verify-live: OK. ${site} is running commit ${commit} (version ${version ?? "?"}, built ${build ?? "?"}).`);
        if (dirty) console.warn("verify-live: warning: that build was made with uncommitted changes, so the commit alone does not describe it.");
        if (localDirty) console.warn("verify-live: warning: this working tree has uncommitted changes; the live site may not include them.");
        // netlify.toml sets these for every path. A deploy that carries the files but not the
        // configuration (a dist/ folder dragged into the Netlify UI, for one) has none of them.
        const missing = ["x-content-type-options", "referrer-policy", "permissions-policy"].filter((h) => !r.headers.get(h));
        if (!r.headers.get("content-security-policy") && !r.headers.get("content-security-policy-report-only")) missing.push("content-security-policy");
        if (missing.length) {
          console.error(`verify-live: the build is current, but the site is NOT sending the headers from netlify.toml (missing: ${missing.join(", ")}).`);
          console.error("verify-live: netlify.toml was not applied to this deploy. Deploy from the project folder with `npm run deploy:prod`.");
          await quit(3);
        }
        console.log("verify-live: security headers from netlify.toml are being sent.");
        await quit(0);
      }
      last = `it is running commit ${commit} (version ${version ?? "?"}, built ${build ?? "?"})`;
    } else {
      last = r.missing;
    }
  } catch (e) {
    unreachable = true;
    last = String(e?.cause?.message ?? e?.message ?? e);
  }
  if (attempt < ATTEMPTS) { await sleep(WAIT_MS); continue; }
  if (unreachable) {
    console.error(`verify-live: could not reach ${site}: ${last}`);
    await quit(2);
  }
  console.error(`verify-live: STALE. ${site} is not running commit ${expect}: ${last}.`);
  console.error("verify-live: the deploy did not publish this build. Rebuild and deploy with `npm run deploy:prod` (never upload an old dist/ folder by hand).");
  await quit(1);
}
