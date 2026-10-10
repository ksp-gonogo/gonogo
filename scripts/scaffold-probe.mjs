#!/usr/bin/env node
/**
 * Can an author start an Uplink with `uplink-tools new` and end with a widget
 * on the dashboard, holding only what a release publishes?
 *
 * Every other check of the scaffold reads the text it writes. This one is the
 * author: in a directory outside the repo, with the three npm packages as
 * packed tarballs and `KspGonogo.Sitrep.Contract` as a packed .nupkg in a
 * local feed, it runs the commands the scaffold's own closing message names,
 * in order, and requires each to work:
 *
 *   uplink-tools new        with only uplink-tools and the sdk installed
 *   npm install             in client/
 *   uplink-tools codegen    then codegen --check
 *   npm run typecheck
 *   npm run page, then npm test
 *   dotnet test mod-tests
 *   npm run release         bundle, bake, compile, verify, zip
 *
 * It does that for both shapes `new` writes: an Uplink with Topics of its own,
 * every question answered by a flag, and one with none, scaffolded with `--yes`.
 *
 * and then follows the result where an install would take it: the released DLL
 * is loaded by the mod's own assembly scan into a real stream engine
 * (`scaffold-probe-host/`), and the app reads that stream's roster, loads the
 * client the plugin announced and draws its widget
 * (`packages/app/src/uplinks/scaffoldProbe.probe.tsx`).
 *
 * ## The only things it changes in the scaffold
 *
 * The scaffold pins all three npm packages and the NuGet package to exactly the
 * version of the tools that wrote it. The probe first requires those pins to be
 * the version it packed, then points the three npm specifiers at the tarballs
 * and adds a `nuget.config` naming the local feed. Nothing else is edited, and
 * both edits are printed.
 *
 * ## It must be able to fail
 *
 * Each plant is run through the same commands and must fail, or the probe exits
 * as BLIND:
 *
 *   - `new` with no terminal and a question unanswered, which must stop and
 *     name the flag instead of waiting on a prompt
 *   - a widget registered with no description, which the page must refuse
 *   - `docs` run where no browser is installed, which is how it is known that
 *     no earlier command needed one
 *   - a client import of `@ksp-gonogo/core`, which no author can install
 *   - a contract property added after codegen, which `codegen --check` must see
 *   - the package's codegen folder removed, which `codegen` must refuse
 *   - a project that references the game with no KSP_ROOT, which must say so
 *   - a plugin baked without its bundle, which the app must refuse
 *   - a plugin that announces no client, which the app must not attempt
 *
 * ## Tree, or published
 *
 * By default everything is packed from this tree, so it answers "would an
 * author succeed with what this commit would publish". `--published <version>`
 * packs nothing: it runs `npm exec @ksp-gonogo/uplink-tools@<version>` in an
 * empty directory, as `npx` does, and installs every package from npm and
 * nuget.org. That is the cold start itself. The stream and app legs are skipped
 * there, since they test this tree's mod and app against the release's client.
 *
 * Needs `pnpm build`, `dotnet` and the network (third-party npm and NuGet
 * packages). `GONOGO_KEEP_TMP=1` keeps the scaffolded directory. `KSP_ROOT`,
 * when it points at an install or at the ksp-managed layout, adds a build of a
 * plugin that references Assembly-CSharp.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  publishedPackages,
  stampTarball,
  treeRelease,
} from "./release-packages.mjs";
import { makeTempDir } from "./temp-dir.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ID = "probe";
const NS = "GonogoProbeUplink";
const NUGET_ID = "KspGonogo.Sitrep.Contract";
const SCOPED = [
  "@ksp-gonogo/sitrep-sdk",
  "@ksp-gonogo/ui-kit",
  "@ksp-gonogo/uplink-tools",
];

const publishedAt = process.argv.indexOf("--published");
const published =
  publishedAt === -1 ? undefined : process.argv[publishedAt + 1];
if (publishedAt !== -1 && !published) {
  console.error("usage: scaffold-probe.mjs [--published <version>]");
  process.exit(2);
}

const fail = (message) => {
  console.error(`\n✖ scaffold-probe: ${message}`);
  process.exit(1);
};

const work = makeTempDir("gonogo-scaffold-probe-");
const uplink = join(work, ID);
const client = join(uplink, "client");
mkdirSync(uplink);

// A cache of its own: the feed's package carries the same version on every run and different bytes, and the shared cache would hand back the first one it ever saw.
const env = {
  ...process.env,
  NUGET_PACKAGES: join(work, "nuget-packages"),
  npm_config_cache: join(work, "npm-cache"),
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
  npm_config_audit: "false",
  // Always, on every machine: an author's own CI runs these same commands, and one of them once refused to run there while passing everywhere else.
  CI: "true",
  // Empty, always: no command an author runs before `docs` may need a browser, and a machine with one cached would never show that one did.
  PLAYWRIGHT_BROWSERS_PATH: join(work, "no-browsers"),
};
mkdirSync(env.PLAYWRIGHT_BROWSERS_PATH);
// The scaffold's projects must find KSP only when a step here says where it is.
for (const name of Object.keys(env)) {
  if (/^ksp_?(root|managed|gamedata)$/i.test(name)) delete env[name];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env,
    ...options,
  });
  if (result.error) fail(`${command}: ${result.error.message}`);
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function must(label, command, args, options = {}) {
  const { ok, output } = run(command, args, options);
  if (!ok) {
    console.error(output);
    fail(`${label} failed`);
  }
  console.log(`  ✓ ${label}`);
  return output;
}

/**
 * The one step that needs a browser gets the machine's own, where every other
 * step is given a folder with none in it. It is the browser for the Playwright
 * the scaffold itself installed, fetched here when the machine has another.
 */
