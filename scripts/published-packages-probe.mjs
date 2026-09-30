#!/usr/bin/env node
/**
 * Do the packages this repo PUBLISHES work outside it?
 *
 * Packs every published package (`private` unset) exactly as a release would,
 * installs the tarballs with npm into a directory outside the pnpm workspace,
 * and measures that install. Escaping the workspace is the point: inside it,
 * `workspace:*` resolves to the directory next door, so a subpath missing from
 * `files`, an `exports` map pointing at `src`, or an emit Node cannot load all
 * stay invisible to every in-repo build and test.
 *
 * It measures what a release WOULD publish from this tree, never what is on
 * npm. Between a version bump and the release that publishes it the registry
 * copy is correctly behind, so a registry leg here would be red for no defect.
 * `release.yml` asks the registry question after it publishes.
 *
 * ## What it requires
 *
 *  1. a control importing every published entry point typechecks clean under
 *     the tsconfig baseline the sdk ships, with `moduleResolution: bundler` AND
 *     `nodenext`. A subpath left out of `files` or the `publishConfig` export map
 *     resolves inside the workspace and nowhere else, and a `declare module`
 *     naming `./types` binds under bundler and silently not under nodenext
 *  2. every file TypeScript read from our packages came out of `dist`, not the
 *     `src` the sdk also ships for go-to-definition
 *  3. every published entry point LOADS under a bare `node` import, or carries a
 *     recorded reason in `RUNTIME_IMPORT_EXEMPT` below
 *
 * ## Why (3) is bare node and not a typecheck or vitest
 *
 * `tsc` emits specifiers as the source wrote them, and under `bundler` the
 * source writes `./api` with no extension. A `"type": "module"` package's
 * resolver does no extension search, so such an emit typechecks perfectly and
 * throws ERR_MODULE_NOT_FOUND on its first line. vitest cannot stand in either:
 * with `server: { deps: { inline: [/@ksp-gonogo/] } }`, which a consumer needs
 * for ui-kit, Vite transforms the dependency and performs the extension search
 * Node refuses to, so the broken emit passes. Bare `node` has nothing in it to
 * paper over the defect.
 *
 * ## It proves its own instrument first
 *
 * A probe whose install or typecheck silently no-ops reports zero errors, and
 * zero reads as success. So the same control with one import of an export the
 * sdk does not have must FAIL to typecheck in both modes, and an import of a
 * subpath the sdk does not publish must FAIL to load. Either succeeding exits
 * BLIND. The control is measured under the shipped baseline rather than a
 * hand-written tsconfig because tsc's default target cannot even parse the sdk's
 * generated declarations, which would satisfy the planted check with noise.
 *
 * Usage: node scripts/published-packages-probe.mjs
 * Needs every published package's `dist` built first.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./temp-dir.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Published entry points that are NOT expected to load under a bare `node`
 * import, and why.
 *
 * ui-kit is a React component library whose bundle evaluates `styled.span` at
 * module scope. `styled-components@6` ships no `exports` map, only `main` (CJS)
 * and `module` (ESM), so bare Node loads the CJS half and its interop makes the
 * default export the module namespace rather than the factory: `styled.span is
 * not a function`, before any of our code runs. A bundler, and vitest with the
 * kit inlined, honour `module` and get the factory. Nothing on the kit's side
 * can fix that, and no author imports a React component library in bare Node.
 * The sdk has no such excuse: it is what an author's tests, scripts and tooling
 * reach without a bundler, so every sdk entry point must load as-is.
 *
 * A named list rather than a count, so a NEW entry point that fails is a
 * failure rather than a number that grew. An entry that starts loading is
 * reported for removal and does not fail.
 *
 * An entry is a reason string, or `{ reason, whileMissingPeer }` for a failure
 * that holds only while that peer is absent from the consumer; the peer is
 * resolved rather than trusted, so a stale conditional entry stops applying.
 */
