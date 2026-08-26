#!/usr/bin/env node
/**
 * Can this Uplink LEAVE?
 *
 * ## The question the import ratchets cannot ask
 *
 * `packages/core/src/uplink-isolation.test.ts` and
 * `mod/Sitrep.Core.Tests/UplinkIsolationTests.cs` enforce that an Uplink imports
 * only `@ksp-gonogo/sitrep-sdk` and `@ksp-gonogo/ui-kit`. Both are correct and
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
 * the two permitted dependencies at packed tarballs, and installs with npm. What
 * survives that is what an outside author would get.
 *
 * Nothing is carried in alongside it, and that matters. An earlier version
 * copied `tsconfig.base.json` in and rewrote the `extends`, because every client
 * reached three levels up and out of its own package for it. That made the
 * measurement pass on a layout no author has. The clients now extend
 * `@ksp-gonogo/sitrep-sdk/tsconfig.base.json`, which arrives with a dependency
 * they already declare, so the probe has nothing left to help with.
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
 * baseline the sdk ships, importing every entry point the two packages publish,
 * and requires two things:
 *
 *  1. that CONTROL typechecks clean. It doubles as the subpath check: a subpath
 *     left out of `files` or out of the `publishConfig` export map resolves
 *     inside the workspace and nowhere else, which is the shape `/spine` shipped
 *     in and nothing saw until `import(bundleUrl)` threw
 *  2. the same file with one name the sdk does not export FAILS
 *
 * The planted half alone is not enough, and this file is the evidence. It used to
 * write its own tsconfig, whose default target made the sdk's own generated
 * declarations fail to PARSE (`skipLibCheck` does not suppress a syntax error),
 * so the plant "produced 223 errors" and satisfied the check with 222 of them
 * having nothing to do with it. Under the shipped baseline the same plant
 * produces one.
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
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTRACTION_DEBT } from "./uplink-extraction-debt.mjs";

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

/** The two published packages, packed exactly as a release would publish them. */
function packPermittedPackages(into) {
  const tarballs = {};
  for (const [name, dir] of [
    ["@ksp-gonogo/sitrep-sdk", "mod/sitrep-sdk"],
    ["@ksp-gonogo/ui-kit", "packages/ui-kit"],
  ]) {
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
 * Every module subpath the two published packages export, as import specifiers.
 *
 * Read off the manifests rather than listed, so a new subpath joins by existing.
 * `./biome` and the `.json` configs are shared CONFIG files that nothing resolves
 * through the module graph, and a stylesheet has no types to check; all three are
 * matched by shape so the next one needs no edit here.
 */
function publishedSubpaths() {
  const specs = [];
  for (const [name, dir] of [
    ["@ksp-gonogo/sitrep-sdk", "mod/sitrep-sdk"],
    ["@ksp-gonogo/ui-kit", "packages/ui-kit"],
  ]) {
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
          "@ksp-gonogo/sitrep-sdk": `file:${tarballs["@ksp-gonogo/sitrep-sdk"]}`,
          "@ksp-gonogo/ui-kit": `file:${tarballs["@ksp-gonogo/ui-kit"]}`,
          typescript: "^5.0.0",
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
  // The control reaches every module subpath the two packages publish. That is
  // the resolution check as well as the control: a subpath left out of `files`
  // or out of the `publishConfig` export map resolves inside the workspace and
  // nowhere else, which is the shape `/spine` shipped in and nothing saw until
  // `import(bundleUrl)` threw. A type-only namespace import needs no named
  // export to survive a barrel being reorganised, and still fails TS2307 when
  // the specifier does not resolve.
  const specs = [
    "@ksp-gonogo/sitrep-sdk",
    "@ksp-gonogo/ui-kit",
    ...publishedSubpaths(),
  ];
  const control = [
    ...specs.map(
      (spec, index) => `import * as Reached${index} from "${spec}";`,
    ),
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

  const typecheck = () => {
    const tsc = run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
      cwd: work,
    });
    const output = `${tsc.stdout}${tsc.stderr}`;
    return { errors: (output.match(/error TS\d+/g) ?? []).length, output };
  };

  const clean = typecheck();
  if (clean.errors > 0) {
    console.error(
      "✖ BLIND: the control, which imports only the root barrels and the subpaths these two\n" +
        `  packages publish, produced ${clean.errors} error(s). Either a published subpath does not\n` +
        "  resolve from its own tarball, which is the failure this control exists to catch, or the\n" +
        "  probe's environment fails at everything and every count below is its own noise.\n" +
        `${clean.output
          .split("\n")
          .filter((line) => /error TS/.test(line))
          .slice(0, 12)
          .map((line) => `    ${line.trim()}`)
          .join("\n")}`,
    );
    process.exit(1);
  }

  writeFileSync(
    join(work, "index.ts"),
    `${control}import { thisExportCannotExist } from "@ksp-gonogo/sitrep-sdk";\nexport const planted = thisExportCannotExist;\n`,
  );
  const violated = typecheck();
  if (violated.errors === 0) {
    console.error(
      "✖ BLIND: a deliberate import of an export the sdk does not have typechecked CLEANLY.\n" +
        "  The probe cannot see the failure it exists to measure, so every zero it reports\n" +
        "  below would be meaningless. Refusing to report success.",
    );
    process.exit(1);
  }
  console.log(
    `self-test: ${specs.length} published entry point(s) resolved from the tarballs and the control ` +
      `typechecked clean; the planted violation produced ${violated.errors} error(s).`,
  );
}

const workRoot = mkdtempSync(join(tmpdir(), "gonogo-extraction-"));
let exitCode = 0;
try {
  const tarballs = packPermittedPackages(join(workRoot, "tarballs"));
  selfTest(tarballs, workRoot);

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
  for (const uplink of uplinks) {
    const result = probe(
      join(ROOT, "mod", uplink.id, "client"),
      tarballs,
      workRoot,
      uplink.id,
    );
    const allowed = EXTRACTION_DEBT[uplink.id] ?? 0;

    if (result.blocked) {
      console.log(`✖ ${uplink.id}: CANNOT BE EXTRACTED. ${result.blocked}`);
      exitCode = 1;
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

  if (update) {
    const merged = { ...EXTRACTION_DEBT, ...measured };
    for (const [id, count] of Object.entries(merged))
      if (count === 0) delete merged[id];
    const header = readFileSync(DEBT_PATH, "utf8").split(
      "export const EXTRACTION_DEBT",
    )[0];
    writeFileSync(
      DEBT_PATH,
      `${header}export const EXTRACTION_DEBT = ${JSON.stringify(merged, null, 2)};\n`,
    );
    console.log(`\nRewrote ${DEBT_PATH} from this run.`);
    exitCode = 0;
  }
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
process.exit(exitCode);