const withBrowser = { ...env };
delete withBrowser.PLAYWRIGHT_BROWSERS_PATH;
if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
  withBrowser.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
}
const UNREADABLE = /cannot read at this size/;
const SIZES = /(defaultSize|minSize): \{ w: \d+, h: \d+ \}/g;

/**
 * A new Uplink's own widget has to pass the readability check `docs` runs on
 * it, at its default size and its smallest. A scaffold that draws a warning on
 * its first render teaches every author that the warning is ignored.
 *
 * The check is shown to see first: the widget is given tiles too small
 * for it, and `docs` must then say it cannot be read.
 */
function drawsReadably(clientDir, widgetFile) {
  const options = { cwd: clientDir, env: withBrowser };
  must(
    "playwright install chromium",
    "npx",
    ["playwright", "install", "chromium"],
    options,
  );
  const source = readFileSync(widgetFile, "utf8");
  if ((source.match(SIZES) ?? []).length !== 2) {
    fail(`${widgetFile} does not state a defaultSize and a minSize`);
  }
  writeFileSync(
    widgetFile,
    source.replace(SIZES, (_all, which) =>
      which === "minSize"
        ? "minSize: { w: 2, h: 2 }"
        : "defaultSize: { w: 3, h: 3 }",
    ),
  );
  // Its exit code is not read: a tile that small may fail the render outright, and either way it has to say why.
  const { output: squeezed } = run("npx", ["uplink-tools", "docs"], options);
  writeFileSync(widgetFile, source);
  if (!UNREADABLE.test(squeezed)) {
    console.error(squeezed);
    console.error(
      "\n✖ scaffold-probe: BLIND. A widget given a 3 by 3 tile and a 2 by 2 minimum drew no readability warning, so this probe could not have seen one.",
    );
    process.exit(1);
  }
  console.log(
    "  ✓ plant, the widget at 3 by 3 with a 2 by 2 minimum: docs says it cannot be read",
  );
  const drawn = must(
    "uplink-tools docs",
    "npx",
    ["uplink-tools", "docs"],
    options,
  );
  if (UNREADABLE.test(drawn)) {
    console.error(drawn);
    fail(
      "the scaffold's own widget draws something an operator cannot read at its default or its smallest size",
    );
  }
  console.log(
    "  ✓ the widget is readable at its default and its smallest size",
  );
}

/** A step that has to fail, and to say `saying` while it does. */
function mustFail(label, saying, command, args, options = {}) {
  const { ok, output } = run(command, args, options);
  if (ok) {
    console.error(
      `\n✖ scaffold-probe: BLIND. ${label}: the command passed, so this probe could not have seen the fault.`,
    );
    process.exit(1);
  }
  if (!saying.test(output)) {
    console.error(output);
    fail(`${label}: it failed, but not saying ${saying}`);
  }
  console.log(`  ✓ plant, ${label}: refused`);
}

/*
 * MSBuild and npm both walk up. A Directory.Build.props above the scaffold
 * would supply properties silently, and a workspace file would resolve the
 * client's imports to this repo's sources.
 */