const RUNTIME_IMPORT_EXEMPT = {
  "@ksp-gonogo/ui-kit":
    "evaluates styled.span at module scope; styled-components@6 has no exports map, so bare Node loads its CJS half and the default export is the namespace, not the factory",
  "@ksp-gonogo/ui-kit/testing":
    "shares tsup's chunk with the kit's root barrel, so it evaluates the same styled.span",
  "@ksp-gonogo/uplink-tools/render-probe":
    "imports the kit at module scope, so it evaluates the same styled.span",
  "@ksp-gonogo/uplink-tools/page-check":
    "imports the kit at module scope, so it evaluates the same styled.span",
  "@ksp-gonogo/uplink-tools/widgets":
    "bundles the app's widget graph, which evaluates styled.span at module scope for the same reason the kit does",
  /*
   * Unconditional, although this harness also needs `playwright`: the root
   * imports the kit at module scope, so it fails on `styled.span` before
   * Playwright is reached, with or without the peer. If the styled-components
   * cause is ever fixed, this becomes `whileMissingPeer: "playwright"` rather
   * than being deleted.
   */
};

const run = (cmd, cmdArgs, opts = {}) =>
  spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });

/**
 * Every package this repo publishes, as `[name, dir]`, discovered rather than
 * listed. `private: true` is what `npm publish` honours, the same rule as
 * `discoverPublished` in `packages/core/src/uplink-isolation.test.ts`, so there
 * is no second list to drift.
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
 * The floor the discovery cannot drop below silently, matching
 * `MIN_PUBLISHED_PACKAGES` in `uplink-isolation.test.ts`. A walk that finds
 * nothing packs nothing and reports success.
 */
const MIN_PUBLISHED_PACKAGES = 3;

