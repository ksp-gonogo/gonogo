#!/usr/bin/env node
/**
 * Can this Uplink's PLUGIN ASSEMBLY leave?
 *
 * ## The question the C# reference gate cannot ask
 *
 * `mod/Sitrep.Core.Tests/UplinkIsolationTests.cs` enforces that a
 * `mod/Gonogo*Uplink/*.csproj` reaches nothing but `Sitrep.Contract`, its own
 * contract slice, and third-party assemblies. It is correct and its debt list is
 * empty. It reads what a csproj NAMES, and the closure of what it names, which
 * leaves it blind to everything that arrives without being named:
 *
 *  - `mod/Directory.Build.props` supplies `KspManaged` to every project under
 *    `mod/`. It is not part of any csproj and does not travel with an extracted
 *    directory
 *  - `<ProjectReference>` to `Sitrep.Contract` compiles against the contract
 *    SOURCE. What an author has is `Sitrep.Contract.dll`, one build of one target
 *    framework, installed by GonogoCore into `GameData/Gonogo/Plugins/`. The
 *    source carries `#if SITREP_CODEGEN` members the shipped assembly does not,
 *    and two target frameworks where the shipped one is `net472`
 *  - a PackageReference on the contract project flows to its referencers, so an
 *    Uplink can compile against a package it never declared
 *
 * ## Why it must leave `mod/` rather than configure around it
 *
 * The props file and the sibling source tree are exactly what hides the problem,
 * the same way pnpm's workspace linking hides the client half. So the probe copies
 * the Uplink and its contract slice somewhere else entirely, does not bring
 * `Directory.Build.props`, repoints the one contract reference at the built DLL,
 * and builds. What survives that is what an outside author would get.
 *
 * The Uplink's OWN `.Contract` slice stays a ProjectReference, because it stays a
 * source project for its author too: a third-party Uplink writes its own contract
 * slice and ships it alongside its plugin. Every OTHER ProjectReference is a hard
 * finding, because a project that was not copied in is one the author does not
 * have.
 *
 * ## The self-test, which runs first and is not optional
 *
 * A probe whose build silently no-ops reports zero errors, and zero reads as
 * success. Two things have to be true before any number below is worth reading,
 * and a planted failure alone establishes only the first:
 *
 *  1. a planted violation FAILS. A project using a type the shipped contract does
 *     not have must not compile
 *  2. the same project WITHOUT the plant SUCCEEDS. Without this the run cannot
 *     tell a seen violation from an environment that fails at everything, and a
 *     probe that fails at everything reports its subject as broken while proving
 *     nothing about it
 *
 * The client-side probe has only the first half today, and its planted import of
 * one missing export produces 223 errors, which is the shape that check cannot
 * see: the noise on its own would satisfy it.
 *
 * Usage:
 *   node scripts/uplink-csharp-extraction-probe.mjs                every Uplink
 *   node scripts/uplink-csharp-extraction-probe.mjs --only Scansat substring filter
 *   node scripts/uplink-csharp-extraction-probe.mjs --update       rewrite the debt
 *
 * Requires `KSP_MANAGED` and `KSP_GAMEDATA`, the same two the mod build takes.
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
import {
  CSHARP_EXTRACTION_DEBT,
  MISSING_REFERENCE_OK,
} from "./uplink-csharp-extraction-debt.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEBT_PATH = join(ROOT, "scripts", "uplink-csharp-extraction-debt.mjs");

/** The target framework GonogoCore installs into GameData. */
const SHIPPED_TFM = "net472";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const update = args.includes("--update");

const kspManaged = process.env.KSP_MANAGED ?? "";
const kspGameData = process.env.KSP_GAMEDATA ?? "";

const run = (cmd, cmdArgs, opts = {}) =>
  spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });

const countErrors = (output) =>
  (output.match(/ error [A-Z]+\d+/g) ?? []).length;

const dotnetBuild = (project, extra = []) =>
  run(
    "dotnet",
    [
      "build",
      project,
      "--configuration",
      "Release",
      "--nologo",
      `-p:KspManaged=${kspManaged}`,
      `-p:KspGameData=${kspGameData}`,
      ...extra,
    ],
    { cwd: dirname(project) },
  );

/**
 * A reference set that is absent produces a probe that fails everything, which is
 * indistinguishable from every Uplink being broken. Refuse rather than report.
 */