for (let dir = work; ; dir = dirname(dir)) {
  for (const file of [
    "Directory.Build.props",
    "Directory.Build.targets",
    "pnpm-workspace.yaml",
    "nuget.config",
    "NuGet.Config",
  ]) {
    if (existsSync(join(dir, file))) {
      fail(
        `${join(dir, file)} sits above the scratch directory, so nothing built there is built alone`,
      );
    }
  }
  if (dirname(dir) === dir) break;
}

const dotnetQuiet = ["--nologo", "-v", "quiet", "-clp:ErrorsOnly"];

// ── What the author installs ────────────────────────────────────────────────

let version;
const tarballs = {};
let feed;
if (published) {
  version = published;
  console.log(`scaffold-probe: the published packages, at ${version}`);
} else {
  version = treeRelease(ROOT);
  console.log(
    `scaffold-probe: packing what this tree would publish, as ${version}`,
  );
  for (const { name, dir } of publishedPackages(ROOT)) {
    if (!existsSync(join(ROOT, dir, "dist"))) {
      fail(`${dir}/dist is missing. Run \`pnpm build\` first.`);
    }
    // The tarball's path is the script's standard output, and only that.
    const packed = run(process.execPath, [
      join(ROOT, "scripts/pack-publishable.mjs"),
      join(ROOT, dir),
      join(work, "tarballs"),
    ]);
    if (!packed.ok) {
      console.error(packed.output);
      fail(`could not pack ${name}`);
    }
    tarballs[name] = stampTarball(
      packed.stdout.trim(),
      version,
      join(work, "stamped"),
      ROOT,
    );
  }
  for (const name of SCOPED) {
    if (!tarballs[name]) fail(`${name} is not among the packed packages`);
  }
  feed = join(work, "feed");
  must(`pack ${NUGET_ID}`, "dotnet", [
    "pack",
    join(ROOT, "mod/Sitrep.Contract.Package/Sitrep.Contract.Package.csproj"),
    "-c",
    "Release",
    "-o",
    feed,
    "--nologo",
    "-v",
    "quiet",
  ]);
  if (!existsSync(join(feed, `${NUGET_ID}.${version}.nupkg`))) {
    fail(`the pack did not produce ${NUGET_ID}.${version}.nupkg in ${feed}`);
  }
}

// ── uplink-tools new, as npx runs it ────────────────────────────────────────

let launcher;
let bin;
// Every question answered by its flag, since there is no terminal here and `new` asks nothing without one.
const newArgs = [
  "new",
  ID,
  "--name",
  "Probe",
  "--author",
  "Scaffold Probe",
  "--repo",
  "ksp-gonogo/probe",
  "--topics",
  "own",
  "--workflows",
  "--no-ksp",
  // In an install the tarballs are named, so the scaffold's own install would look for these versions on npm and not find them. The probe runs the same steps below.
  ...(published ? [] : ["--no-install", "--no-generate"]),
];
if (published) {
  console.log("scaffold-probe: npm exec in an empty directory, as npx does");
  must(
    `npm exec @ksp-gonogo/uplink-tools@${version} new`,
    "npm",
    [
      "exec",
      "--yes",
      `--package=@ksp-gonogo/uplink-tools@${version}`,
      "--",
      "uplink-tools",
      ...newArgs,
    ],
    { cwd: uplink },
  );
} else {
  /*
   * The tools and the sdk, and nothing else: no React, no ui-kit, no esbuild, no
   * Playwright. That is what `npx @ksp-gonogo/uplink-tools new` has to run on,
   * and the sdk is named only because a tarball's exact pin on its sibling
   * cannot be found on npm.
   */
  launcher = join(work, "launcher");
  mkdirSync(launcher);
  writeFileSync(join(launcher, "package.json"), '{ "private": true }\n');
  must(
    "install uplink-tools and the sdk alone",
    "npm",
    [
      "install",
      "--no-package-lock",
      tarballs["@ksp-gonogo/uplink-tools"],
      tarballs["@ksp-gonogo/sitrep-sdk"],
    ],
    { cwd: launcher },
  );
  const installed = readdirSync(join(launcher, "node_modules")).filter(
    (name) => !name.startsWith("."),
  );
  for (const heavy of ["react", "playwright", "esbuild", "styled-components"]) {
    if (installed.includes(heavy)) {
      fail(
        `installing uplink-tools alone brought in ${heavy}. A peer that is not optional is installed ` +
          "by npx before `new` writes a file, and two of them asking for different Reacts is how " +
          "`npx @ksp-gonogo/uplink-tools new` failed in an empty directory.",
      );
    }
  }
  bin = join(launcher, "node_modules/.bin/uplink-tools");
  for (const verb of [
    "new",
    "codegen",
    "bundle",
    "bake",
    "package",
    "release",
    "page",
  ]) {
    must(`uplink-tools ${verb} --help, with nothing else installed`, bin, [
      verb,
      "--help",
    ]);
  }
  // The two that draw widgets answer --help without the client's React and ui-kit, but cannot run without them and have to say that rather than print a stack.
  for (const verb of ["render", "docs"]) {
    must(`uplink-tools ${verb} --help, with nothing else installed`, bin, [
      verb,
      "--help",
    ]);
    const drawn = run(bin, [verb]);
    if (drawn.ok || !/needs the client's dependencies/.test(drawn.output)) {
      console.error(drawn.output);
      fail(
        `uplink-tools ${verb}, with nothing else installed, did not say what it needs`,
      );
    }
  }
  // With no terminal and an answer missing it must stop and say which, never wait on a prompt nobody will answer.
  const unanswered = join(work, "unanswered");
  mkdirSync(unanswered);
  mustFail(
    "new with no terminal and a question unanswered",
    /stdin is not a terminal[\s\S]*--author <name>/,
    bin,
    ["new", "unanswered"],
    { cwd: unanswered },
  );
  if (readdirSync(unanswered).length > 0) {
    fail("new wrote files although a question went unanswered");
  }
  must("uplink-tools new", bin, newArgs, { cwd: uplink });
}

