/**
 * `uplink-tools codegen`: an Uplink's client types, generated from its own C#
 * contract slice.
 *
 * The slice is compiled a second time as a "codegen twin", with
 * `SITREP_CODEGEN` defined, which is the only configuration in which the
 * Reinforced.Typings attributes and the slice's `RtConfig` exist. rtcli reads
 * the twin and writes TypeScript. Nothing ships a twin.
 *
 * The twin compiles against the codegen twin of `Sitrep.Contract` itself and
 * imports `CodegenTwin.props` for its shape. Both ride in the
 * `KspGonogo.Sitrep.Contract` NuGet package, in a `codegen` folder outside
 * every lib group, and are found through the package the slice restored: the
 * types are then generated against the same contract the slice compiled
 * against, by construction rather than by a second pin.
 *
 * Every refusal below is a way this has failed silently before: a twin built
 * against nothing, rtcli absent after a restore that restored nothing, and a
 * contract emitted with no prose because the documentation file was never
 * written.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findUplinkDir } from "./bake";
import { parseFlags } from "./flags";

export const CODEGEN_USAGE = `uplink-tools codegen [options]

  Generate client/src/__generated__/ (contract.ts and the topic and unit maps)
  from the C# contract slice in mod-contract/. Run it after changing a wire
  type, and commit what it writes. Needs the .NET SDK.

  --check            generate to a scratch directory and fail if the committed
                     files differ, writing nothing. For CI
  --contract <dir>   a directory holding CodegenTwin.props and the codegen
                     Sitrep.Contract.dll, instead of the ones in the
                     KspGonogo.Sitrep.Contract package the slice restored
  --uplink <dir>     the Uplink's directory, the one holding uplink.json
                     (default: found by walking up from the current directory)`;

const PACKAGE_ID = "KspGonogo.Sitrep.Contract";
const STAMP_KEY = "SitrepContractVersion";
const DOTNET_HINT =
  "The .NET SDK is not on PATH, and codegen builds the contract slice with it. " +
  "Install it from https://dotnet.microsoft.com/download and run this again.";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

function readJson(path: string): Record<string, unknown> {
  return asRecord(JSON.parse(readFileSync(path, "utf8")));
}

/** Runs `dotnet` with its output shown, and fails naming the step. */
export function dotnet(
  label: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): void {
  const result = spawnSync("dotnet", args, { stdio: "inherit", env });
  if (result.error) {
    throw new Error(
      Reflect.get(result.error, "code") === "ENOENT"
        ? DOTNET_HINT
        : `${label}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed, so nothing after it ran.`);
  }
}

