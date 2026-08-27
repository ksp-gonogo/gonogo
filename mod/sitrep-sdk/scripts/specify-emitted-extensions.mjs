/**
 * Writes the file extension into every relative specifier the build emitted.
 *
 * This package is `"type": "module"` and ships unbundled per-file ESM, because
 * its `exports` subpaths map onto real directories in `dist`. `tsc` emits
 * specifiers exactly as they are written in source, and source is compiled under
 * `moduleResolution: "bundler"` (from `tsconfig.base.json`, where it is right:
 * that file is the baseline an Uplink author builds against and an Uplink client
 * IS bundled). So `dist/index.js` shipped
 * `export * from "./__generated__/contract";` with no extension.
 *
 * TypeScript resolves that. Node's ESM resolver does not, and neither does
 * anything built on it. `import "@ksp-gonogo/sitrep-sdk"` threw
 * ERR_MODULE_NOT_FOUND for every consumer outside a bundler, which is every
 * consumer running tests: measured on an extracted Uplink client, all 18 of its
 * test files failed to load before a single assertion ran.
 *
 * Nothing in the tree could see it. Inside the workspace the manifest points at
 * `src`, so the app and every first-party test resolve TypeScript and never read
 * `dist`. `scripts/uplink-extraction-probe.mjs` reads `dist` but only ever runs
 * `tsc --noEmit`, and a typecheck is the one operation that succeeds on this. A
 * probe that never executes an import cannot express this failure, so it
 * reported zero errors for a package that could not be loaded at all.
 *
 * `ui-kit` does not need this: tsup bundles it and writes extensions itself.
 * Bundling here instead would collapse the per-directory `exports` layout this
 * package is built around, so the extension is added after emit rather than by
 * changing what emits.
 *
 * Declarations are rewritten alongside the JavaScript. A consumer on
 * `moduleResolution: "bundler"` tolerates a bare specifier in a `.d.ts`, one on
 * `node16`/`nodenext` does not, and the two halves disagreeing about the same
 * import is worse than either.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;

/**
 * Emitted modules are one-per-source-file, so this many is a build that ran.
 * A stale or absent `dist` would otherwise make "nothing to rewrite" the same
 * output as "nothing needed rewriting", and this script's whole job is to be the
 * reason a consumer can load the package.
 */
const MIN_EMITTED_FILES = 100;

/** Matches `from "./x"`, `import "./x"` and `import("./x")`, single or double quoted. */
const RELATIVE_SPECIFIER = /((?:\bfrom|\bimport)\s*\(?\s*(['"]))(\.[^'"]*)\2/g;

function emittedFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) emittedFiles(path, out);
    else if (/\.(js|d\.ts)$/.test(path)) out.push(path);
  }
  return out;
}

/**
 * The specifier a resolver needs, or null when it already has one or names
 * something this dist does not contain. A specifier that resolves to neither a
 * sibling module nor a directory barrel is left alone deliberately: rewriting it
 * to a guess would turn a clear ERR_MODULE_NOT_FOUND into a wrong file.
 */
function specified(file, specifier) {
  if (/\.(js|json|css|d\.ts)$/.test(specifier)) return null;
  const declaration = file.endsWith(".d.ts");
  const target = resolve(dirname(file), specifier);
  const [module, barrel] = declaration
    ? [`${target}.d.ts`, join(target, "index.d.ts")]
    : [`${target}.js`, join(target, "index.js")];
  const exists = (path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };
  // Emitted as `.js` in both halves: a declaration's specifier names the
  // runtime module, not the declaration beside it.
  if (exists(module)) return `${specifier}.js`;
  if (exists(barrel)) return `${specifier}/index.js`;
  return null;
}

const files = emittedFiles(DIST);
if (files.length < MIN_EMITTED_FILES) {
  console.error(
    `✖ ${DIST} holds ${files.length} emitted file(s), expected at least ${MIN_EMITTED_FILES}. ` +
      "Either the build did not run or the output moved, and rewriting nothing would report the " +
      "same success as having nothing to rewrite.",
  );
  process.exit(1);
}

let rewritten = 0;
let specifiers = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const output = source.replace(
    RELATIVE_SPECIFIER,
    (match, lead, quote, specifier) => {
      const replacement = specified(file, specifier);
      if (replacement === null) return match;
      specifiers += 1;
      return `${lead}${replacement}${quote}`;
    },
  );
  if (output !== source) {
    writeFileSync(file, output);
    rewritten += 1;
  }
}

console.log(
  `specified ${specifiers} relative specifier(s) across ${rewritten} of ${files.length} emitted file(s)`,
);