const read = (path) => readFileSync(join(uplink, path), "utf8");
const pkgPath = join(client, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const pins = { ...pkg.dependencies, ...pkg.devDependencies };
for (const name of SCOPED) {
  if (pins[name] !== version) {
    fail(`the scaffold pins ${name} to ${pins[name]}, not exactly ${version}`);
  }
}
for (const project of [
  `mod/${NS}.csproj`,
  `mod-contract/${NS}.Contract.csproj`,
  `mod-tests/${NS}.Tests.csproj`,
]) {
  if (!read(project).includes(`Include="${NUGET_ID}" Version="[${version}]"`)) {
    fail(`${project} does not reference ${NUGET_ID} at exactly ${version}`);
  }
}
console.log(`  ✓ every pin the scaffold wrote is exactly ${version}`);

/** The probe's only two edits to a scaffold: its three npm specifiers to the packed tarballs, and a feed for the packed contract. */
function pointAtPacked(dir) {
  const manifestPath = join(dir, "client/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of SCOPED) {
      if (manifest[field]?.[name]) {
        manifest[field][name] = `file:${tarballs[name]}`;
      }
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(dir, "nuget.config"),
    `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="scaffold-probe" value="${feed}" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>
`,
  );
}

if (!published) {
  pointAtPacked(uplink);
  console.log(
    `  edited client/package.json: ${SCOPED.join(", ")} now name the packed tarballs\n` +
      `  added nuget.config: ${NUGET_ID} ${version} comes from ${feed}`,
  );
  must("npm install", "npm", ["install", "--no-package-lock"], { cwd: client });
  must("uplink-tools codegen", "npx", ["uplink-tools", "codegen"], {
    cwd: client,
  });
  must("npm run page", "npm", ["run", "page"], { cwd: client });
}

// ── The author's own checks ─────────────────────────────────────────────────

console.log("scaffold-probe: the scaffold's own checks");
for (const file of [
  "contract.ts",
  "topic-map.ts",
  "command-map.ts",
  "units.ts",
  "units.json",
]) {
  if (!existsSync(join(client, "src/__generated__", file))) {
    fail(`client/src/__generated__/${file} was not generated`);
  }
}
// The seed declares no command, and its map has to be a file the client still typechecks and lints: an import of nothing is neither.
if (
  /import type \{\s*\}/.test(
    readFileSync(join(client, "src/__generated__/command-map.ts"), "utf8"),
  )
) {
  fail("the seed's empty command map imports nothing from ./contract.js");
}
if (!existsSync(join(client, "README.md"))) {
  fail("the generated page, client/README.md, was not written");
}
// The page of a fresh scaffold is the first thing its author reads back, so every part of it has to say something.
const pageText = readFileSync(join(client, "README.md"), "utf8");
const widgetRecords = JSON.parse(
  readFileSync(join(client, "docs/widgets.json"), "utf8"),
).widgets;
if (widgetRecords.length === 0) fail("the generated page lists no widget");
for (const widget of widgetRecords) {
  if (!widget.description?.trim() || !pageText.includes(widget.description)) {
    fail(`the generated page does not carry a description of ${widget.id}`);
  }
}
if (/undefined|\bnull\b/.test(pageText)) {
  fail("the generated page prints an undefined or null where a value belongs");
}
if (!existsSync(join(uplink, ".github/workflows/ci.yml"))) {
  fail("--workflows was given and no .github/workflows/ci.yml was written");
}
const npmRun = (script) =>
  must(`npm run ${script}`, "npm", ["run", script], { cwd: client });
npmRun("codegen:check");
npmRun("typecheck");
must("npm test", "npm", ["test"], { cwd: client });
// That every step above ran without a browser is only worth saying if this environment really has none, so the one command that does need one must fail here for want of it.
mustFail(
  "docs, which draws the pictures, with no browser installed",
  /Executable doesn't exist|playwright install/,
  "npx",
  ["uplink-tools", "docs", "--no-assets"],
  { cwd: client },
);
const widgetFile = join(client, "src/Heartbeat/index.tsx");
drawsReadably(client, widgetFile);
// The pictures now exist, so the page links them and has to be current again for the test run below.
npmRun("page");
must("npm test, with the pictures drawn", "npm", ["test"], { cwd: client });

/*
 * Three things an author does in their first hour, each of which once left
 * them with commands that pointed at each other.
 */
{
  const widget = readFileSync(widgetFile, "utf8");
  const manifestFile = join(client, "gonogo-uplink.json");
  const readme = () => readFileSync(join(client, "README.md"), "utf8");

  // A changed widget makes the page stale and, as often as not, breaks one of its own tests in the same edit. `page` has to write the page anyway.
  const brokenTest = join(client, "src/Heartbeat/broken.test.ts");
  writeFileSync(
    brokenTest,
    'import { expect, it } from "vitest";\nit("fails", () => expect(1).toBe(2));\n',
  );
  writeFileSync(
    widgetFile,
    widget.replace("It has no controls.", "It has no controls at all."),
  );
  mustFail(
    "npm test, with a stale page and another test failing",
    /no longer matches the code/,
    "npm",
    ["test"],
    { cwd: client },
  );
  const wrote = must(
    "npm run page, with another test failing",
    "npm",
    ["run", "page"],
    { cwd: client },
  );
  if (
    !/page: wrote .*README\.md/.test(wrote) ||
    !readme().includes("It has no controls at all.")
  ) {
    console.error(wrote);
    fail(
      "page did not write the stale page while another test was failing, or did not say that it had",
    );
  }
  rmSync(brokenTest);
  must("npm test, once the page is written", "npm", ["test"], { cwd: client });
  writeFileSync(widgetFile, widget);
  const unchanged = must(
    "npm run page, back to the widget as scaffolded",
    "npm",
    ["run", "page"],
    { cwd: client },
  );
  if (!/page: wrote/.test(unchanged)) fail("page did not say what it wrote");
  if (
    !/Nothing written/.test(
      must("npm run page, with nothing to do", "npm", ["run", "page"], {
        cwd: client,
      }),
    )
  ) {
    fail("page with nothing to write did not say so");
  }

  // A minSize raised to the defaultSize leaves the widget one size, and the fixture still asks for two.
  const defaultSize = /defaultSize: (\{ w: \d+, h: \d+ \})/.exec(widget)?.[1];
  if (!defaultSize) fail(`${widgetFile} states no defaultSize`);
  writeFileSync(
    widgetFile,
    widget.replace(/minSize: \{ w: \d+, h: \d+ \}/, `minSize: ${defaultSize}`),
  );
  mustFail(
    "a fixture naming the min mode of a widget that has one size",
    /no separate smallest size to draw[\s\S]*Remove "min" from "_scene.modes" in [^\n]*beating\.json/,
    "npm",
    ["run", "page"],
    { cwd: client },
  );
  writeFileSync(widgetFile, widget);

  // Drawing the pictures again must not blank the hash a release stamped into the committed manifest.
  const manifest = readFileSync(manifestFile, "utf8");
  const stamped =
    "sha256-0000000000000000000000000000000000000000000000000000000000000000";
  writeFileSync(
    manifestFile,
    manifest.replace(/"integrity": "[^"]*"/, `"integrity": "${stamped}"`),
  );
  const drawn = must(
    "uplink-tools docs, over a manifest a release stamped",
    "npx",
    ["uplink-tools", "docs"],
    { cwd: client, env: withBrowser },
  );
  if (
    !readFileSync(manifestFile, "utf8").includes(stamped) ||
    /EMPTY integrity/.test(drawn)
  ) {
    console.error(drawn);
    fail(
      "docs with no --bundle blanked the integrity already in gonogo-uplink.json",
    );
  }
  writeFileSync(manifestFile, manifest);
  must("npm test, with the scaffold as it was", "npm", ["test"], {
    cwd: client,
  });
}
const testsProject = join(uplink, "mod-tests", `${NS}.Tests.csproj`);
must("dotnet test mod-tests", "dotnet", ["test", testsProject, ...dotnetQuiet]);

console.log("scaffold-probe: npm run release");
npmRun("release");
const bundle = join(client, "dist", ID, `${ID}.client.js`);
const sidecar = join(client, "dist", ID, "gonogo-uplink.json");
const plugin = join(uplink, "mod/bin/Release", `${NS}.dll`);
const zip = join(uplink, "dist", `${NS}.zip`);
for (const artifact of [bundle, sidecar, plugin, zip]) {
  if (!existsSync(artifact)) fail(`release did not produce ${artifact}`);
}
const integrity = `sha256-${createHash("sha256").update(readFileSync(bundle)).digest("hex")}`;
if (JSON.parse(readFileSync(sidecar, "utf8")).integrity !== integrity) {
  fail(
    "gonogo-uplink.json's integrity is not the hash of the bundle beside it",
  );
}
const dllBytes = readFileSync(plugin);
const declared = JSON.parse(read("uplink.json"));
for (const [what, value] of [
  ["the client URL", declared.client.url],
  ["the bundle's hash", integrity],
]) {
  if (!dllBytes.includes(Buffer.from(value, "utf16le"))) {
    fail(`the released DLL does not carry ${what}`);
  }
}
const zipped = must("list the mod zip", "unzip", ["-Z1", zip])
  .split("\n")
  .filter(Boolean)
  .sort();
const expectedZip = [
  `GameData/${NS}/Plugins/${NS}.Contract.dll`,
  `GameData/${NS}/Plugins/${NS}.dll`,
];
if (zipped.join("\n") !== expectedZip.join("\n")) {
  fail(
    `the mod zip holds [${zipped.join(", ")}], expected exactly [${expectedZip.join(", ")}]. ` +
      "Sitrep.Contract.dll in particular is GonogoCore's to provide.",
  );
}
console.log(
  "  ✓ the bundle, its sidecar, the DLL and the zip agree with each other",
);

// ── Plants in the author's own commands ─────────────────────────────────────

console.log("scaffold-probe: plants");
const widget = join(client, "src/Heartbeat/index.tsx");
const widgetSource = readFileSync(widget, "utf8");
writeFileSync(
  widget,
  `import { getComponents } from "@ksp-gonogo/core";\nvoid getComponents;\n${widgetSource}`,
);
mustFail(
  "a client import of @ksp-gonogo/core",
  /@ksp-gonogo\/core/,
  "npm",
  ["run", "typecheck"],
  { cwd: client },
);
writeFileSync(widget, widgetSource);

const described = widgetSource.replace(
  /description: "[^"]*",/,
  'description: "",',
);
if (described === widgetSource) {
  fail("the scaffolded widget has no description to blank");
}
writeFileSync(widget, described);
mustFail(
  "a widget registered with no description",
  /registers? no `description`/,
  "npm",
  ["run", "page"],
  { cwd: client },
);
writeFileSync(widget, widgetSource);