function requireReferenceSet() {
  const missing = [];
  if (!kspManaged) missing.push("KSP_MANAGED");
  if (!kspGameData) missing.push("KSP_GAMEDATA");
  if (missing.length > 0) {
    console.error(
      `✖ ${missing.join(" and ")} not set. This probe compiles against the KSP reference set the\n` +
        "  same way scripts/uplink-mod-build.sh does, and without it every leg would fail for a\n" +
        "  reason that has nothing to do with the Uplink. Refusing to report anything.",
    );
    process.exit(2);
  }
  if (!existsSync(join(kspManaged, "Assembly-CSharp.dll"))) {
    console.error(
      `✖ ${kspManaged} does not contain Assembly-CSharp.dll, so it is not a KSP managed directory.`,
    );
    process.exit(2);
  }
}

/**
 * Build `Sitrep.Contract` and hand back the shipped assembly, the one an author
 * gets from `GameData/Gonogo/Plugins/`.
 */
function buildShippedContract() {
  const project = join(
    ROOT,
    "mod",
    "Sitrep.Contract",
    "Sitrep.Contract.csproj",
  );
  const built = dotnetBuild(project);
  if (built.status !== 0) {
    console.error(
      `✖ could not build Sitrep.Contract, so there is nothing to probe against:\n${built.stdout}${built.stderr}`,
    );
    process.exit(2);
  }
  const dll = join(
    ROOT,
    "mod",
    "Sitrep.Contract",
    "bin",
    "Release",
    SHIPPED_TFM,
    "Sitrep.Contract.dll",
  );
  if (!existsSync(dll)) {
    console.error(
      `✖ Sitrep.Contract built but produced no ${SHIPPED_TFM} assembly at ${dll}.\n` +
        "  That target framework is what GonogoCore installs, so the probe has no author-facing\n" +
        "  reference to use. Check the TargetFrameworks in Sitrep.Contract.csproj.",
    );
    process.exit(2);
  }
  return dll;
}

/**
 * Swap the contract ProjectReference for a binary Reference to the shipped DLL.
 * Returns the rewritten source, or null when nothing matched: a rewrite that
 * quietly changes nothing leaves the probe measuring the in-repo build it exists
 * to escape, and reports that as a pass.
 */
function repointContractReference(source, contractDll) {
  const binaryReference = [
    '    <Reference Include="Sitrep.Contract" Private="false">',
    `      <HintPath>${contractDll}</HintPath>`,
    "    </Reference>",
  ].join("\n");
  // Both spellings in the tree: an element with a nested <Private>, and a
  // self-closing tag carrying Private as an attribute.
  const elementForm =
    /[ \t]*<ProjectReference Include="[^"]*Sitrep\.Contract\.csproj">[\s\S]*?<\/ProjectReference>/;
  const selfClosingForm =
    /[ \t]*<ProjectReference Include="[^"]*Sitrep\.Contract\.csproj"[^>]*\/>/;
  for (const form of [elementForm, selfClosingForm]) {
    if (form.test(source)) return source.replace(form, binaryReference);
  }
  return null;
}

/** Every ProjectReference left after the contract swap, as written. */
function remainingProjectReferences(source) {
  return [...source.matchAll(/<ProjectReference Include="([^"]+)"/g)].map(
    (match) => match[1].split("\\").join("/"),
  );
}

/**
 * Materialise one Uplink outside `mod/`, build it, count the errors.
 * Returns `{ errors, blocked }`; `blocked` is a hard finding, not a count.
 */
