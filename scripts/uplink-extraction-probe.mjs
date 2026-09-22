#!/usr/bin/env node
/**
 * Can this Uplink LEAVE?
 *
 * ## The question the import ratchets cannot ask
 *
 * `packages/core/src/uplink-isolation.test.ts` and
 * `mod/Sitrep.Core.Tests/UplinkIsolationTests.cs` enforce that an Uplink imports
 * only this repo's PUBLISHED packages. Both are correct and
 * both are blind to this: the build still resolves through pnpm workspace links,
 * so an Uplink can import nothing but permitted packages, pass every gate, and
 * depend on API that exists only in the workspace copy.
 *
 * Measured on 2026-08-25, before the publish path was fixed: **249 of 292
 * distinct import bindings across the ten Uplinks did not resolve against what
 * was actually on npm.** Every gate in the tree was green throughout.
 *
 * ## Why it must escape the workspace rather than configure around it
 *
 * pnpm's workspace linking is the thing that hides the problem. A filtered
 * `pnpm install`, however scoped, still resolves `workspace:*` to the directory
 * next door. So the probe copies the client somewhere else entirely, repoints
 * every permitted dependency at a packed tarball, and installs with npm. What
 * survives that is what an outside author would get.
 *
 * Nothing is carried in alongside it, and that matters. An earlier version
 * copied `tsconfig.base.json` in and rewrote the `extends`, because every client
 * reached three levels up and out of its own package for it. That made the
 * measurement pass on a layout no author has. The clients now extend
 * `@ksp-gonogo/sitrep-sdk/tsconfig.base.json`, which arrives with a dependency
 * they already declare, so the probe has nothing left to help with.
 *
 * ## What it measures is what a release WOULD publish, never what IS published
 *
 * The tarballs come from `pack-publishable.mjs` against the workspace `dist`, so
 * this answers "can an Uplink leave, given this tree" and cannot answer "can an
 * Uplink leave, given npm". Those came apart badly once: the sdk's tarball here
 * carried all seven of its subpaths while the copy on npm carried one, because
 * nothing had republished since 2026-07-11 and the version never moved.
 *
 * That gap is deliberately not this probe's job, and a registry-installing leg
 * here would be the permanently-red job the section below refuses. Between a
 * workspace version bump and the release that publishes it, the registry copy is
 * CORRECTLY behind, so a parity check on every CI run would be red for the whole
 * window and red for no defect.
 *
 * The registry question is answered where being red is actionable:
 * `published-version-is-current.mjs` fails a release whose published content has
 * drifted from the tree, and `release.yml` runs the same runtime import against
 * what it has just published. See that workflow's post-publish step.
 *
 * ## Shrink-only, and green from the day it landed
 *
 * Seeded as a red/green gate this would have been red for all ten Uplinks on
 * day one and stayed red for months. This repo already owns one permanently-red
 * job, `visual`, and has twice had a real failure hide behind it: an earth-day
 * ratchet, then a completely dead render harness. A second one would be the same
 * mistake with a new name.
 *
 * So it counts, and holds the count against `uplink-extraction-debt.mjs` as a
 * CEILING. Above its entry fails; below is reported and does not, and is
 * tightened deliberately with `--update`. A new Uplink with no entry starts at
 * zero, so anything authored from here on has to be extractable from the start
 * and only the existing debt is grandfathered.
 *
 * ## The self-test, which runs first and is not optional
 *
 * A probe whose install or typecheck silently no-ops reports zero errors, and
 * zero reads as success. That is not hypothetical here: the static analysis that
 * first measured this drift used a regex over `.d.ts`, could not follow
 * `export * from`, and reported 136 missing exports for a package that was
 * missing 123. Its control run claimed the WORKSPACE was also missing 106, which
 * is impossible in a tree that typechecks, and that impossibility is the only
 * reason the error was caught.
 *
 * So before believing any number, the probe builds a package under the tsconfig
 * baseline the sdk ships, importing every entry point the published packages publish,
 * and requires three things:
 *
 *  1. that CONTROL typechecks clean, under `bundler` AND under `nodenext`. It
 *     doubles as the subpath check: a subpath left out of `files` or out of the
 *     `publishConfig` export map resolves inside the workspace and nowhere else,
 *     which is the shape `/spine` shipped in and nothing saw until
 *     `import(bundleUrl)` threw
 *  2. the same file with one name the sdk does not export FAILS, in both modes
 *  3. that every published entry point actually LOADS, executed by a bare `node`
 *     import rather than typechecked
 *
 * The planted half alone is not enough, and this file is the evidence. It used to
 * write its own tsconfig, whose default target made the sdk's own generated
 * declarations fail to PARSE (`skipLibCheck` does not suppress a syntax error),
 * so the plant "produced 223 errors" and satisfied the check with 222 of them
 * having nothing to do with it. Under the shipped baseline the same plant
 * produces one.
 *
 * ## The self-test proves the INSTRUMENT. A planted leg proves the SUBJECTS
 *
 * Every requirement above passed continuously through five weeks in which not
 * one Uplink was installed or typechecked. `5a5daa797` gave each client a
 * `@ksp-gonogo/uplink-tools` workspace dependency, this file packed two packages
 * by name and not that one, and every leg took `probe()`'s early return for a
 * dependency no tarball exists for. The self-test cannot see that, because
 * nothing in it says anything about the subjects: it builds its own control and
 * grades that.
 *
 * The exit code was never the hiding place. A blocked leg has printed CANNOT BE
 * EXTRACTED and set the exit code since this file's first commit; `uplink.yml`'s
 * matrix job is `continue-on-error`, so the red went unread. What was genuinely
 * indistinguishable is the run's OWN account of itself: each Uplink contributed
 * `errors: 0`, and nothing anywhere stated how many Uplinks the run had
 * actually reached. Every other leg here ends in a line saying what it measured
 * and over how many; the Uplink loop ended in silence, and silence is what both
 * "all clear" and "nothing was attempted" look like.
 *
 * So the subjects now get what the instrument already had. A planted client,
 * declaring a workspace dependency no tarball can exist for, is run through the
 * real `probe()` every time and must come back a hard finding. The measured and
 * blocked legs are counted independently and must close over the discovered set.
 * A run that measures none of them says so, rather than falling quiet.
 *
 * ## Why (3) had to be added, and why typechecking could never have found it
 *
 * `@ksp-gonogo/sitrep-sdk@0.0.1` was on npm for six weeks in a state where
 * `import "@ksp-gonogo/sitrep-sdk"` threw ERR_MODULE_NOT_FOUND on its first
 * line. `tsc` emits module specifiers exactly as the source wrote them, the
 * source writes `./api` because this repo's baseline is
 * `moduleResolution: "bundler"`, and the package is `"type": "module"`, whose
 * resolver does no extension search. 366 specifiers across the emitted tree, 42
 * in `dist/index.js` alone.
 *
 * Every gate was green, including this one, because TypeScript resolves `./api`
 * under `bundler` and this probe only ever asked TypeScript. The check and the
 * failure were on different axes, which is the same shape as the fossil-publish
 * the probe was written to catch. A single `node -e 'await import(...)'` would
 * have failed on day one, so that is what (3) is.
 *
 * It executes under bare `node` deliberately, and not under vitest, which is
 * what an author actually runs. Measured 2026-08-27: with
 * `server: { deps: { inline: [/@ksp-gonogo/] } }` in the consumer's vitest
 * config, Vite transforms the dependency and its resolver performs the extension
 * search Node refuses to, and the broken emit PASSED. An author needs that
 * setting for `@ksp-gonogo/ui-kit` regardless (see `RUNTIME_IMPORT_EXEMPT`), so
 * the runner an author uses is precisely the one that cannot be trusted to
 * answer this question. Bare `node` is the only configuration with nothing in it
 * to paper over the defect.
 *
 * Usage:
 *   node scripts/uplink-extraction-probe.mjs                  every Uplink
 *   node scripts/uplink-extraction-probe.mjs --only Scansat   substring filter
 *   node scripts/uplink-extraction-probe.mjs --update         rewrite the debt
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTRACTION_DEBT,
  RUNTIME_IMPORT_EXEMPT,
} from "./uplink-extraction-debt.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEBT_PATH = join(ROOT, "scripts", "uplink-extraction-debt.mjs");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const update = args.includes("--update");

const run = (cmd, cmdArgs, opts = {}) =>
  spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });

/**
 * Every package this repo PUBLISHES, as `[name, dir]`, discovered rather than
 * listed.
 *
 * It was the same two-entry literal in two places here, and `publishedSubpaths`
 * said in as many words that a new subpath "joins by existing". True of
 * subpaths; false of packages. `@ksp-gonogo/uplink-tools` was published, was
 * declared by every in-repo Uplink, and by two out-of-repo Uplinks in their
 * `gonogo.renderWith`, while this probe (the only check that means "this
 * Uplink can leave") never packed it, never installed it outside the
 * workspace and never imported an entry point of it. The
 * `RUNTIME_IMPORT_EXEMPT` entries naming its subpaths had therefore never once
 * been exercised.
 *
 * Same rule and same reason as `discoverPublished` in
 * `packages/core/src/uplink-isolation.test.ts`: `private: true` is what `npm
 * publish` honours, so there is no second list to drift.
 */