const payloads = join(uplink, "mod-contract/ProbePayloads.cs");
const payloadSource = readFileSync(payloads, "utf8");
const withProperty = payloadSource.replace(
  /(\n\s*public double\? Ticks \{ get; set; \})/,
  "$1\n\n    /// <summary>Planted after codegen ran.</summary>\n    public double? Planted { get; set; }",
);
if (withProperty === payloadSource) {
  fail("the scaffolded payload has no Ticks property to plant beside");
}
writeFileSync(payloads, withProperty);
mustFail(
  "a contract property added after codegen",
  /is not what the contract slice generates/,
  "npm",
  ["run", "codegen:check"],
  { cwd: client },
);
writeFileSync(payloads, payloadSource);

const codegenFolder = join(
  env.NUGET_PACKAGES,
  NUGET_ID.toLowerCase(),
  version,
  "codegen",
);
if (!existsSync(codegenFolder)) {
  fail(`the restored package has no ${codegenFolder} to take away`);
}
rmSync(codegenFolder, { recursive: true });
mustFail(
  "the package's codegen folder removed",
  /carries no codegen\//,
  "npm",
  ["run", "codegen"],
  { cwd: client },
);
// Put back by a fresh restore of the same package, and proved put back.
rmSync(join(env.NUGET_PACKAGES, NUGET_ID.toLowerCase()), { recursive: true });
npmRun("codegen:check");

