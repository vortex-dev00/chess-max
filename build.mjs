// ╔══════════════════════════════════════════════════════════════════════╗
// ║  build.mjs — tiny, explicit build step.                                ║
// ║  • Bundles each web/entries/*.js into public/assets/*.js (esbuild).     ║
// ║  • Copies web/static/** into public/ verbatim (HTML, CSS, images).      ║
// ║  Run:  node build.mjs        (once)                                     ║
// ║        node build.mjs --watch (rebuild on change, for `npm run dev`)    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import * as esbuild from "esbuild";
import { cp, readdir, rm, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ENTRIES = path.join(ROOT, "web", "entries");
const STATIC = path.join(ROOT, "web", "static");
const OUT = path.join(ROOT, "public");
const watch = process.argv.includes("--watch");

async function copyStatic() {
  await cp(STATIC, OUT, { recursive: true });
}

async function run() {
  // Best-effort clean. On Windows a watcher/AV can briefly hold a handle on
  // public/ (EBUSY) — that's fine, esbuild + cp overwrite what matters.
  await rm(OUT, { recursive: true, force: true }).catch(() => {});
  await mkdir(path.join(OUT, "assets"), { recursive: true });
  await copyStatic();

  const entryFiles = (await readdir(ENTRIES))
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(ENTRIES, f));

  const ctx = await esbuild.context({
    entryPoints: entryFiles,
    outdir: path.join(OUT, "assets"),
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: !watch,
    sourcemap: watch,
    logLevel: "info",
  });

  if (watch) {
    await ctx.rebuild();
    await ctx.watch();
    // Also re-copy static on an interval (cheap; keeps HTML/CSS fresh in dev).
    setInterval(copyStatic, 1000);
    console.log("👀 watching web/ — rebuilding on change");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("✓ build complete → public/");
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
