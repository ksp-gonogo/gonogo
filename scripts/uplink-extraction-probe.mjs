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
 * So before believing any number, the probe builds a package that imports a name
 * the SDK does not export and requires the typecheck to fail. If it does not,
 * the run exits BLIND rather than reporting a clean tree.
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
  return { errors, blocked: null, output };
}

/**
 * Prove the instrument before believing it: a package that imports a name the
 * SDK does not export MUST fail to typecheck.
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
          typescript: "^5.0.0",
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
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["index.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(work, "index.ts"),
    'import { thisExportCannotExist } from "@ksp-gonogo/sitrep-sdk";\nexport const planted = thisExportCannotExist;\n',
  );

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
  const tsc = run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
    cwd: work,
  });
  const errors = (`${tsc.stdout}${tsc.stderr}`.match(/error TS\d+/g) ?? [])
    .length;
  if (errors === 0) {
    console.error(
      "✖ BLIND: a deliberate import of an export the sdk does not have typechecked CLEANLY.\n" +
        "  The probe cannot see the failure it exists to measure, so every zero it reports\n" +
        "  below would be meaningless. Refusing to report success.",
    );
    process.exit(1);
  }
  console.log(
    `self-test: planted violation produced ${errors} error(s), the probe can see failures.`,
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