const pluginProject = join(uplink, "mod", `${NS}.csproj`);
const projectSource = readFileSync(pluginProject, "utf8");
writeFileSync(
  pluginProject,
  projectSource.replace(
    "</Project>",
    `  <ItemGroup>
    <Reference Include="Assembly-CSharp" Private="false">
      <HintPath>$(KspManaged)/Assembly-CSharp.dll</HintPath>
    </Reference>
  </ItemGroup>
</Project>`,
  ),
);
const buildPlugin = ["build", pluginProject, "-c", "Release", ...dotnetQuiet];
mustFail(
  "a reference to the game with no KSP_ROOT",
  /Set the KSP_ROOT environment variable/,
  "dotnet",
  buildPlugin,
);
const kspRoot = process.env.KSP_ROOT;
const kspManaged = kspRoot
  ? [
      join(kspRoot, "KSP_Data/Managed"),
      join(kspRoot, "KSP.app/Contents/Resources/Data/Managed"),
    ].find((dir) => existsSync(join(dir, "Assembly-CSharp.dll")))
  : undefined;
if (kspManaged) {
  must(
    "build a plugin that references the game, with KSP_ROOT set",
    "dotnet",
    buildPlugin,
    {
      env: { ...env, KSP_ROOT: kspRoot },
    },
  );
} else {
  console.log(
    "  NOT RUN: a plugin that references the game building with KSP_ROOT set. KSP_ROOT is " +
      (kspRoot ? "set, and holds no Assembly-CSharp.dll" : "not set"),
  );
}
writeFileSync(pluginProject, projectSource);

