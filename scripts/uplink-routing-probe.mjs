#!/usr/bin/env node
/**
 * Does the engine route what the real, released Uplinks declare?
 *
 *   node scripts/uplink-routing-probe.mjs --uplinks <gonogo-uplinks checkout> [--only <dir>...]
 *
 * Packs the contract from this commit into a scratch copy of the checkout (the
 * way `vendor-uplinks-reference-set.sh` pins it there), builds each Uplink's
 * plugin against that package, and hands every plugin to
 * `uplink-routing-probe/`: a real `ChannelEngine`, the mod's own
 * `UplinkDiscovery`, and for each declared channel, command Subject and
 * dynamic namespace a check that the topic routes to a placed node and that a
 * subscribed client is sent a reading. One process per plugin, because an
 * Uplink whose startup reaches into Unity can take the process down.
 *
 * The plugins cannot run their own `Register` outside the game, so what is
 * probed is what the manifest declares (`UplinkManifest.Namespaces` for the
 * namespaces, which the engine registers before `Register`). An Uplink that
 * keeps a namespace only inside `Register` is probed for its channels and
 * Subjects and reported as such.
 *
 * Needs KSP_MANAGED and KSP_GAMEDATA, the reference set the `mod` job uses.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./temp-dir.mjs";

/**
 * Uplinks whose plugin cannot be loaded with the reference set the `mod` job
 * has: their types reference UnityEngine.UI, which that set does not carry. Each
 * is probed when the set has it and printed as not probed when it does not. The
 * list only shrinks: an Uplink not named here that fails to load is a failure,
 * and a named one that loads is reported so it can come off.
 */
const KNOWN_UNLOADABLE = ["kerbalism", "testflight"];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flagValues = (name) =>
  args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const [uplinksArg] = flagValues("--uplinks");
const only = flagValues("--only");
if (!uplinksArg) {
  console.error(
    "usage: uplink-routing-probe.mjs --uplinks <gonogo-uplinks checkout> [--only <dir>...]",
  );
  process.exit(2);
}
const managed = process.env.KSP_MANAGED;
const gamedata = process.env.KSP_GAMEDATA;
if (
  !managed ||
  !gamedata ||
  !existsSync(join(managed, "Assembly-CSharp.dll"))
) {
  console.error(
    "✖ KSP_MANAGED and KSP_GAMEDATA must name the reference set (Assembly-CSharp.dll not found)",
  );
  process.exit(2);
}

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    ...options,
  });
  return result;
}

const work = makeTempDir("gonogo-routing-probe-");
const scratch = join(work, "uplinks");
cpSync(resolve(uplinksArg), scratch, {
  recursive: true,
  filter: (src) => !/[\\/](node_modules|\.git|bin|obj)([\\/]|$)/.test(src),
});

const pin = run(
  "bash",
  [join(ROOT, "scripts/vendor-uplinks-reference-set.sh"), scratch, "HEAD"],
  { cwd: ROOT },
);
if (pin.status !== 0) {
  console.error(`✖ could not pack the contract:\n${pin.stdout}${pin.stderr}`);
  process.exit(1);
}