function probe(uplink, contractDll, workRoot) {
  const work = join(workRoot, uplink.id);
  const sourceDir = join(ROOT, "mod", uplink.id);
  const filter = (src) => !/[\\/](bin|obj|node_modules)$/.test(src);

  mkdirSync(work, { recursive: true });
  cpSync(sourceDir, join(work, uplink.id), { recursive: true, filter });
  // The Uplink's own contract slice travels with it: a third-party author writes
  // and ships one too. Nothing else does, deliberately.
  const slice = `${uplink.id}.Contract`;
  if (existsSync(join(ROOT, "mod", slice))) {
    cpSync(join(ROOT, "mod", slice), join(work, slice), {
      recursive: true,
      filter,
    });
  }
  // mod/Directory.Build.props is NOT copied. MSBuild walks up from the project
  // directory looking for one, so an extracted Uplink inherits whatever sits
  // above wherever its author put it, which is nothing.

  // Both csprojs, because the slice references the contract too and an author's
  // copy of it has the same one line to repoint.
  const csprojPath = join(work, uplink.id, `${uplink.id}.csproj`);
  const slicePath = join(work, slice, `${slice}.csproj`);
  const dangling = [];
  for (const path of [csprojPath, slicePath].filter(existsSync)) {
    const rewritten = repointContractReference(
      readFileSync(path, "utf8"),
      contractDll,
    );
    if (rewritten === null) {
      return {
        errors: 0,
        blocked:
          `no ProjectReference to Sitrep.Contract matched in ${path.slice(work.length + 1)}, so the ` +
          "probe would have measured an unmodified in-repo build and called it extractable. Check " +
          "the reference spelling against repointContractReference().",
      };
    }
    writeFileSync(path, rewritten);
    dangling.push(
      ...remainingProjectReferences(rewritten).filter(
        (ref) => !ref.endsWith(`${slice}/${slice}.csproj`),
      ),
    );
  }
  if (dangling.length > 0) {
    return {
      errors: 0,
      blocked:
        `references project(s) that did not travel with it: ${[...new Set(dangling)].join(", ")}. ` +
        "Only this Uplink's own contract slice is copied, because it is the only other source " +
        "project its author has.",
    };
  }

  const built = dotnetBuild(csprojPath);
  const output = `${built.stdout}${built.stderr}`;

  // MSB3245 is a WARNING: a reference whose HintPath does not exist drops off
  // the compile surface and the build carries on. For the two references
  // extraction rewires, that would mean compiling with no contract at all and
  // exiting 0 on an Uplink whose source happens not to name a contract type.
  const rewired = new Set(["Sitrep.Contract", slice]);
  const lost = [
    ...new Set(
      [...output.matchAll(/MSB3245.*?Could not locate the assembly "([^"]*)"/g)]
        .map((match) => match[1])
        .filter((assembly) => rewired.has(assembly)),
    ),
  ];
  if (lost.length > 0) {
    return {
      errors: 0,
      blocked:
        `the extracted build could not locate ${lost.join(", ")}, which is what this probe rewires. ` +
        "MSB3245 is a warning, so the compile would have proceeded without it and any zero below " +
        "would mean the contract was never on the reference list.",
      output,
    };
  }

  return { errors: built.status === 0 ? 0 : countErrors(output), output };
}

/**
 * Prove the instrument before believing it. A project using a type the shipped
 * contract does not have MUST fail, and the same project without that line MUST
 * succeed. One without the other cannot tell a seen violation from an
 * environment that fails at everything.
 */
function selfTest(contractDll, workRoot) {
  const work = join(workRoot, "__blind-check__");
  mkdirSync(work, { recursive: true });
  writeFileSync(
    join(work, "BlindCheck.csproj"),
    [
      '<Project Sdk="Microsoft.NET.Sdk">',
      "  <PropertyGroup>",
      `    <TargetFramework>${SHIPPED_TFM}</TargetFramework>`,
      "    <AssemblyName>BlindCheck</AssemblyName>",
      "    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>",
      "  </PropertyGroup>",
      "  <ItemGroup>",
      '    <Compile Include="Subject.cs" />',
      '    <Reference Include="Sitrep.Contract" Private="false">',
      `      <HintPath>${contractDll}</HintPath>`,
      "    </Reference>",
      "  </ItemGroup>",
      "</Project>",
      "",
    ].join("\n"),
  );

  const control = [
    "using Sitrep.Contract;",
    "public static class Subject {",
    "  public static string Name => nameof(ISitrepUplink);",
    "}",
    "",
  ].join("\n");
  const planted = control.replace(
    "public static string Name => nameof(ISitrepUplink);",
    "public static string Name => nameof(ThisContractTypeCannotExist);",
  );

  writeFileSync(join(work, "Subject.cs"), control);
  const clean = dotnetBuild(join(work, "BlindCheck.csproj"));
  if (clean.status !== 0) {
    console.error(
      "✖ BLIND: the control project, which uses only a type the shipped contract does have,\n" +
        "  FAILED to build. The probe would call every Uplink broken and would be measuring its\n" +
        `  own environment. Refusing to report anything.\n${clean.stdout}${clean.stderr}`,
    );
    process.exit(1);
  }

  writeFileSync(join(work, "Subject.cs"), planted);
  const violated = dotnetBuild(join(work, "BlindCheck.csproj"));
  if (violated.status === 0) {
    console.error(
      "✖ BLIND: a deliberate use of a type the shipped contract does NOT have compiled cleanly.\n" +
        "  The probe cannot see the failure it exists to measure, so every zero it reports below\n" +
        "  would be meaningless. Refusing to report success.",
    );
    process.exit(1);
  }
  console.log(
    `self-test: control built clean, planted violation produced ${countErrors(
      `${violated.stdout}${violated.stderr}`,
    )} error(s). The probe can tell one from the other.`,
  );
}