// ── The other shape: no Topics of its own, every other answer a default ─────

if (!published) {
  console.log(
    "scaffold-probe: an Uplink with no Topics of its own, scaffolded with --yes",
  );
  const coreId = "probecore";
  const coreNs = "GonogoProbecoreUplink";
  const core = join(work, coreId);
  const coreClient = join(core, "client");
  mkdirSync(core);
  must(
    "uplink-tools new --yes --topics core",
    bin,
    [
      "new",
      coreId,
      "--yes",
      "--topics",
      "core",
      "--author",
      "Scaffold Probe",
      "--repo",
      "you/example",
      "--no-install",
    ],
    { cwd: core },
  );
  for (const absent of [
    "mod-contract",
    "mod-contract-codegen",
    "client/src/commands.ts",
  ]) {
    if (existsSync(join(core, absent))) {
      fail(`--topics core still wrote ${absent}`);
    }
  }
  pointAtPacked(core);
  must("npm install", "npm", ["install", "--no-package-lock"], {
    cwd: coreClient,
  });
  for (const script of ["page", "typecheck", "test"]) {
    must(`npm run ${script}`, "npm", ["run", script], { cwd: coreClient });
  }
  drawsReadably(coreClient, join(coreClient, "src/Vessel/index.tsx"));
  for (const script of ["page", "test", "release"]) {
    must(`npm run ${script}`, "npm", ["run", script], { cwd: coreClient });
  }
  must("dotnet test mod-tests", "dotnet", [
    "test",
    join(core, "mod-tests", `${coreNs}.Tests.csproj`),
    ...dotnetQuiet,
  ]);
  const coreZip = must("list the mod zip", "unzip", [
    "-Z1",
    join(core, "dist", `${coreNs}.zip`),
  ])
    .split("\n")
    .filter(Boolean);
  if (coreZip.join("\n") !== `GameData/${coreNs}/Plugins/${coreNs}.dll`) {
    fail(
      `the core-Topics mod zip holds [${coreZip.join(", ")}], expected the plugin alone`,
    );
  }
}

if (published) {
  console.log(
    `\n✓ scaffold-probe: at ${version} from npm and nuget.org, an Uplink scaffolded in an empty ` +
      "directory generates, typechecks, tests on both halves and releases; six plants were refused. " +
      "NOT RUN: loading the released plugin and client into this tree's mod and app.",
  );
  process.exit(0);
}

