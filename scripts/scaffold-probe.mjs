#!/usr/bin/env node
/**
 * Does an Uplink started with `uplink-tools new` end up on the dashboard?
 *
 * Every other check of the scaffold reads the text it writes. This one follows
 * it the whole way: scaffold into a directory outside the repo, generate its
 * client types, bundle the client, bake, build the plugin and run its tests,
 * then load the built DLL with the mod's own assembly scan into a real stream
 * engine (`scaffold-probe-host/`), and have the app ask that stream which
 * Uplinks are installed, load the client the plugin announced and draw its
 * widget (`packages/app/src/uplinks/scaffoldProbe.probe.tsx`).
 *
 * It exists because a scaffold that built and tested green was still invisible:
 * its plugin never said where its client lived, and the app loads an outside
 * client only for a plugin that does.
 *
 * ## It must be able to fail
 *
 * Two plants, each rebuilt and run through the same path. A plugin with the
 * announcement taken out, and a plugin baked without its bundle, must each fail
 * the main check, and for the reason expected. If either passes, the probe could
 * not have seen the real fault and it exits as BLIND.
 *
 * ## What it builds against
 *
 * The contract assemblies come from this tree's own build, laid out the way the
 * scaffold's `$(GonogoContract)` and `$(GonogoDevkit)` properties expect. The npm
 * packages are the workspace's. So this proves the scaffold against the commit,
 * not against what a release publishes.
 *
 * Needs `pnpm build` to have run (the `uplink-tools` bin and the sdk's `dist`)
 * and `dotnet`. `GONOGO_KEEP_TMP=1` keeps the scaffolded directory.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./temp-dir.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "packages/uplink-tools/bin/uplink-tools.mjs");
const ID = "probe";
const NS = "GonogoProbeUplink";
const RT_VERSION = "1.6.7";

const fail = (message) => {
  console.error(`\n✖ scaffold-probe: ${message}`);
  process.exit(1);
};

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) fail(`${label}: ${result.error.message}`);
  return { ok: result.status === 0, output };
}

function must(label, command, args, options = {}) {
  const { ok, output } = run(label, command, args, options);
  if (!ok) {
    console.error(output);
    fail(`${label} failed`);
  }
  console.log(`  ✓ ${label}`);
  return output;
}

for (const needed of [
  BIN,
  join(ROOT, "packages/uplink-tools/dist/cli.js"),
  join(ROOT, "mod/sitrep-sdk/dist/compat-versions.js"),
]) {
  if (!existsSync(needed)) {
    fail(`${needed} does not exist. Run \`pnpm build\` first.`);
  }
}

const work = makeTempDir("gonogo-scaffold-probe-");
const uplink = join(work, ID);
mkdirSync(uplink);

/*
 * MSBuild and pnpm both walk up. A Directory.Build.props above the scaffold
 * would supply the reference paths silently, and a workspace file would resolve
 * the client's imports to this repo's sources.
 */
for (let dir = work; ; dir = dirname(dir)) {
  for (const file of [
    "Directory.Build.props",
    "Directory.Build.targets",
    "pnpm-workspace.yaml",
  ]) {
    if (existsSync(join(dir, file))) {
      fail(
        `${join(dir, file)} sits above the scratch directory, so nothing built there is built alone`,
      );
    }
  }
  if (dirname(dir) === dir) break;
}

console.log("scaffold-probe: the reference set, from this tree");
const refs = join(work, "refs");
for (const project of [
  "Sitrep.Contract",
  "Sitrep.Contract.Codegen",
  "Sitrep.Contract.TestSupport",
  "Sitrep.Core",
]) {
  must(`build ${project}`, "dotnet", [
    "build",
    join(ROOT, "mod", project, `${project}.csproj`),
    "-c",
    "Release",
    "--nologo",
    "-v",
    "quiet",
    "-clp:ErrorsOnly",
  ]);
}
const staged = [
  ["Sitrep.Contract/bin/Release/net472/Sitrep.Contract.dll", "contract/net472"],
  [
    "Sitrep.Contract/bin/Release/netstandard2.0/Sitrep.Contract.dll",
    "contract/netstandard2.0",
  ],
  [
    "Sitrep.Contract.Codegen/bin/Release/netstandard2.0/Sitrep.Contract.dll",
    "contract/codegen",
  ],
  [
    "Sitrep.Contract.Codegen/bin/Release/netstandard2.0/Reinforced.Typings.dll",
    "contract/codegen",
  ],
  ["CodegenTwin.props", "contract"],
  [
    "Sitrep.Contract.TestSupport/bin/Release/net10.0/Sitrep.Contract.TestSupport.dll",
    "devkit",
  ],
  ["Sitrep.Core/bin/Release/netstandard2.0/Sitrep.Core.dll", "devkit"],
];
for (const [source, target] of staged) {
  const from = join(ROOT, "mod", source);
  if (!existsSync(from)) fail(`the build did not produce ${from}`);
  mkdirSync(join(refs, target), { recursive: true });
  cpSync(from, join(refs, target, source.split("/").pop()));
}
const msbuildRefs = [
  `-p:GonogoContract=${join(refs, "contract")}`,
  `-p:GonogoDevkit=${join(refs, "devkit")}`,
];