/** The published packages, packed exactly as a release would publish them. */
function packPublishedPackages(into) {
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
    // Through pack-publishable, not `npm pack`: npm ignores `publishConfig` field overrides, so a plain pack produces a manifest pointing at `src`.
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
 * Every module subpath the published packages export, as import specifiers.
 * `./biome` and the `.json` configs are shared CONFIG files nothing resolves
 * through the module graph, and a stylesheet has no types to check; all three
 * are matched by shape so the next one needs no edit here.
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

/** Requirements (1) and (2), then the planted typecheck violation, then (3). */
function selfTest(tarballs, workRoot) {
  const work = join(workRoot, "consumer");
  mkdirSync(work, { recursive: true });
  writeFileSync(
    join(work, "package.json"),
    `${JSON.stringify(
      {
        name: "published-packages-probe",
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
          /**
           * The peers the runtime leg needs to reach OUR code rather than stop
           * at a missing package, so an exempt entry's recorded reason is the
           * one a person reproduces: `ui-kit/testing` failing on a missing
           * `jest-axe` and failing on `styled.span` are different findings.
           */
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
  const specs = [...Object.keys(tarballs), ...publishedSubpaths()];
  /*
   * A namespace import proves a specifier RESOLVES and nothing more, so it is
   * blind to a declaration merge that failed to bind: the interface is still
   * exported and simply has no keys. `ContributionRegistry` and `SlotRegistry`
   * are augmented from inside `dist`, so they are the ones a broken
   * `declare module` specifier empties. `keyof` being `never` is the property
   * asserted, so no contribution id is named here.
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
      `✖ BLIND: could not install the packed packages outside the workspace.\n${install.stderr}`,
    );
    process.exit(1);
  }

  const MODES = [
    { label: "bundler", config: "tsconfig.json" },
    { label: "nodenext", config: "tsconfig.nodenext.json" },
  ];

  const typecheck = (config) => {
    const tsc = run("npx", ["tsc", "--noEmit", "-p", config], { cwd: work });
    const output = `${tsc.stdout}${tsc.stderr}`;
    return {
      errors: (output.match(/error TS\d+/g) ?? []).length,
      status: tsc.status,
      output,
    };
  };

  for (const mode of MODES) {
    const clean = typecheck(mode.config);
    if (clean.errors === 0 && clean.status === 0) continue;
    console.error(
      `✖ the control, which imports only the published entry points, produced ${clean.errors}\n` +
        `  error(s) (tsc exit ${clean.status}) under moduleResolution: ${mode.label}. One of:\n` +
        "    - a published subpath does not resolve from its own tarball\n" +
        "    - a `declare module` in the shipped declarations names a specifier this mode cannot\n" +
        "      resolve, so its augmentation did not bind (TS2322 on a `Bound<>` line)\n" +
        "    - BLIND: the environment fails at everything, including tsc not running at all\n" +
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
  // Planted under BOTH configs: a mode whose compiler never ran reports zero errors for the control above, which is that mode's own pass condition.
  const planted = [];
  for (const mode of MODES) {
    const violated = typecheck(mode.config);
    if (violated.errors === 0) {
      console.error(
        "✖ BLIND: a deliberate import of an export the sdk does not have typechecked CLEANLY\n" +
          `  under moduleResolution: ${mode.label}, so the clean control above proves nothing.`,
      );
      process.exit(1);
    }
    planted.push(`${mode.label} ${violated.errors}`);
  }
  console.log(
    `typecheck: ${specs.length} published entry point(s) resolved from the tarballs and the control ` +
      `typechecked clean under ${MODES.map((m) => m.label).join(" and ")}; the planted violation ` +
      `produced error(s) in each (${planted.join(", ")}).`,
  );

  runtimeImports(specs, work);
}

/**
 * Requirement (2). The sdk ships `src` beside `dist` for declaration and source
 * maps, so its tarball holds a second complete copy TypeScript can read. The
 * in-workspace `exports` map DOES point at `./src/*.ts`, and only
 * `publishConfig` plus `pack-publishable.mjs` redirect consumers, so if that
 * redirect ever broke, the control would typecheck clean against source while
 * the emitted declarations went unmeasured.
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
        "  package's `src/` rather than its `dist/`, so the clean typecheck proves nothing about\n" +
        "  the emitted declarations a consumer is pointed at:\n" +
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
 * Requirement (3). One bare `node` process per specifier, because one process
 * importing all of them stops at the first failure. Nothing is transformed or
 * bundled: the specifier goes to Node's own ESM resolver.
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

  const planted = importOnce(
    "@ksp-gonogo/sitrep-sdk/this-subpath-cannot-exist",
  );
  if (!planted) {
    console.error(
      "✖ BLIND: importing a subpath the sdk does not publish SUCCEEDED, so this is not resolving\n" +
        "  against the installed package and every entry point it calls loadable would be noise.",
    );
    process.exit(1);
  }

  const exemptionFor = (spec) => {
    const entry = RUNTIME_IMPORT_EXEMPT[spec];
    if (!entry) return null;
    if (typeof entry === "string") return entry;
    const peer = run(
      "node",
      [
        "--input-type=module",
        "-e",
        `import.meta.resolve(${JSON.stringify(entry.whileMissingPeer)});`,
      ],
      { cwd: work },
    );
    if (peer.status === 0) return null;
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
    if (failure && !exemption) {
      failed.push(`${spec}: ${failure}`);
      continue;
    }
    if (failure) {
      exempt.push(spec);
      continue;
    }
    if (exemption) exemptButLoading.push(spec);
  }

  if (failed.length > 0) {
    console.error(
      `✖ ${failed.length} published entry point(s) do not LOAD, whatever they typecheck as. A\n` +
        "  consumer that is not a bundler gets exactly this:\n" +
        `${failed.map((entry) => `    ${entry}`).join("\n")}\n\n` +
        "  If one cannot be made to load and the reason is not ours to fix, add it to\n" +
        "  RUNTIME_IMPORT_EXEMPT in scripts/published-packages-probe.mjs with that reason.",
    );
    process.exit(1);
  }

  // Both numbers counted from what happened and required to close, so a branch added later cannot drop out of the summary silently.
  if (loaded + exempt.length !== specs.length) {
    console.error(
      `✖ BLIND: ${loaded} loaded + ${exempt.length} exempt does not account for ${specs.length} ` +
        "published entry point(s), so this run measured something it is not reporting.",
    );
    process.exit(1);
  }
  console.log(
    `runtime: ${loaded} of ${specs.length} published entry point(s) loaded under a bare node ` +
      `import; the other ${exempt.length} are exempt with a recorded reason; a planted missing ` +
      "subpath failed to load.",
  );
  if (exemptButLoading.length > 0) {
    console.log(
      `  ${exemptButLoading.length} exempt entry point(s) now load and should be removed from ` +
        `RUNTIME_IMPORT_EXEMPT: ${exemptButLoading.join(", ")}`,
    );
  }
}

const workRoot = makeTempDir("gonogo-published-probe-");
const tarballs = packPublishedPackages(join(workRoot, "tarballs"));
console.log(
  `packed: ${Object.keys(tarballs).length} published package(s): ${Object.keys(tarballs).join(", ")}`,
);
selfTest(tarballs, workRoot);