/** Where a restored project's packages came from: `obj/project.assets.json`, read for one package. */
function restoredPackageDir(
  projectDir: string,
  packageId: string,
): string | undefined {
  const assetsPath = join(projectDir, "obj", "project.assets.json");
  if (!existsSync(assetsPath)) return undefined;
  const assets = readJson(assetsPath);
  const wanted = `${packageId.toLowerCase()}/`;
  const library = Object.entries(asRecord(assets.libraries)).find(([key]) =>
    key.toLowerCase().startsWith(wanted),
  );
  if (!library) return undefined;
  const relative = text(asRecord(library[1]).path);
  if (!relative) return undefined;
  for (const folder of Object.keys(asRecord(assets.packageFolders))) {
    const candidate = join(folder, relative);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The contract stamp in a `Sitrep.Contract.dll`. An attribute argument is a
 * length-prefixed UTF-8 string in the metadata blob heap, so the value is the
 * length byte after the key and that many bytes.
 */
function contractStamp(dll: string): string | undefined {
  const bytes = readFileSync(dll).toString("latin1");
  const at = bytes.indexOf(STAMP_KEY);
  if (at === -1) return undefined;
  const start = at + STAMP_KEY.length + 1;
  return bytes.slice(start, start + bytes.charCodeAt(start - 1));
}

interface CodegenBlock {
  assembly: string;
  configurationMethod: string;
  emits: Record<string, string>;
}

function readCodegenBlock(
  uplinkDir: string,
): { id: string; block: CodegenBlock } | undefined {
  const declared = readJson(join(uplinkDir, "uplink.json"));
  const id = text(declared.id);
  if (declared.codegen === undefined || declared.codegen === null) {
    return undefined;
  }
  const raw = asRecord(declared.codegen);
  const assembly = text(raw.assembly);
  const configurationMethod = text(raw.configurationMethod);
  if (!assembly || !configurationMethod) {
    throw new Error(
      `${join(uplinkDir, "uplink.json")}: the codegen block needs "assembly" (the contract slice's ` +
        'assembly name) and "configurationMethod" (its RtConfig.Configure, fully qualified).',
    );
  }
  const emits = Object.fromEntries(
    Object.entries(asRecord(raw.emits)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return { id, block: { assembly, configurationMethod, emits } };
}

/** The directory holding `CodegenTwin.props` and the twin `Sitrep.Contract.dll`, with what was checked on the way. */
function contractCodegenDir(
  uplinkDir: string,
  block: CodegenBlock,
  named: string | undefined,
): string {
  const required = ["CodegenTwin.props", "Sitrep.Contract.dll"];
  const missingFrom = (dir: string) =>
    required.filter((file) => !existsSync(join(dir, file)));

  if (named !== undefined) {
    const missing = missingFrom(named);
    if (missing.length > 0) {
      throw new Error(
        `--contract ${named} does not hold ${missing.join(" or ")}. It must be a directory with ` +
          "both CodegenTwin.props and the codegen twin of Sitrep.Contract.dll in it.",
      );
    }
    return named;
  }

  const sliceDir = join(uplinkDir, "mod-contract");
  const slice = join(sliceDir, `${block.assembly}.csproj`);
  if (!existsSync(slice)) {
    throw new Error(
      `${slice} does not exist. The codegen block in uplink.json names the assembly ` +
        `${block.assembly}, and its project is where the contract package is found.`,
    );
  }
  dotnet("restore the contract slice", [
    "restore",
    slice,
    "--nologo",
    "-v",
    "quiet",
  ]);
  const packageDir = restoredPackageDir(sliceDir, PACKAGE_ID);
  if (!packageDir) {
    throw new Error(
      `${slice} restored no ${PACKAGE_ID} package, so there is no contract to generate against. ` +
        `Reference it there with a PackageReference, or pass --contract <dir>.`,
    );
  }
  const dir = join(packageDir, "codegen");
  const missing = missingFrom(dir);
  if (missing.length > 0) {
    throw new Error(
      `the ${PACKAGE_ID} package at ${packageDir} carries no codegen/${missing.join(" or codegen/")}. ` +
        "Versions before the one that added the codegen folder cannot generate client types: " +
        "move the PackageReference in mod-contract, mod and mod-tests to a newer version.",
    );
  }

  const twin = contractStamp(join(dir, "Sitrep.Contract.dll"));
  const shipped = contractStamp(
    join(packageDir, "lib", "netstandard2.0", "Sitrep.Contract.dll"),
  );
  if (twin === undefined || twin !== shipped) {
    throw new Error(
      `the codegen twin in ${dir} is stamped contract ${twin ?? "nothing"} and the assembly the ` +
        `slice compiles against is stamped ${shipped ?? "nothing"}. Types generated from one would ` +
        "not describe the other, so the package is broken: report it.",
    );
  }
  return dir;
}

/** rtcli, from the Reinforced.Typings package the twin's own restore brought in. */
function rtcliPath(twinDir: string): string {
  const packageDir = restoredPackageDir(twinDir, "Reinforced.Typings");
  const cli = packageDir
    ? join(packageDir, "tools", "net5.0", "rtcli.dll")
    : undefined;
  if (!cli || !existsSync(cli)) {
    throw new Error(
      "rtcli is not among the packages the codegen twin restored. It arrives with the " +
        "Reinforced.Typings PackageReference in CodegenTwin.props, so a props file that no longer " +
        "declares it restores nothing. Refusing rather than emitting an empty contract.ts.",
    );
  }
  return cli;
}

export interface CodegenInputs {
  uplinkDir: string;
  check?: boolean;
  contractDir?: string;
}

/** `"none"` when the Uplink declares no contract slice of its own. */
export type CodegenResult = "none" | "written" | "current";

export function generate(inputs: CodegenInputs): CodegenResult {
  const uplinkDir = resolve(inputs.uplinkDir);
  const declared = readCodegenBlock(uplinkDir);
  if (!declared) {
    console.log(
      "no codegen block in uplink.json, so there is nothing to generate (an Uplink with no Topics of its own)",
    );
    return "none";
  }
  const { id, block } = declared;

  const twinDir = join(uplinkDir, "mod-contract-codegen");
  const project = join(twinDir, `${block.assembly}.Codegen.csproj`);
  if (!existsSync(project)) {
    throw new Error(
      `${project} does not exist, so there is no codegen twin to read.`,
    );
  }

  const codegenDir = contractCodegenDir(
    uplinkDir,
    block,
    inputs.contractDir === undefined ? undefined : resolve(inputs.contractDir),
  );
  dotnet("build the codegen twin", [
    "build",
    project,
    "--nologo",
    "-v",
    "quiet",
    "-clp:ErrorsOnly",
    `-p:GonogoCodegen=${codegenDir}`,
  ]);

  const assembly = join(
    twinDir,
    "bin",
    "Debug",
    "netstandard2.0",
    `${block.assembly}.dll`,
  );
  const documentation = assembly.replace(/\.dll$/, ".xml");
  for (const built of [assembly, documentation]) {
    if (existsSync(built)) continue;
    throw new Error(
      `${built} does not exist after building the twin. ` +
        (built === documentation
          ? "It comes from GenerateDocumentationFile in CodegenTwin.props, and without it the " +
            "generated contract would carry no doc comments at all. Refusing."
          : "The twin's AssemblyName must be the one the codegen block names."),
    );
  }

  const committed = join(uplinkDir, "client", "src", "__generated__");
  const outDir = inputs.check
    ? mkdtempSync(join(tmpdir(), "uplink-codegen-"))
    : committed;
  try {
    mkdirSync(outDir, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DOTNET_ROLL_FORWARD: "LatestMajor",
    };
    for (const [variable, file] of Object.entries(block.emits)) {
      env[variable] = join(outDir, file);
    }
    dotnet(
      "generate the client's types",
      [
        rtcliPath(twinDir),
        `DocumentationFilePath=${documentation}`,
        `SourceAssemblies=${assembly}`,
        `TargetFile=${join(outDir, "contract.ts")}`,
        `ConfigurationMethod=${block.configurationMethod}`,
      ],
      env,
    );

    const expected = ["contract.ts", ...Object.values(block.emits)];
    const unwritten = expected.filter(
      (file) => !existsSync(join(outDir, file)),
    );
    if (unwritten.length > 0) {
      throw new Error(
        `codegen ran and did not write ${unwritten.join(", ")}. The slice's RtConfig decides what ` +
          "is emitted, from the environment variables the codegen block's emits names.",
      );
    }

    if (!inputs.check) {
      console.log(`${id}: generated ${expected.join(", ")} in ${committed}`);
      return "written";
    }

    const read = (dir: string, file: string) =>
      existsSync(join(dir, file))
        ? readFileSync(join(dir, file), "utf8")
        : undefined;
    const stale = expected.filter(
      (file) => read(outDir, file) !== read(committed, file),
    );
    const stray = existsSync(committed)
      ? readdirSync(committed).filter((file) => !expected.includes(file))
      : [];
    if (stale.length > 0 || stray.length > 0) {
      throw new Error(
        `${committed} is not what the contract slice generates.\n` +
          [
            ...stale.map((file) => `  stale or missing: ${file}`),
            ...stray.map((file) => `  no longer generated: ${file}`),
          ].join("\n") +
          "\nRun `uplink-tools codegen` and commit what it writes.",
      );
    }
    console.log(`${id}: client/src/__generated__ is current`);
    return "current";
  } finally {
    if (inputs.check) rmSync(outDir, { recursive: true, force: true });
  }
}

export function codegen(
  argv: readonly string[],
  cwd: string = process.cwd(),
): number {
  const { values, switches } = parseFlags(argv, {
    verb: "codegen",
    usage: CODEGEN_USAGE,
    values: ["--contract", "--uplink"],
    switches: ["--check"],
  });
  const named = values.get("--uplink");
  const uplinkDir = named ? resolve(cwd, named) : findUplinkDir(cwd);
  if (!uplinkDir) {
    throw new Error(
      `no uplink.json in ${cwd} or any directory above it. Run codegen inside an Uplink, or name ` +
        "one with --uplink <dir>.",
    );
  }
  const contract = values.get("--contract");
  generate({
    uplinkDir,
    check: switches.has("--check"),
    contractDir: contract === undefined ? undefined : resolve(cwd, contract),
  });
  return 0;
}