// ── Where an install would take it ──────────────────────────────────────────

console.log("scaffold-probe: the host that stands in for the game");
const hostProject = join(ROOT, "scripts/scaffold-probe-host");
must(
  "build the host",
  "dotnet",
  [
    "build",
    join(hostProject, "ScaffoldProbeHost.csproj"),
    "-c",
    "Release",
    ...dotnetQuiet,
  ],
  { env: process.env },
);
const hostDll = join(hostProject, "bin/Release/net10.0/ScaffoldProbeHost.dll");

/** Serves the stream from the built plugin and resolves once it says which port. */
function startHost() {
  const child = spawn("dotnet", [hostDll, plugin], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let log = "";
  return new Promise((resolvePort, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the host never reported a port:\n${log}`)),
      60_000,
    );
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });
    child.stdout.on("data", (chunk) => {
      log += chunk;
      const match = /^PORT (\d+)$/m.exec(log);
      if (match) {
        clearTimeout(timer);
        resolvePort({ child, port: Number(match[1]) });
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the host exited ${code} before serving:\n${log}`));
    });
  });
}

function stopHost(host) {
  host.child.removeAllListeners("exit");
  host.child.stdin.end();
  return new Promise((done) => {
    const timer = setTimeout(() => host.child.kill(), 5_000);
    host.child.on("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
}

/** Has the app boot against the running host and hold what it finds to `expectation`. */
async function appSees(expectation) {
  const host = await startHost().catch((err) => fail(err.message));
  try {
    return run(
      "pnpm",
      [
        "--filter",
        "@ksp-gonogo/app",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.scaffold-probe.config.ts",
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          GONOGO_SCAFFOLD_PROBE_EXPECT: expectation,
          GONOGO_SCAFFOLD_PROBE_PORT: String(host.port),
          GONOGO_SCAFFOLD_PROBE_ID: ID,
          GONOGO_SCAFFOLD_PROBE_BUNDLE: bundle,
          GONOGO_SCAFFOLD_PROBE_SIDECAR: sidecar,
          GONOGO_SCAFFOLD_PROBE_DECLARATION: join(uplink, "uplink.json"),
        },
      },
    );
  } finally {
    await stopHost(host);
  }
}

// The plants above rebuilt the plugin, so the one loaded is released again and is the one an author would install.
npmRun("release");
const loaded = await appSees("loaded");
if (!loaded.ok) {
  console.error(loaded.output);
  fail(
    "the app did not load the scaffolded Uplink's client and draw its widget",
  );
}
console.log(
  "  ✓ the app loads the client the released plugin announced and draws its widget",
);

/**
 * Rebuilds the plugin with a fault in it and requires the main check to fail on
 * it, for the reason given.
 */
async function plant(name, expectation, apply) {
  apply();
  must(`plant, ${name}: rebuild the plugin`, "dotnet", buildPlugin);
  const main = await appSees("loaded");
  if (main.ok) {
    console.error(
      `\n✖ scaffold-probe: BLIND. With ${name}, the app still loaded the client, so this ` +
        "probe could not have seen the fault it exists for.",
    );
    process.exit(1);
  }
  const reason = await appSees(expectation);
  if (!reason.ok) {
    console.error(reason.output);
    fail(`with ${name}, the check failed, but not as "${expectation}"`);
  }
  console.log(`  ✓ plant, ${name}: seen, as ${expectation}`);
}

await plant("a plugin baked without its bundle", "hash-blind", () => {
  must("bake, no bundle", "npx", ["uplink-tools", "bake"], { cwd: client });
});

await plant("a plugin that announces no client", "unannounced", () => {
  must("bake with the bundle", "npm", ["run", "bake"], { cwd: client });
  const pluginSource = join(uplink, "mod/ProbeUplink.cs");
  const source = readFileSync(pluginSource, "utf8");
  const without = source.replace(
    /\n\s*ClientSource = new UplinkClientSource\s*\{[^}]*\},/,
    "",
  );
  if (without === source) {
    fail(
      "the scaffolded plugin has no ClientSource block to take out, so the plant has nothing to plant",
    );
  }
  writeFileSync(pluginSource, without);
});

console.log(
  `\n✓ scaffold-probe: from what this tree would publish as ${version}, an Uplink scaffolded outside ` +
    "the repo generates, typechecks, tests on both halves and releases, its plugin is found by the " +
    "mod's scan, and the app loads the client it announces and draws the widget. Ten plants were seen.",
);