function publishedPackages() {
  const found = [];
  for (const dir of ["packages", "mod"]) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = `${dir}/${entry.name}`;
      const manifest = join(ROOT, rel, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (!pkg.name || pkg.private === true || !pkg.exports) continue;
      found.push([pkg.name, rel]);
    }
  }
  return found.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The floor the discovery cannot drop below silently.
 *
 * A walk that finds nothing packs nothing, probes nothing and reports zero
 * errors, which is this probe's own stated failure mode: "a probe whose install
 * or typecheck silently no-ops reports zero errors".
 */
const MIN_PUBLISHED_PACKAGES = 3;

/** The published packages, packed exactly as a release would publish them. */
function packPermittedPackages(into) {
  const tarballs = {};
  const packages = publishedPackages();
  if (packages.length < MIN_PUBLISHED_PACKAGES) {
    console.error(
      `✖ the published-package walk found ${packages.length} (${packages
        .map(([n]) => n)
        .join(", ")}), below the floor of ${MIN_PUBLISHED_PACKAGES}. ` +
        "A walk that finds nothing probes nothing and reports success.",
    );
    process.exit(2);
  }
  for (const [name, dir] of packages) {
    if (!existsSync(join(ROOT, dir, "dist"))) {
      console.error(
        `✖ ${dir}/dist is missing. The probe packs what a release would publish, and ` +
          `\`npm pack\` does not build. Run \`pnpm --filter "${name}..." build\` first.`,
      );
      process.exit(2);
    }
    // Through pack-publishable, not `npm pack`: npm ignores `publishConfig`
    // field overrides, so a plain pack produces a manifest pointing at `src`.
    // Probing against that would measure a tarball no release would ever ship.
    const packed = run("node", [
      join(ROOT, "scripts/pack-publishable.mjs"),
      join(ROOT, dir),
      into,
    ]);
    if (packed.status !== 0) {
      console.error(`✖ could not pack ${name}:\n${packed.stderr}`);
      process.exit(2);
    }
    tarballs[name] = packed.stdout.trim();
  }
  return tarballs;
}