const dirs = readdirSync(join(scratch, "uplinks")).filter(
  (d) => only.length === 0 || only.includes(d),
);
const plugins = [];
const unbuilt = [];
for (const dir of dirs) {
  const modDir = join(scratch, "uplinks", dir, "mod");
  if (!existsSync(modDir)) continue;
  const csproj = readdirSync(modDir).find((f) =>
    /^Gonogo.*Uplink\.csproj$/.test(f),
  );
  if (!csproj) continue;
  /* The metadata a release bakes into the plugin (who wrote it, which client it
     fetches) is gitignored and written by `uplink-tools bake`. None of it takes
     part in routing, so the scratch copy gets empty values rather than a node
     build of every Uplink's client. */
  const { csharpNamespace } = JSON.parse(
    readFileSync(join(scratch, "uplinks", dir, "uplink.json"), "utf8"),
  );
  const stubs = {
    Provenance:
      'public const string Name = ""; public const string Author = ""; public const string Repo = "";',
    ExpectedClientHash: 'public const string Value = "";',
    ClientSource:
      'public const string Url = ""; public const string DevPath = "";',
  };
  const build = () =>
    run(
      "dotnet",
      [
        "build",
        join(modDir, csproj),
        "-c",
        "Release",
        "--nologo",
        "-v",
        "q",
        "-clp:ErrorsOnly",
        `-p:KspManaged=${managed}`,
        `-p:KspGameData=${gamedata}`,
      ],
      { cwd: scratch },
    );
  /* Some projects generate these classes at build time and some read files the
     bake step writes. The build says which are missing (CS0103) and which it
     already had (CS0101), and the stub set follows that until it stops moving. */
  let built = build();
  const wanted = new Set();
  for (let pass = 0; pass < 4 && built.status !== 0; pass++) {
    const out = built.stdout + built.stderr;
    const before = [...wanted].sort().join();
    for (const name of Object.keys(stubs)) {
      if (new RegExp(`CS0103: The name '${name}' does not exist`).test(out))
        wanted.add(name);
      if (
        new RegExp(
          `CS0101: .*already contains a definition for '${name}'`,
        ).test(out)
      )
        wanted.delete(name);
    }
    if ([...wanted].sort().join() === before) break;
    const body = [...wanted]
      .map((name) => `    internal static class ${name} { ${stubs[name]} }`)
      .join("\n");
    writeFileSync(
      join(modDir, "ProbeMetadata.g.cs"),
      wanted.size === 0 ? "" : `namespace ${csharpNamespace}\n{\n${body}\n}\n`,
    );
    built = build();
  }
  const dll = join(
    modDir,
    "bin",
    "Release",
    csproj.replace(/\.csproj$/, ".dll"),
  );
  if (built.status !== 0 || !existsSync(dll)) {
    unbuilt.push(
      `${dir}: ${(built.stdout + built.stderr)
        .split("\n")
        .filter((l) => /error/.test(l))
        .slice(0, 3)
        .join(" | ")}`,
    );
    continue;
  }
  plugins.push({ dir, dll });
}
if (unbuilt.length > 0) {
  console.error(
    `✖ ${unbuilt.length} Uplink(s) did not build against this commit's contract:\n  ${unbuilt.join("\n  ")}`,
  );
  process.exit(1);
}
if (plugins.length === 0) {
  console.error(
    "✖ no Uplink plugin was found to probe; a walk that finds nothing reports success",
  );
  process.exit(2);
}

const probeProject = join(
  ROOT,
  "scripts/uplink-routing-probe/UplinkRoutingProbe.csproj",
);
const probeBuild = run(
  "dotnet",
  [
    "build",
    probeProject,
    "-c",
    "Release",
    "--nologo",
    "-v",
    "q",
    "-clp:ErrorsOnly",
  ],
  { cwd: ROOT },
);
if (probeBuild.status !== 0) {
  console.error(
    `✖ the probe did not build:\n${probeBuild.stdout}${probeBuild.stderr}`,
  );
  process.exit(1);
}
const probeDll = join(
  ROOT,
  "scripts/uplink-routing-probe/bin/Release/net10.0/UplinkRoutingProbe.dll",
);

const refs = [
  managed,
  gamedata,
  ...readdirSync(gamedata).map((d) => join(gamedata, d, "Plugins")),
]
  .filter(existsSync)
  .flatMap((r) => ["--refs", r]);

let failed = 0;
let checked = 0;
const skipped = [];
for (const { dir, dll } of plugins) {
  const listed = KNOWN_UNLOADABLE.includes(dir);
  const probe = run("dotnet", [
    probeDll,
    ...(listed ? ["--allow-unloadable"] : []),
    ...refs,
    dll,
  ]);
  const lines = probe.stdout
    .split("\n")
    .filter((l) => /^(ok|FAIL|note|skip) /.test(l));
  console.log(`== ${dir}`);
  for (const line of lines) console.log(line);
  const wasSkipped = lines.some((l) => l.startsWith("skip"));
  if (wasSkipped) skipped.push(dir);
  if (listed && !wasSkipped)
    console.log(`note ${dir} loaded here, so it can come off KNOWN_UNLOADABLE`);
  checked += lines.filter((l) => l.startsWith("ok")).length;
  if (probe.status !== 0) {
    failed++;
    if (!lines.some((l) => l.startsWith("FAIL"))) {
      console.log(
        `FAIL ${dir}: the probe exited ${probe.status ?? probe.signal} without a verdict`,
      );
    }
  }
}
if (checked === 0) {
  console.error(
    "✖ not one topic was checked; a probe that checks nothing reports success",
  );
  process.exit(2);
}
console.log(
  failed === 0
    ? `routing probe: ${plugins.length - skipped.length} of ${plugins.length} Uplink(s) probed, every declared topic routes and delivers${skipped.length > 0 ? `; not probed, a reference assembly is missing here: ${skipped.join(", ")}` : ""}`
    : `routing probe: ${failed} of ${plugins.length} Uplink(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