/**
 * An entry naming an Uplink that is not there describes nothing and would excuse
 * nothing, so it is a mistake rather than debt.
 *
 * Whether the named DLL is missing is decided per run, at the point of use, not
 * here: the answer depends on which reference set the caller pointed at, and a
 * developer's live GameData holds mods the CI set does not. So an entry does not
 * suppress a leg whose DLL is present, and the day CI vendors one the leg starts
 * being probed on its own.
 */
function requireExemptionsNameSomething() {
  const wrong = Object.keys(MISSING_REFERENCE_OK).filter(
    (id) => !existsSync(join(ROOT, "mod", id)),
  );
  if (wrong.length > 0) {
    console.error(
      `✖ MISSING_REFERENCE_OK names Uplink(s) with no mod/ directory: ${wrong.join(", ")}.\n` +
        "  Fix the name or delete the entry: as written it excuses nothing and reads as coverage.",
    );
    process.exit(1);
  }
}

const workRoot = mkdtempSync(join(tmpdir(), "gonogo-csharp-extraction-"));
let exitCode = 0;
try {
  requireReferenceSet();
  requireExemptionsNameSomething();
  const contractDll = buildShippedContract();
  selfTest(contractDll, workRoot);

  const uplinks = JSON.parse(
    execFileSync("node", [join(ROOT, "scripts/uplink-matrix.mjs")], {
      encoding: "utf8",
    }),
  )
    .filter((uplink) => uplink.csproj)
    .filter(
      (uplink) => !only || uplink.id.toLowerCase().includes(only.toLowerCase()),
    );

  // A filter that selects nothing runs the loop zero times and reports success.
  if (uplinks.length === 0) {
    console.error(
      only
        ? `✖ --only ${only} matched no Uplink with a csproj, so nothing was probed.`
        : "✖ BLIND: the matrix reported no Uplink with a csproj, so nothing was probed.",
    );
    process.exit(1);
  }

  const measured = {};
  for (const uplink of uplinks) {
    const excused = MISSING_REFERENCE_OK[uplink.id];
    if (excused) {
      const dll = excused.split("|")[0];
      const why = excused.split("|").slice(1).join("|");
      if (!existsSync(join(kspGameData, dll))) {
        console.log(
          `  ${uplink.id}: NOT PROBED, ${dll} is absent from the reference set. ${why}`,
        );
        continue;
      }
      console.log(
        `  ${uplink.id}: ${dll} is present in this reference set, so the entry excusing it is inert here and the leg is probed.`,
      );
    }

    const result = probe(uplink, contractDll, workRoot);
    const allowed = CSHARP_EXTRACTION_DEBT[uplink.id] ?? 0;

    if (result.blocked) {
      console.log(`✖ ${uplink.id}: CANNOT BE EXTRACTED. ${result.blocked}`);
      exitCode = 1;
      continue;
    }
    measured[uplink.id] = result.errors;
    if (result.errors > allowed) {
      console.log(
        `✖ ${uplink.id}: ${result.errors} error(s) built outside mod/ against the shipped contract, debt allows ${allowed}`,
      );
      for (const line of (result.output ?? "")
        .split("\n")
        .filter((line) => / error [A-Z]+\d+/.test(line))
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
    const merged = { ...CSHARP_EXTRACTION_DEBT, ...measured };
    for (const [id, count] of Object.entries(merged))
      if (count === 0) delete merged[id];
    const source = readFileSync(DEBT_PATH, "utf8");
    const header = source.split("export const CSHARP_EXTRACTION_DEBT")[0];
    const tail = source.slice(
      source.indexOf(
        "/**",
        source.indexOf("export const CSHARP_EXTRACTION_DEBT"),
      ),
    );
    writeFileSync(
      DEBT_PATH,
      `${header}export const CSHARP_EXTRACTION_DEBT = ${JSON.stringify(merged, null, 2)};\n\n${tail}`,
    );
    console.log(`\nRewrote ${DEBT_PATH} from this run.`);
    exitCode = 0;
  }
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
process.exit(exitCode);
