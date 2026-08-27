/**
 * Bundles the delayed-media Worker entry over the top of what `tsc` emitted.
 *
 * The rest of this package ships as plain `tsc` output whose relative imports
 * `scripts/extend-relative-specifiers.mjs` gives their extensions, so raw ESM
 * loads all of it. That pass is younger than this one, and the reason this one
 * exists is the belief it replaced: that extensionless output was fine because
 * every consumer bundles. A Worker was the one place that was obviously false,
 * the browser loads it by URL as raw ESM, so `../capture-clock` failed at the
 * first import and the pipeline fell silently back to the main-thread backend.
 * The same failure was reaching every non-bundler consumer of every other
 * module here and nothing executed an import to find out.
 *
 * This entry stays bundled regardless: a Worker resolving nothing but itself is
 * one fewer thing that can go wrong at a boundary with no error path back.
 * `delay-worker.d.ts` is left as `tsc` wrote it, the client imports the message
 * types from it, and that import is type-only, so nothing at runtime depends on
 * the shape of this file's module graph.
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
