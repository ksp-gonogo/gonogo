/**
 * Bundles the delayed-media Worker entry over the top of what `tsc` emitted.
 *
 * The rest of this package ships as plain `tsc` output, whose relative imports
 * are extensionless: that is fine for every consumer, because a bundler
 * resolves them. A Worker entry is the one module nothing resolves for us. The
 * browser loads it by URL, as raw ESM, so extensionless `../capture-clock`
 * fails at the first import and the pipeline silently falls back to the
 * main-thread backend.
 *
 * So this entry alone is bundled self-contained. `delay-worker.d.ts` is left as
 * `tsc` wrote it: the client imports the message types from it, and that import
 * is type-only, so nothing at runtime depends on the shape of this file's
 * module graph.
 *
 * The sibling `new URL("./delay-worker.js", import.meta.url)` in
 * `delay-worker-client.ts` is what points here. It is written with the `.js`
 * extension so it resolves in BOTH worlds: against this output when the package
 * is consumed as `dist`, and against `delay-worker.ts` when Vite compiles the
 * package from source in-repo (its resolver maps `.js` to `.ts` for a TS
 * importer).
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/media/worker/delay-worker.ts"],
  outfile: "dist/media/worker/delay-worker.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  allowOverwrite: true,
  sourcemap: true,
});
