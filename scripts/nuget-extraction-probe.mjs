#!/usr/bin/env node
/**
 * Can this Uplink's C# half LEAVE?
 *
 * The C# twin of `uplink-extraction-probe.mjs`. Inside the repo every Uplink
 * plugin and its test project reach `Sitrep.Contract` by `ProjectReference`, so
 * they compile against the source tree, and an Uplink can depend on a type the
 * packed `KspGonogo.Sitrep.Contract` never carries while every in-repo build
 * stays green. An outside author has only the package.
 *
 * So the probe packs the contract into a local feed, copies an Uplink (its
 * plugin, its own `.Contract` slice and its `.Tests`) to a directory outside the
 * repo, rewrites every reference into this repo's shared projects to a
 * `PackageReference` against that feed, and builds the plugin and runs the tests
 * there. A reference into the repo that is not one of the packaged projects is
 * reported rather than rewritten: an Uplink that needs it cannot leave.
 *
 * ## It must be able to fail
 *
 * `--plant` adds a source file to the copied plugin naming a type the package
 * does not carry. That build must fail; if it passes, the probe could not have
 * seen a real gap either and it exits as BLIND. CI runs both.
 *
 * ## What it measures is what a release WOULD publish
 *
 * The package is packed from this tree, so this answers "could an Uplink be
 * built from what this commit would publish", never "from what nuget.org
 * serves". The temporary tree is left for the OS: it is outside the repo and
 * deleting it file by file costs more than it saves.
 *
 * `--nupkg <file>` probes that package instead of packing one, so a release can
 * prove the very file it is about to push.
 *
 * ## The subject that never leaves
 *
 * Uplinks move out of this repo, so a probe that tested only the ones under
 * `mod/` would run out of subjects and report success having built nothing.
 * `nuget-probe-uplink/` beside this script is `GonogoProbeUplink`, an Uplink
 * that exists to be probed: a net48 plugin linking KSP, its own contract slice,
 * and a Tests project reaching all three packaged projects. CI's blocking run
 * names it, and a run that selects no Uplink at all fails.
 *
 * Usage:
 *   node scripts/nuget-extraction-probe.mjs [--uplink <GonogoXUplink>] [--plant] [--nupkg <file>]
 *
 * Needs KSP_MANAGED and KSP_GAMEDATA, the same reference set the `mod` job uses.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MOD = join(ROOT, "mod");
const PROBE_UPLINK_ROOT = join(ROOT, "scripts", "nuget-probe-uplink");
const PACKAGE_ID = "KspGonogo.Sitrep.Contract";

/** The shared projects the package carries, so a reference to one becomes the package. */
const PACKAGED = new Set([
  "Sitrep.Contract",
  "Sitrep.Contract.TestSupport",
  "Sitrep.Core",
]);

const args = process.argv.slice(2);
const plant = args.includes("--plant");
const uplinkAt = args.indexOf("--uplink");
const onlyUplink = uplinkAt >= 0 ? args[uplinkAt + 1] : null;
const nupkgAt = args.indexOf("--nupkg");
const givenNupkg = nupkgAt >= 0 ? resolve(args[nupkgAt + 1]) : null;

const kspManaged = process.env.KSP_MANAGED;
const kspGameData = process.env.KSP_GAMEDATA;
if (!kspManaged || !kspGameData) {
  console.error(
    "nuget extraction probe: set KSP_MANAGED and KSP_GAMEDATA to the KSP reference set.",
  );
  process.exit(1);
}

/**
 * Every dotnet call restores into a package cache of its own. The shared cache
 * is keyed by id and version, and the package under test never changes version
 * between two packs of one tree, so a restore would take whatever copy of it was
 * cached first and the probe would test that copy instead of this one.
 */
const probeEnv = () => ({
  ...process.env,
  NUGET_PACKAGES: join(work, "packages"),
});

function run(cmd, argv, cwd) {
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", env: probeEnv() });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

function errorsIn(out) {
  return [
    ...new Set(
      out
        .split("\n")
        .filter((l) => /error (CS|NU|MSB)\d+/.test(l))
        .map((l) => l.replace(/^.*?error /, "error ").trim()),
    ),
  ];
}

/** Every Uplink with a plugin project, discovered rather than listed, with the directory holding it. */
function uplinks() {
  return [MOD, PROBE_UPLINK_ROOT]
    .flatMap((root) =>
      readdirSync(root)
        .filter((d) => /^Gonogo[A-Za-z]+Uplink$/.test(d))
        .filter((d) => existsSync(join(root, d, `${d}.csproj`)))
        .map((name) => ({ name, root })),
    )
    .filter(({ name }) => onlyUplink === null || name === onlyUplink)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const selected = uplinks();
if (selected.length === 0) {
  console.error(
    onlyUplink === null
      ? "nuget extraction probe: found no Uplink with a plugin project, so there is nothing to probe"
      : `nuget extraction probe: no Uplink named ${onlyUplink} has a plugin project`,
  );
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "nuget-extraction-"));
const feed = join(work, "feed");
mkdirSync(feed);

if (givenNupkg) {
  if (
    !existsSync(givenNupkg) ||
    !basename(givenNupkg).startsWith(`${PACKAGE_ID}.`)
  ) {
    console.error(
      `nuget extraction probe: --nupkg must name an existing ${PACKAGE_ID} package, got ${givenNupkg}`,
    );
    process.exit(1);
  }
  copyFileSync(givenNupkg, join(feed, basename(givenNupkg)));
} else {
  const pack = run(
    "dotnet",
    [
      "pack",
      join(MOD, "Sitrep.Contract.Package", "Sitrep.Contract.Package.csproj"),
      "-c",
      "Release",
      "-o",
      feed,
      "--nologo",
    ],
    ROOT,
  );
  if (!pack.ok) {
    console.error(`nuget extraction probe: packing failed\n${pack.out}`);
    process.exit(1);
  }
}
const nupkg = readdirSync(feed).find(
  (f) => f.startsWith(`${PACKAGE_ID}.`) && f.endsWith(".nupkg"),
);
if (!nupkg) {
  console.error(`nuget extraction probe: no ${PACKAGE_ID} package in ${feed}`);
  process.exit(1);
}
const version = nupkg.slice(PACKAGE_ID.length + 1, -".nupkg".length);
console.log(
  `${givenNupkg ? "probing" : "packed"} ${PACKAGE_ID} ${version} in ${feed}`,
);

const referenceRe =
  /<ProjectReference\s+Include="([^"]+)"[^>]*?(?:\/>|>[\s\S]*?<\/ProjectReference>)/g;