/**
 * Materialise a client outside the workspace, install, typecheck.
 * Returns `{ errors, blocked }`; `blocked` is a hard finding, not a count.
 */
function probe(clientDir, tarballs, workRoot, label) {
  const work = join(workRoot, label);
  mkdirSync(work, { recursive: true });
  cpSync(clientDir, work, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|dist)$/.test(src),
  });

  // Nothing is copied in alongside. The clients used to extend
  // `../../../tsconfig.base.json`, three levels up and out of the package, and
  // the probe used to bring that file along; that made the measurement pass on a
  // layout no author has. They now extend
  // `@ksp-gonogo/sitrep-sdk/tsconfig.base.json`, which arrives with the
  // dependency, so the copy is what a consumer gets and nothing here has to
  // help. `packages/core/src/uplink-tsconfig-parity.test.ts` keeps it that way.

  const manifestPath = join(work, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const leftovers = [];
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (tarballs[name]) {
        manifest[field][name] = `file:${tarballs[name]}`;
      } else if (String(range).startsWith("workspace:")) {
        // An unpublished workspace package. No tarball exists and none can:
        // this Uplink cannot be installed anywhere but here.
        leftovers.push(`${field}.${name}`);
      }
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (leftovers.length > 0) {
    return {
      errors: 0,
      blocked: `depends on unpublished workspace packages: ${leftovers.join(", ")}`,
    };
  }

  const install = run(
    "npm",
    ["install", "--no-package-lock", "--no-audit", "--no-fund"],
    {
      cwd: work,
    },
  );
  if (install.status !== 0) {
    const reason =
      (install.stderr || "").split("\n").find((l) => /npm error/.test(l)) ?? "";
    return {
      errors: 0,
      blocked: `npm install failed outside the workspace. ${reason}`.trim(),
    };
  }

  const tsc = run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
    cwd: work,
  });
  const output = `${tsc.stdout}${tsc.stderr}`;
  const errors = (output.match(/error TS\d+/g) ?? []).length;
  /*
   * A non-zero exit with nothing that looks like a diagnostic means tsc failed
   * to RUN rather than failing to typecheck: no compiler installed, a tsconfig
   * it could not read, a crash. Counting occurrences alone reads all of those
   * as zero errors, which is this probe's own pass condition.
   */
  if (tsc.status !== 0 && errors === 0) {
    return {
      errors: 0,
      blocked:
        `tsc did not run outside the workspace. ${(output || "").trim().split("\n").slice(-3).join(" ")}`.trim(),
    };
  }
  return { errors, blocked: null, output };
}

/**
 * Every module subpath the published packages export, as import specifiers.
 *
 * Read off the manifests rather than listed, so a new subpath joins by existing.
 * `./biome` and the `.json` configs are shared CONFIG files that nothing resolves
 * through the module graph, and a stylesheet has no types to check; all three are
 * matched by shape so the next one needs no edit here.
 */
function publishedSubpaths() {
  const specs = [];
  for (const [name, dir] of publishedPackages()) {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, dir, "package.json"), "utf8"),
    );
    for (const key of Object.keys(pkg.exports ?? {})) {
      if (!key.startsWith("./") || key === ".") continue;
      const sub = key.slice(2);
      if (sub === "biome" || sub.endsWith(".json") || sub.endsWith(".css"))
        continue;
      specs.push(`${name}/${sub}`);
    }
  }
  return specs;
}