console.log(`scaffold-probe: uplink-tools new ${ID}, in ${uplink}`);
must(
  "new",
  process.execPath,
  [BIN, "new", ID, "--author", "Scaffold Probe", "--no-generate"],
  { cwd: uplink },
);
for (const file of [
  "Provenance.g.cs",
  "ClientSource.g.cs",
  "ExpectedClientHash.g.cs",
]) {
  if (!existsSync(join(uplink, "mod", file))) {
    fail(
      `new left no mod/${file}, so a fresh scaffold's plugin cannot compile`,
    );
  }
}

/*
 * The client's generated types. There is no published codegen command yet, so
 * these lines do what one will: build the contract slice's codegen twin and run
 * rtcli over it.
 */
const declared = JSON.parse(readFileSync(join(uplink, "uplink.json"), "utf8"));
const twinDir = join(uplink, "mod-contract-codegen");
must("build the codegen twin", "dotnet", [
  "build",
  join(twinDir, `${declared.codegen.assembly}.Codegen.csproj`),
  "--nologo",
  "-v",
  "quiet",
  "-clp:ErrorsOnly",
  ...msbuildRefs,
]);
const rtcli = join(
  process.env.NUGET_PACKAGES || join(homedir(), ".nuget/packages"),
  "reinforced.typings",
  RT_VERSION,
  "tools/net5.0/rtcli.dll",
);
if (!existsSync(rtcli)) fail(`rtcli is not in the NuGet cache at ${rtcli}`);
const generated = join(uplink, "client/src/__generated__");
mkdirSync(generated, { recursive: true });
const twin = join(
  twinDir,
  "bin/Debug/netstandard2.0",
  `${declared.codegen.assembly}.dll`,
);
const codegenEnv = { ...process.env, DOTNET_ROLL_FORWARD: "LatestMajor" };
for (const [variable, file] of Object.entries(declared.codegen.emits)) {
  codegenEnv[variable] = join(generated, file);
}
must(
  "generate the client's types",
  "dotnet",
  [
    rtcli,
    `DocumentationFilePath=${twin.replace(/\.dll$/, ".xml")}`,
    `SourceAssemblies=${twin}`,
    `TargetFile=${join(generated, "contract.ts")}`,
    `ConfigurationMethod=${declared.codegen.configurationMethod}`,
  ],
  { env: codegenEnv },
);

// The sidecar records the ui-kit the client was built against, read from an install above it. Nothing is installed here, so a stub carries the version this tree's ui-kit has.
const uiKit = JSON.parse(
  readFileSync(join(ROOT, "packages/ui-kit/package.json"), "utf8"),
);
const stub = join(uplink, "client/node_modules/@ksp-gonogo/ui-kit");
mkdirSync(stub, { recursive: true });
writeFileSync(
  join(stub, "package.json"),
  JSON.stringify({ name: "@ksp-gonogo/ui-kit", version: uiKit.version }),
);

const client = join(uplink, "client");
const bundle = join(client, "dist", ID, `${ID}.client.js`);
const sidecar = join(client, "dist", ID, "gonogo-uplink.json");
const plugin = join(uplink, "mod/bin/Release", `${NS}.dll`);
const pluginSource = join(uplink, "mod/ProbeUplink.cs");

must("bundle", process.execPath, [BIN, "bundle"], { cwd: client });

const buildPlugin = (label) =>
  must(label, "dotnet", [
    "build",
    join(uplink, "mod", `${NS}.csproj`),
    "-c",
    "Release",
    "--nologo",
    "-v",
    "quiet",
    "-clp:ErrorsOnly",
    ...msbuildRefs,
  ]);

console.log("scaffold-probe: the host that stands in for the game");
const hostProject = join(ROOT, "scripts/scaffold-probe-host");
must("build the host", "dotnet", [
  "build",
  join(hostProject, "ScaffoldProbeHost.csproj"),
  "-c",
  "Release",
  "--nologo",
  "-v",
  "quiet",
  "-clp:ErrorsOnly",
]);
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
        resolvePort({ child, port: Number(match[1]), log: () => log });
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
      `the app, expecting ${expectation}`,
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

console.log("scaffold-probe: bundle, bake, build, as a release orders them");
must("bake --bundle", process.execPath, [BIN, "bake", "--bundle", bundle], {
  cwd: client,
});
buildPlugin("build the plugin");
must("the scaffold's own C# tests", "dotnet", [
  "test",
  join(uplink, "mod-tests", `${NS}.Tests.csproj`),
  "--nologo",
  "-v",
  "quiet",
  ...msbuildRefs,
]);

const loaded = await appSees("loaded");
if (!loaded.ok) {
  console.error(loaded.output);
  fail(
    "the app did not load the scaffolded Uplink's client and draw its widget",
  );
}
console.log(
  "  ✓ the app loads the client the plugin announced and draws its widget",
);

/**
 * Rebuilds the plugin with a fault in it and requires the main check to fail on
 * it, for the reason given.
 */
async function plant(name, expectation, apply) {
  await apply();
  buildPlugin(`plant, ${name}: rebuild the plugin`);
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

console.log("scaffold-probe: plants");
await plant("a plugin baked without its bundle", "hash-blind", () => {
  must("bake, no bundle", process.execPath, [BIN, "bake"], { cwd: client });
});

await plant("a plugin that announces no client", "unannounced", () => {
  must("bake --bundle", process.execPath, [BIN, "bake", "--bundle", bundle], {
    cwd: client,
  });
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
  "\n✓ scaffold-probe: a scaffolded Uplink, bundled, baked and built, is announced by its plugin, " +
    "loaded by the app and drawn; both plants were seen.",
);