/** Any other item reaching up out of its own project into a sibling directory. */
const upwardItemRe = /Include="\.\.[\\/]([^\\/"]+)[\\/][^"]*"/g;

/**
 * Rewrite one copied project: a packaged shared project becomes one package
 * reference, a sibling in the copy stays, and anything else is reported.
 */
function rewrite(csproj, copied) {
  const source = readFileSync(csproj, "utf8");
  const stranded = [];
  let packaged = false;
  const out = source.replace(referenceRe, (whole, include) => {
    const name = basename(include.replace(/\\/g, "/"), ".csproj");
    if (PACKAGED.has(name)) {
      if (packaged) return "";
      packaged = true;
      return `<PackageReference Include="${PACKAGE_ID}" Version="${version}" />`;
    }
    if (copied.has(name)) return whole;
    stranded.push(`project ${name}`);
    return whole;
  });
  for (const [, dir] of out.matchAll(upwardItemRe)) {
    if (!copied.has(dir) && !PACKAGED.has(dir))
      stranded.push(`files under ${dir}/`);
  }
  writeFileSync(csproj, out);
  return stranded;
}

let failed = 0;
for (const { name: uplink, root } of selected) {
  const dest = join(work, uplink);
  const parts = [uplink, `${uplink}.Contract`, `${uplink}.Tests`].filter((p) =>
    existsSync(join(root, p)),
  );
  for (const part of parts) {
    cpSync(join(root, part), join(dest, part), {
      recursive: true,
      filter: (src) => !/[\\/](bin|obj)$/.test(src),
    });
  }
  writeFileSync(
    join(dest, "nuget.config"),
    `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="probe" value="${feed}" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>
`,
  );
  const copied = new Set(parts);
  const stranded = parts.flatMap((part) =>
    rewrite(join(dest, part, `${part}.csproj`), copied),
  );
  if (stranded.length > 0) {
    failed += 1;
    console.log(
      `✖ ${uplink}: reaches this repo's ${[...new Set(stranded)].join(", ")}, which no package carries`,
    );
    continue;
  }

  if (plant) {
    writeFileSync(
      join(dest, uplink, "NugetProbePlant.cs"),
      "namespace NugetProbePlant { internal static class Plant { internal static object Use() => typeof(Sitrep.Contract.NugetProbePlantedAbsentType); } }\n",
    );
  }

  const props = [
    `-p:KspManaged=${kspManaged}`,
    `-p:KspGameData=${kspGameData}`,
  ];
  const build = run(
    "dotnet",
    [
      "build",
      join(dest, uplink, `${uplink}.csproj`),
      "-c",
      "Release",
      "--nologo",
      ...props,
    ],
    dest,
  );
  const tests = parts.includes(`${uplink}.Tests`)
    ? run(
        "dotnet",
        [
          "test",
          join(dest, `${uplink}.Tests`, `${uplink}.Tests.csproj`),
          "-c",
          "Release",
          "--nologo",
          ...props,
        ],
        dest,
      )
    : { ok: true, out: "" };

  if (plant) {
    if (build.ok) {
      console.log(
        `BLIND ${uplink}: a plugin naming a type the package lacks built anyway, so this probe cannot see a gap`,
      );
      failed += 1;
    } else if (!build.out.includes("NugetProbePlantedAbsentType")) {
      // Red for some other reason is not the plant being seen.
      console.log(
        `BLIND ${uplink}: the build failed, but not on the planted type`,
      );
      for (const e of errorsIn(build.out).slice(0, 4)) console.log(`    ${e}`);
      failed += 1;
    } else {
      console.log(
        `✓ ${uplink}: the planted absent type failed the build, as it must`,
      );
    }
    continue;
  }

  const summary = tests.out
    .split("\n")
    .find((l) => /^(Passed!|Failed!)/.test(l.trim()));
  if (build.ok && tests.ok) {
    console.log(
      `✓ ${uplink}: plugin builds and tests pass against the package :: ${summary?.trim() ?? "no tests"}`,
    );
  } else {
    failed += 1;
    console.log(
      `✖ ${uplink}: ${build.ok ? "tests" : "plugin build"} failed against the package`,
    );
    for (const e of errorsIn(build.ok ? tests.out : build.out).slice(0, 8))
      console.log(`    ${e}`);
    if (summary) console.log(`    ${summary.trim()}`);
  }
}

console.log(`\nwork tree: ${work}`);
process.exit(failed > 0 ? 1 : 0);