/**
 * Prove the instrument before believing it: a control importing every published
 * surface MUST typecheck clean, and the same file with one name the SDK does not
 * export MUST fail. The planted half alone cannot tell a seen violation from an
 * environment that errors at everything, and this one used to report 223 errors
 * for a single missing import, which is noise enough to satisfy itself.
 */
function selfTest(tarballs, workRoot) {
  const work = join(workRoot, "__blind-check__");
  mkdirSync(work, { recursive: true });
  writeFileSync(
    join(work, "package.json"),
    `${JSON.stringify(
      {
        name: "extraction-probe-self-test",
        private: true,
        version: "0.0.0",
        type: "module",
        devDependencies: {
          /**
           * From the packed set, not named: the control imports every published
           * subpath, so a package it imports and does not depend on fails
           * TS2307 and reads as "the tarball is broken" when it means "the
           * control is".
           */
          ...Object.fromEntries(
            Object.entries(tarballs).map(([name, tgz]) => [
              name,
              `file:${tgz}`,
            ]),
          ),
          typescript: "^5.0.0",
          // The peers the runtime leg needs to reach OUR code rather than
          // stopping at a missing package. Declared here, not installed on the
          // side, so the recorded reason for an exempt entry is the one an
          // operator reproduces: `ui-kit/testing` failing on a missing
          // `jest-axe` and failing on `styled.span` are different findings and
          // only the second is the real one.
          "@testing-library/react": "^16.0.0",
          "jest-axe": "^10.0.0",
          react: "^18.0.0",
          "react-dom": "^18.0.0",
          "styled-components": "^6.0.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  // The baseline the sdk SHIPS, which is what an Uplink extends and therefore
  // what a control has to measure under. A hand-written config here measures
  // settings no author uses: with tsc's default target the sdk's own generated
  // declarations do not even parse, and the 223 errors that produced were what
  // the planted-violation check used to be satisfied by.
  writeFileSync(
    join(work, "tsconfig.json"),
    `${JSON.stringify(
      {
        extends: "@ksp-gonogo/sitrep-sdk/tsconfig.base.json",
        compilerOptions: { noEmit: true },
        include: ["index.ts"],
      },
      null,
      2,
    )}\n`,
  );
  /*
   * The same control under `nodenext`, and this is not belt-and-braces.
   *
   * The bug class this whole probe now exists for is "green in one resolution
   * mode, broken in the other", and a control measured under one mode is exactly
   * as blind to it as a typecheck was to the load failure. Found by hand on
   * 2026-08-27, in this package, shipped: two `.d.ts` files carried
   * `declare module "./types"`, which resolves under `bundler` and does NOT
   * under `nodenext`, so the whole `ContributionRegistry` declaration merge
   * silently failed to bind and every contribution key with it. Zero errors
   * under the shipped baseline, TS2339 under nodenext. `TopicPayloadMap` uses
   * the same declaration-merging pattern, so an Uplink's own Topic declarations
   * are exposed to it too.
   *
   * An author choosing `nodenext` is not doing anything exotic, and the sdk's
   * own emit now names `.js` everywhere precisely so that they can.
   */
  writeFileSync(
    join(work, "tsconfig.nodenext.json"),
    `${JSON.stringify(
      {
        extends: "@ksp-gonogo/sitrep-sdk/tsconfig.base.json",
        compilerOptions: {
          noEmit: true,
          module: "nodenext",
          moduleResolution: "nodenext",
        },
        include: ["index.ts"],
      },
      null,
      2,
    )}\n`,
  );
  // The control reaches every module subpath the published packages publish. That is
  // the resolution check as well as the control: a subpath left out of `files`
  // or out of the `publishConfig` export map resolves inside the workspace and
  // nowhere else, which is the shape `/spine` shipped in and nothing saw until
  // `import(bundleUrl)` threw. A type-only namespace import needs no named
  // export to survive a barrel being reorganised, and still fails TS2307 when
  // the specifier does not resolve.
  const specs = [...Object.keys(tarballs), ...publishedSubpaths()];
  /*
   * A namespace import proves a specifier RESOLVES and nothing more, so it is
   * blind to a declaration merge that failed to bind: the interface is still
   * exported, still a valid type, and simply has no keys. Verified by planting
   * the regression: the control above typechecked clean in both modes with the
   * whole `ContributionRegistry` merge silently gone.
   *
   * These two interfaces are augmented from inside `dist` by
   * `api/contribution-slots.d.ts` and `api/slots.d.ts`, so they are the ones a
   * broken `declare module` specifier empties. The assertion is key-agnostic on
   * purpose: naming a contribution id here would couple the probe to whichever
   * widget happened to register one, and `keyof` being `never` is the actual
   * property. `SlotRegistry` is not decoration either, it is the second half of
   * the same emit and it broke with the first.
   */
  const control = [
    ...specs.map(
      (spec, index) => `import * as Reached${index} from "${spec}";`,
    ),
    'import type { ContributionRegistry, SlotRegistry } from "@ksp-gonogo/sitrep-sdk";',
    "type Bound<T> = [T] extends [never] ? { AUGMENTATION_DID_NOT_BIND: true } : true;",
    "export const contributionsBound: Bound<keyof ContributionRegistry> = true;",
    "export const slotsBound: Bound<keyof SlotRegistry> = true;",
    `export const reached = [${specs.map((_, index) => `Reached${index}`).join(", ")}];`,
    "",
  ].join("\n");
  writeFileSync(join(work, "index.ts"), control);

  const install = run(
    "npm",
    ["install", "--no-package-lock", "--no-audit", "--no-fund"],
    { cwd: work },
  );
  if (install.status !== 0) {
    console.error(
      `✖ BLIND: the self-test could not install the packed sdk.\n${install.stderr}`,
    );
    process.exit(1);
  }

  const MODES = [
    { label: "bundler", config: "tsconfig.json" },
    { label: "nodenext", config: "tsconfig.nodenext.json" },
  ];

  const typecheck = (config = "tsconfig.json") => {
    const tsc = run("npx", ["tsc", "--noEmit", "-p", config], {
      cwd: work,
    });
    const output = `${tsc.stdout}${tsc.stderr}`;
    return { errors: (output.match(/error TS\d+/g) ?? []).length, output };
  };

  for (const mode of MODES) {
    const clean = typecheck(mode.config);
    if (clean.errors === 0) continue;
    console.error(
      "✖ the control, which reaches only the root barrels and the subpaths these two packages\n" +
        `  publish, produced ${clean.errors} error(s) under moduleResolution: ${mode.label}. One of:\n` +
        "    - a published subpath does not resolve from its own tarball (the `/spine` shape)\n" +
        "    - a `declare module` in the shipped declarations names a specifier this mode cannot\n" +
        "      resolve, so its interface augmentation silently did not bind (TS2322 on a `Bound<>`\n" +
        "      line below is exactly this, and it is invisible under bundler)\n" +
        "    - BLIND: the probe's environment fails at everything, and every count it reports\n" +
        "      below is its own noise\n" +
        `${clean.output
          .split("\n")
          .filter((line) => /error TS/.test(line))
          .slice(0, 12)
          .map((line) => `    ${line.trim()}`)
          .join("\n")}`,
    );
    process.exit(1);
  }

  typesResolveToDist(work);

  writeFileSync(
    join(work, "index.ts"),
    `${control}import { thisExportCannotExist } from "@ksp-gonogo/sitrep-sdk";\nexport const planted = thisExportCannotExist;\n`,
  );
  // Planted under BOTH configs: a mode whose compiler never ran reports zero
  // errors for the control above, which is that mode's own pass condition.
  const planted = [];
  for (const mode of MODES) {
    const violated = typecheck(mode.config);
    if (violated.errors === 0) {
      console.error(
        "✖ BLIND: a deliberate import of an export the sdk does not have typechecked CLEANLY\n" +
          `  under moduleResolution: ${mode.label}. The probe cannot see the failure it exists to\n` +
          "  measure, so every zero it reports below would be meaningless. Refusing to report\n" +
          "  success.",
      );
      process.exit(1);
    }
    planted.push(`${mode.label} ${violated.errors}`);
  }
  console.log(
    `self-test: ${specs.length} published entry point(s) resolved from the tarballs and the control ` +
      `typechecked clean under ${MODES.map((m) => m.label).join(" and ")}; the planted violation ` +
      `produced error(s) in each (${planted.join(", ")}).`,
  );

  runtimeImports(specs, work);
}

/**
 * The control typechecking clean is only worth what it typechecked AGAINST.
 *
 * `mod/sitrep-sdk` ships `src` as well as `dist`, deliberately: `declarationMap`
 * and `sourceMap` are on, so a consumer's go-to-definition and stack traces land
 * on real TypeScript instead of on generated declarations. The cost is that the
 * tarball contains a second, complete copy of the package that TypeScript is
 * perfectly capable of reading, and if `exports` ever pointed back at it the
 * control above would typecheck clean forever while the emitted `dist` rotted
 * unmeasured. That is not hypothetical: the in-workspace `exports` map DOES point
 * at `./src/*.ts`, because pnpm consumes this package as source, and only
 * `publishConfig` plus `pack-publishable.mjs` redirect it for consumers.
 *
 * So this asserts the thing the typecheck cannot say about itself: every file
 * TypeScript actually read from inside our two packages came out of `dist`.
 *
 * As the tree stands the control above would usually fail first, because this
 * package's `src` needs `@types/react` and the self-test does not install it, so
 * repointing `exports` at source produces TS7016 before it produces anything
 * here. That is luck, not cover: it holds only while a React type happens to sit
 * on the path between the barrel and the source. Verified 2026-08-27 by
 * repointing an installed tarball's `exports` and reading `--listFiles`: 157
 * files came from `src/`, and this is what names them.
 */
function typesResolveToDist(work) {
  const listed = run(
    "npx",
    ["tsc", "--noEmit", "--listFiles", "-p", "tsconfig.json"],
    { cwd: work },
  );
  const ours = `${listed.stdout}${listed.stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("node_modules/@ksp-gonogo/"));

  // Zero would make the assertion below vacuous, and vacuous reads as success.
  if (ours.length === 0) {
    console.error(
      "✖ BLIND: `tsc --listFiles` named no file inside node_modules/@ksp-gonogo/, so it did not\n" +
        "  read our packages at all and 'every file came from dist' would be true of nothing.",
    );
    process.exit(1);
  }

  const fromSource = ours.filter((file) =>
    /@ksp-gonogo\/[^/]+\/src\//.test(file),
  );
  if (fromSource.length > 0) {
    console.error(
      `✖ TypeScript resolved ${fromSource.length} of ${ours.length} file(s) out of a published\n` +
        "  package's `src/` rather than its `dist/`. The control's clean typecheck then proves\n" +
        "  nothing about the emitted declarations a consumer is actually pointed at:\n" +
        `${fromSource
          .slice(0, 8)
          .map((file) => `    ${file.replace(/.*node_modules\//, "")}`)
          .join("\n")}`,
    );
    process.exit(1);
  }

  console.log(
    `types: all ${ours.length} file(s) TypeScript read from the published packages came from dist/.`,
  );
}

/**
 * Requirement (3): every published entry point LOADS.
 *
 * One bare `node` process per specifier, because a single process importing all
 * of them stops at the first failure and reports one finding for a list of
 * unknown length. Nothing is transformed, bundled or inlined: the specifier is
 * handed to Node's own ESM resolver, which is the resolver a typecheck cannot
 * stand in for.
 */
function runtimeImports(specs, work) {
  const importOnce = (spec) => {
    const result = run(
      "node",
      ["--input-type=module", "-e", `await import(${JSON.stringify(spec)});`],
      { cwd: work },
    );
    if (result.status === 0) return null;
    const output = `${result.stdout}${result.stderr}`;
    return (
      output
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /^[A-Za-z]*Error/.test(line)) ??
      output.trim().split("\n").slice(-1)[0] ??
      `exited ${result.status}`
    );
  };

  /*
   * Prove the leg can SEE a failure before believing the ones that pass. A
   * subpath the sdk does not export must throw; if it does not, this is not
   * running Node against the installed package at all and every pass below is
   * its own noise. Same argument as the planted typecheck violation above.
   */
  const planted = importOnce(
    "@ksp-gonogo/sitrep-sdk/this-subpath-cannot-exist",
  );
  if (!planted) {
    console.error(
      "✖ BLIND: importing a subpath the sdk does not publish SUCCEEDED, so the runtime leg is\n" +
        "  not resolving against the installed package and every entry point it calls loadable\n" +
        "  below would be meaningless. Refusing to report success.",
    );
    process.exit(1);
  }

  /**
   * The exemption in force for a specifier, or null.
   *
   * An entry is either a bare reason string, which is a property of the package
   * and holds anywhere, or `{ reason, whileMissingPeer }`, which is a property
   * of THIS consumer and holds only while that peer really is absent. Resolving
   * the peer rather than trusting the note is the point: an exemption that
   * asserts its own premise is indistinguishable from a stale one.
   */
  const exemptionFor = (spec) => {
    const entry = RUNTIME_IMPORT_EXEMPT[spec];
    if (!entry) return null;
    if (typeof entry === "string") return entry;
    const probe = run(
      "node",
      [
        "--input-type=module",
        "-e",
        `import.meta.resolve(${JSON.stringify(entry.whileMissingPeer)});`,
      ],
      { cwd: work },
    );
    // Peer present, so the recorded excuse does not apply here any more.
    if (probe.status === 0) return null;
    return `${entry.reason} (peer \`${entry.whileMissingPeer}\` confirmed absent)`;
  };

  const failed = [];
  const exemptButLoading = [];
  const exempt = [];
  let loaded = 0;
  for (const spec of specs) {
    const failure = importOnce(spec);
    const exemption = exemptionFor(spec);
    if (!failure) loaded += 1;
    if (failure && !exemption) failed.push(`${spec}: ${failure}`);
    else if (failure) exempt.push(spec);
    else if (exemption) exemptButLoading.push(spec);
  }

  if (failed.length > 0) {
    console.error(
      `✖ ${failed.length} published entry point(s) do not LOAD, whatever they typecheck as. A\n` +
        "  consumer that is not a bundler gets exactly this:\n" +
        `${failed.map((entry) => `    ${entry}`).join("\n")}\n\n` +
        "  If one of these cannot be made to load and the reason is not ours to fix, add it to\n" +
        "  RUNTIME_IMPORT_EXEMPT in scripts/uplink-extraction-debt.mjs with that reason.",
    );
    process.exit(1);
  }

  /*
   * Both numbers counted from what actually happened, then required to close.
   * Reporting one as `total - other` makes the line agree with itself whatever
   * it failed to measure: `uplinkindep`'s equivalent check printed 7 loaded and
   * 4 exempt against 12 entry points, and nothing about the sentence looked
   * wrong.
   *
   * The loop above cannot currently break this, since every specifier lands in
   * exactly one of loaded / exempt / failed-and-exited. It is here as an
   * invariant on the accounting rather than a live bug: the summary is the only
   * thing anyone reads, and a fourth branch added later would otherwise go
   * missing from it silently.
   */
  if (loaded + exempt.length !== specs.length) {
    console.error(
      `✖ BLIND: ${loaded} loaded + ${exempt.length} exempt does not account for ${specs.length} ` +
        "published entry point(s), so this run measured something it is not reporting.",
    );
    process.exit(1);
  }
  console.log(
    `runtime: ${loaded} of ${specs.length} published entry point(s) loaded under a bare node ` +
      `import; the other ${exempt.length} are exempt with a recorded reason.`,
  );
  if (exemptButLoading.length > 0) {
    console.log(
      `  ${exemptButLoading.length} exempt entry point(s) now load and should be removed from ` +
        `RUNTIME_IMPORT_EXEMPT: ${exemptButLoading.join(", ")}`,
    );
  }
}

/**
 * Prove the per-leg machinery can SEE an Uplink it failed to measure.
 *
 * A client declaring a workspace dependency that no tarball can exist for is
 * the exact shape all five in-repo Uplinks were in from `5a5daa797`, and the
 * shape any new private workspace package puts the next one in, needing no
 * mistake by anyone. `probe()` must answer it with a hard finding rather than a
 * count, and this asks it to, every run, through the real function.
 *
 * Same argument as the planted import in `selfTest` and the planted subpath in
 * `runtimeImports`, one level down: those two prove the control can fail, and a
 * control that can fail says nothing about whether the subjects were reached.
 */
function legThatCannotBeMeasured(tarballs, workRoot) {
  const source = join(workRoot, "__leg-plant-src__");
  mkdirSync(source, { recursive: true });
  writeFileSync(
    join(source, "package.json"),
    `${JSON.stringify(
      {
        name: "extraction-probe-leg-plant",
        private: true,
        version: "0.0.0",
        dependencies: {
          "@ksp-gonogo/no-such-published-package": "workspace:*",
        },
      },
      null,
      2,
    )}\n`,
  );
  const planted = probe(source, tarballs, workRoot, "__leg-plant__");
  if (!planted.blocked) {
    console.error(
      "✖ BLIND: a planted Uplink whose only dependency cannot be packed came back measurable\n" +
        `  (${planted.errors} error(s)). The probe cannot tell an Uplink it never installed from\n` +
        "  one that typechecked clean, which is the state every Uplink was in for five weeks.\n" +
        "  Refusing to report success.",
    );
    process.exit(1);
  }
  console.log(
    `legs: a planted unextractable Uplink was refused (${planted.blocked}).`,
  );
}

/**
 * Replace the `EXTRACTION_DEBT` statement and nothing else in the debt file.
 *
 * This used to keep the half of the file before the marker and append a fresh
 * statement, which was correct while `EXTRACTION_DEBT` was the last thing in it
 * and became silent data loss the moment `RUNTIME_IMPORT_EXEMPT` was added
 * below: one `--update` deleted that whole named list and the paragraphs
 * explaining it, and the next run could not import the module at all. Measured,
 * not argued: it happened here on 2026-09-23, and `--update` is run precisely
 * when nobody is reading this file.
 *
 * The terminator search relies on `EXTRACTION_DEBT` being a flat map of counts,
 * so the first `};` after the marker ends the statement. The export-set check
 * below is what actually holds: a write meant to change one number may not
 * change which exports the file declares.
 */
function rewriteDebt(merged) {
  const current = readFileSync(DEBT_PATH, "utf8");
  const start = current.indexOf("export const EXTRACTION_DEBT");
  const end = start === -1 ? -1 : current.indexOf("};", start);
  if (end === -1) {
    console.error(
      `✖ could not find the EXTRACTION_DEBT statement in ${DEBT_PATH}, so refusing to rewrite it.`,
    );
    return false;
  }
  const rewritten = `${current.slice(0, start)}export const EXTRACTION_DEBT = ${JSON.stringify(
    merged,
    null,
    2,
  )};${current.slice(end + 2)}`;
  const declared = (text) =>
    (text.match(/^export const (\w+)/gm) ?? []).sort().join(", ");
  if (declared(rewritten) !== declared(current)) {
    console.error(
      `✖ rewriting ${DEBT_PATH} would have changed which exports it declares\n` +
        `  (${declared(current)} -> ${declared(rewritten)}), so refusing to write it.`,
    );
    return false;
  }
  writeFileSync(DEBT_PATH, rewritten);
  return true;
}

const workRoot = mkdtempSync(join(tmpdir(), "gonogo-extraction-"));
let exitCode = 0;
/**
 * Findings `--update` may not clear. It exists to accept a typecheck count that
 * came in different from the debt, which is a measurement; a leg that produced
 * no measurement has nothing to accept, and rewriting the file from that run
 * writes down a number nobody took.
 */
let hardFindings = 0;
try {
  const tarballs = packPermittedPackages(join(workRoot, "tarballs"));
  selfTest(tarballs, workRoot);
  legThatCannotBeMeasured(tarballs, workRoot);

  const uplinks = JSON.parse(
    execFileSync("node", [join(ROOT, "scripts/uplink-matrix.mjs")], {
      encoding: "utf8",
    }),
  )
    .filter((u) => u.client)
    .filter((u) => !only || u.id.toLowerCase().includes(only.toLowerCase()));

  // A filter that selects nothing runs the loop zero times and reports success.
  if (uplinks.length === 0) {
    console.error(
      only
        ? `✖ --only ${only} matched no Uplink with a client, so nothing was probed.`
        : "✖ BLIND: the matrix reported no Uplink with a client, so nothing was probed.",
    );
    process.exit(1);
  }

  const measured = {};
  let blocked = 0;
  for (const uplink of uplinks) {
    const result = probe(
      join(ROOT, "mod", uplink.id, "client"),
      tarballs,
      workRoot,
      uplink.id,
    );
    const allowed = EXTRACTION_DEBT[uplink.id] ?? 0;

    if (result.blocked) {
      console.error(`✖ ${uplink.id}: CANNOT BE EXTRACTED. ${result.blocked}`);
      blocked += 1;
      hardFindings += 1;
      continue;
    }
    measured[uplink.id] = result.errors;
    if (result.errors > allowed) {
      console.log(
        `✖ ${uplink.id}: ${result.errors} typecheck error(s) against the published packages, debt allows ${allowed}`,
      );
      for (const line of (result.output ?? "")
        .split("\n")
        .filter((l) => /error TS/.test(l))
        .slice(0, 8)) {
        console.log(`    ${line.trim()}`);
      }
      exitCode = 1;
    } else if (result.errors < allowed) {
      console.log(
        `  ${uplink.id}: ${result.errors} error(s), debt allows ${allowed}. Tighten with --update --only ${uplink.id}.`,
      );
    } else {
      console.log(
        `✓ ${uplink.id}: ${result.errors} error(s), at its ceiling of ${allowed}`,
      );
    }
  }

  /*
   * Both numbers counted from what happened, then required to close, and a line
   * saying how many Uplinks the run actually reached.
   *
   * The loop above emitted a tick per Uplink and nothing at all about the set,
   * so for five weeks "every Uplink is clean" and "no Uplink was installed or
   * typechecked" produced the same output: a row of zeroes and no statement of
   * how many rows there should have been. `runtimeImports` already states the
   * rule this follows: report neither side as `total - other`, or the sentence
   * agrees with itself whatever the run failed to measure.
   */
  const measuredCount = Object.keys(measured).length;
  if (measuredCount + blocked !== uplinks.length) {
    console.error(
      `✖ BLIND: ${measuredCount} measured + ${blocked} blocked does not account for ` +
        `${uplinks.length} Uplink(s), so this run measured something it is not reporting.`,
    );
    hardFindings += 1;
  } else if (measuredCount === 0) {
    console.error(
      `✖ BLIND: none of the ${uplinks.length} Uplink(s) was installed and typechecked outside\n` +
        "  the workspace. The zeroes above are the absence of a measurement, not the result of\n" +
        "  one, and no debt entry can be believed against them.",
    );
    hardFindings += 1;
  }
  console.log(
    `uplinks: ${measuredCount} of ${uplinks.length} installed and typechecked outside the ` +
      `workspace${blocked > 0 ? `, ${blocked} could not be` : ""}.`,
  );

  if (update && measuredCount === 0) {
    console.error(
      "✖ refusing to rewrite the debt from a run that measured no Uplink.",
    );
  } else if (update) {
    const merged = { ...EXTRACTION_DEBT, ...measured };
    for (const [id, count] of Object.entries(merged))
      if (count === 0) delete merged[id];
    if (rewriteDebt(merged)) {
      console.log(`\nRewrote ${DEBT_PATH} from this run.`);
      exitCode = 0;
    } else {
      hardFindings += 1;
    }
  }
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
process.exit(hardFindings > 0 ? 1 : exitCode);
