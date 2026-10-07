#!/usr/bin/env node
/**
 * Gate the packed `KspGonogo.Sitrep.Contract` NuGet package.
 *
 * The package is the C# half of the Uplink surface, and everything that can go
 * wrong with it goes wrong in someone else's `dotnet restore`, days after a
 * green build here. Three failure modes, all of which pack happily:
 *
 *   1. A PRIVATE DEPENDENCY ESCAPES. Reinforced.Typings is the standing
 *      example: a metadata reference to it is deliberately never deployed, and
 *      an assembly carrying one breaks every consumer the moment it asks a
 *      contract type for its attributes (`Sitrep.Contract.csproj`'s own header
 *      tells the story, and `Sitrep.Core.Tests/ContractEnumRenderingTests`
 *      guards the assembly). Nothing guarded the PACKAGE.
 *   2. THE TEST FRAMEWORK REACHES A KSP PLUGIN. TestSupport ships inside this
 *      one package, in the net10.0 group only (#272), and carries Sitrep.Core
 *      with it so a Tests project can drive the real delay engine. A net48
 *      Uplink plugin resolves the net472 assets and must see neither of them
 *      and restore no xunit; get the grouping wrong and a test framework lands
 *      in GameData, or a plugin ships a second Sitrep.Core that shadows the
 *      one GonogoCore already loaded into the shared AppDomain.
 *   3. MAINTAINER PROSE IS PUBLISHED. A contract doc comment's `<internal>`
 *      subtree is for whoever maintains the type, not for an Uplink author's
 *      IntelliSense (CLAUDE.md, "Contract doc comments"). `RtDocText` drops it
 *      on the way to TSDoc; `strip-internal-doc-prose.xslt` drops it on the way
 *      into this package, and a stylesheet that silently stopped matching would
 *      leave no trace but 29 extra paragraphs in a shipped .xml.
 *
 *   4. THE CODEGEN TWIN LEAKS, OR GOES MISSING. The package carries one more
 *      assembly, `codegen/Sitrep.Contract.dll`: the SITREP_CODEGEN twin an
 *      Uplink's own codegen compiles against, with `codegen/CodegenTwin.props`
 *      beside it. It is the one assembly here that MUST reference
 *      Reinforced.Typings, and it is safe only because NuGet binds nothing
 *      outside lib/. In a lib folder it is failure mode 1 again; absent, or
 *      swapped for the shipped assembly, an outside Uplink cannot generate its
 *      client types; and a props file that lost its Reinforced.Typings
 *      reference or its documentation switch builds a twin that generates
 *      nothing, or generates it without a word of prose.
 *
 * And the two numbers a consumer reads: the package version is the Gonogo
 * release (the app's own, which every published package carries), and the wire
 * contract's Major.Minor is stamped inside Sitrep.Contract.dll as
 * `SitrepContractVersion` metadata. The gate checks the stamp in the packed
 * assembly against ContractVersion.cs, and that the packed README states no
 * version number at all, since any number written there goes stale.
 *
 * It reads the .nupkg rather than the project, because the .nupkg is what a
 * consumer gets, and a csproj that looks right can still pack wrong: the lib
 * placement here is done by hand in two MSBuild targets.
 *
 * SELF-CHECK. The audit is a pure function over a description of the package,
 * so the script can mutate that description and require each mutation to be
 * caught. It does that on every run, before reporting on the real package: a
 * check that cannot see its own failure reports zero and zero reads as success.
 *
 * Usage:
 *   node scripts/nuget-contract-package-gate.mjs            # packs, then gates
 *   node scripts/nuget-contract-package-gate.mjs <file.nupkg>
 *   node scripts/nuget-contract-package-gate.mjs <file.nupkg> --rc <version>
 *
 * `--rc` gates a release candidate packed with `-p:PackageVersion=<version>`:
 * the package must carry exactly that version, and it must be an `-rc.<n>`
 * prerelease.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./temp-dir.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACK_PROJECT = join(
  REPO_ROOT,
  "mod",
  "Sitrep.Contract.Package",
  "Sitrep.Contract.Package.csproj",
);
const CONTRACT_VERSION_CS = join(
  REPO_ROOT,
  "mod",
  "Sitrep.Contract",
  "ContractVersion.cs",
);
const RELEASE_MANIFEST = join(REPO_ROOT, "packages", "app", "package.json");
const STAMP_KEY = "SitrepContractVersion";

const PACKAGE_ID = "KspGonogo.Sitrep.Contract";

/** The codegen twin and the props an Uplink's own twin imports, outside every lib group. */
const CODEGEN_TWIN = "codegen/Sitrep.Contract.dll";
const CODEGEN_PROPS = "codegen/CodegenTwin.props";

/**
 * What each target-framework group is allowed to contain, as ruled on #272.
 *
 * `net472` and `netstandard2.0` are what a KSP plugin resolves; `net10.0` is
 * what a test project resolves. The asymmetry IS the design, so it is spelled
 * out rather than derived.
 */
const EXPECTED_GROUPS = {
  net472: { assemblies: ["Sitrep.Contract"], dependencies: [] },
  "netstandard2.0": { assemblies: ["Sitrep.Contract"], dependencies: [] },
  "net10.0": {
    assemblies: [
      "Sitrep.Contract",
      "Sitrep.Contract.TestSupport",
      "Sitrep.Core",
    ],
    dependencies: ["xunit.assert"],
  },
};

/** The framework monikers NuGet writes into a nuspec dependency group. */
const NUSPEC_TFM_ALIASES = {
  ".NETFramework4.7.2": "net472",
  ".NETStandard2.0": "netstandard2.0",
  "net10.0": "net10.0",
};

// ── Reading the package ──────────────────────────────────────────────────────

const unzipText = (nupkg, member) =>
  execFileSync("unzip", ["-p", nupkg, member], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

const unzipBinary = (nupkg, member) =>
  execFileSync("unzip", ["-p", nupkg, member], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });

function listMembers(nupkg) {
  const listing = execFileSync("unzip", ["-Z1", nupkg], { encoding: "utf8" });
  return listing.split("\n").filter(Boolean);
}

/**
 * Turn a .nupkg into a plain object the audit can reason about (and a test can
 * mutate). Nothing below this line touches the filesystem.
 */
function describePackage(nupkg) {
  const members = listMembers(nupkg);
  const nuspecName = members.find((m) => m.endsWith(".nuspec"));
  if (!nuspecName) {
    throw new Error(`${nupkg} carries no .nuspec: it is not a NuGet package`);
  }
  const nuspec = unzipText(nupkg, nuspecName);

  const pick = (tag) =>
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(nuspec)?.[1]?.trim();

  /** lib/<tfm>/<file> → { tfm: [file, ...] } */
  const libFiles = {};
  for (const member of members) {
    const match = /^lib\/([^/]+)\/(.+)$/.exec(member);
    if (!match) continue;
    libFiles[match[1]] ??= [];
    libFiles[match[1]].push(match[2]);
  }

  /** <group targetFramework="..."> → [{ id, version }] */
  const dependencyGroups = {};
  const groupsBlock = /<dependencies>([\s\S]*?)<\/dependencies>/.exec(nuspec);
  for (const group of (groupsBlock?.[1] ?? "").matchAll(
    /<group targetFramework="([^"]+)"\s*(\/>|>([\s\S]*?)<\/group>)/g,
  )) {
    const tfm = NUSPEC_TFM_ALIASES[group[1]] ?? group[1];
    dependencyGroups[tfm] = [
      ...(group[3] ?? "").matchAll(
        /<dependency id="([^"]+)" version="([^"]+)"/g,
      ),
    ].map((d) => ({ id: d[1], version: d[2] }));
  }

  /**
   * Every packed XML doc, by member path, so the prose can be inspected.
   *
   * Scoped to lib/ rather than every .xml in the archive, because the archive
   * also holds `[Content_Types].xml`, whose brackets `unzip -p` reads as a glob
   * and then matches nothing.
   */
  const xmlDocs = {};
  for (const member of members.filter(
    (m) => m.startsWith("lib/") && m.endsWith(".xml"),
  )) {
    xmlDocs[member] = unzipText(nupkg, member);
  }

  /**
   * Assembly references are plain UTF-8 strings in a .NET metadata table, so a
   * substring scan of the bytes sees a reference the nuspec cannot show.
   */
  const assemblyNamesInBytes = {};
  for (const member of members.filter((m) => m.endsWith(".dll"))) {
    const bytes = unzipBinary(nupkg, member).toString("latin1");
    assemblyNamesInBytes[member] = [
      ...new Set(
        [...bytes.matchAll(/[A-Za-z][A-Za-z0-9.]{3,60}/g)].map((m) => m[0]),
      ),
    ];
  }

  /**
   * The contract stamp in each packed Sitrep.Contract.dll. An attribute
   * argument is a length-prefixed UTF-8 string in the metadata blob heap, so
   * the value is the length byte after the key and that many bytes.
   */
  const contractStamps = {};
  for (const member of members.filter((m) =>
    m.endsWith("/Sitrep.Contract.dll"),
  )) {
    const bytes = unzipBinary(nupkg, member).toString("latin1");
    const at = bytes.indexOf(STAMP_KEY);
    const start = at + STAMP_KEY.length + 1;
    contractStamps[member] =
      at === -1
        ? null
        : bytes.slice(start, start + bytes.charCodeAt(start - 1));
  }

  const readme = pick("readme");
  return {
    codegenProps: members.includes(CODEGEN_PROPS)
      ? unzipText(nupkg, CODEGEN_PROPS)
      : null,
    id: pick("id"),
    version: pick("version"),
    readme,
    readmeText:
      readme && members.includes(readme) ? unzipText(nupkg, readme) : "",
    contractStamps,
    license: pick("license"),
    projectUrl: pick("projectUrl"),
    hasRepository: /<repository\b/.test(nuspec),
    members,
    libFiles,
    dependencyGroups,
    xmlDocs,
    assemblyNamesInBytes,
  };
}

// ── The audit ────────────────────────────────────────────────────────────────

/**
 * Pure: a package description in, a list of human failures out. Being pure is
 * what lets the self-check below plant a violation without packing anything.
 */
export function auditPackage(pkg, expected) {
  const failures = [];

  if (pkg.id !== PACKAGE_ID) {
    failures.push(
      `package id is ${pkg.id}, expected ${PACKAGE_ID}. The nuget.org trusted-publishing ` +
        `policy globs the whole ksp-gonogo org, so a typo publishes a second package ` +
        `rather than failing.`,
    );
  }

  if (pkg.version !== expected.version) {
    failures.push(
      `package version is ${pkg.version}, but this run ships ${expected.version}. ` +
        `Every published package carries the release version, packages/app/package.json's ` +
        `own, and an RC carries exactly the version it was packed with.`,
    );
  }

  const stamped = Object.entries(pkg.contractStamps);
  const expectedStamped = [
    ...Object.keys(EXPECTED_GROUPS).map(
      (tfm) => `lib/${tfm}/Sitrep.Contract.dll`,
    ),
    CODEGEN_TWIN,
  ].sort();
  if (
    stamped
      .map(([member]) => member)
      .sort()
      .join(",") !== expectedStamped.join(",")
  ) {
    failures.push(
      `the packed Sitrep.Contract.dll are [${stamped.map(([member]) => member).join(", ")}], ` +
        `expected one per framework group and the codegen twin: [${expectedStamped.join(", ")}]`,
    );
  }
  for (const [member, stamp] of stamped) {
    if (stamp !== expected.contract) {
      failures.push(
        `${member} is stamped ${STAMP_KEY} = ${stamp ?? "nothing"}, but ContractVersion.cs ` +
          `says ${expected.contract}. The stamp is how a consumer reads the wire contract ` +
          `from the package; see ContractVersion.props and Sitrep.Contract.csproj.`,
      );
    }
  }

  if (!pkg.readme) failures.push("no <readme> in the nuspec");
  const numbers = pkg.readmeText
    .replace(/\bnet(?:standard)?\d+(?:\.\d+)*\b/g, "")
    .match(/\b\d+\.\d+(?:\.\d+)?\b/g);
  if (numbers) {
    failures.push(
      `the packed README states ${numbers.join(", ")}. It is the package's public face and ` +
        `states no version: any number written there is stale by the next release.`,
    );
  }
  if (!pkg.license) failures.push("no <license> in the nuspec");
  if (!pkg.projectUrl) failures.push("no <projectUrl> in the nuspec");
  if (!pkg.hasRepository) {
    failures.push(
      "no <repository> in the nuspec: SourceLink did not run, so a stepped-into " +
        "contract type resolves to nothing",
    );
  }

  const packedTfms = Object.keys(pkg.libFiles).sort();
  const expectedTfms = Object.keys(EXPECTED_GROUPS).sort();
  if (packedTfms.join(",") !== expectedTfms.join(",")) {
    failures.push(
      `lib/ holds [${packedTfms.join(", ")}], expected [${expectedTfms.join(", ")}]`,
    );
  }

  for (const [tfm, expected] of Object.entries(EXPECTED_GROUPS)) {
    const files = pkg.libFiles[tfm] ?? [];
    const assemblies = files
      .filter((f) => f.endsWith(".dll"))
      .map((f) => f.replace(/\.dll$/, ""))
      .sort();
    if (assemblies.join(",") !== [...expected.assemblies].sort().join(",")) {
      failures.push(
        `lib/${tfm} holds [${assemblies.join(", ") || "nothing"}], expected ` +
          `[${expected.assemblies.join(", ")}]. A net48 Uplink plugin resolves the ` +
          `net472 assets and must never see a test-support assembly or a second ` +
          `copy of Sitrep.Core.`,
      );
    }

    const deps = (pkg.dependencyGroups[tfm] ?? []).map((d) => d.id).sort();
    if (deps.join(",") !== [...expected.dependencies].sort().join(",")) {
      failures.push(
        `the ${tfm} dependency group is [${deps.join(", ") || "empty"}], expected ` +
          `[${expected.dependencies.join(", ") || "empty"}]. A dependency here is a ` +
          `package every consumer of that framework is made to restore.`,
      );
    }
  }

  for (const [tfm, deps] of Object.entries(pkg.dependencyGroups)) {
    for (const dep of deps) {
      if (/reinforced/i.test(dep.id)) {
        failures.push(
          `the ${tfm} dependency group depends on ${dep.id}. Reinforced.Typings is a ` +
            `codegen-only reference that is deliberately never deployed; a consumer ` +
            `resolving it gets a FileNotFoundException off Enum.ToString().`,
        );
      }
    }
  }

  if (pkg.codegenProps === null) {
    failures.push(
      `${CODEGEN_PROPS} is not in the package. An Uplink's codegen twin imports it, ` +
        `so without it no Uplink outside this repo can generate its client types.`,
    );
  } else {
    if (
      !/<PackageReference\s+Include="Reinforced\.Typings"/.test(
        pkg.codegenProps,
      )
    ) {
      failures.push(
        `${CODEGEN_PROPS} declares no Reinforced.Typings PackageReference. That reference is ` +
          `what restores rtcli, so a twin importing this file builds and generates nothing.`,
      );
    }
    if (
      !/<GenerateDocumentationFile>true<\/GenerateDocumentationFile>/.test(
        pkg.codegenProps,
      )
    ) {
      failures.push(
        `${CODEGEN_PROPS} does not set GenerateDocumentationFile. rtcli reads prose from the ` +
          `twin's XML doc file only, so the generated contract would carry no doc comments.`,
      );
    }
  }
  const twinNames = pkg.assemblyNamesInBytes[CODEGEN_TWIN];
  if (twinNames && !twinNames.some((n) => /^Reinforced\./.test(n))) {
    failures.push(
      `${CODEGEN_TWIN} carries no reference to Reinforced.Typings, so it is not the codegen ` +
        `twin: it is the shipped assembly in the twin's place, with no RtConfig for an ` +
        `Uplink's own codegen to call.`,
    );
  }

  for (const [member, names] of Object.entries(pkg.assemblyNamesInBytes)) {
    // The twin is the one assembly that must carry the reference, and is held to that above.
    if (member === CODEGEN_TWIN) continue;
    const reinforced = names.filter((n) => /^Reinforced\./.test(n));
    if (reinforced.length > 0) {
      failures.push(
        `${member} carries a metadata reference to ${reinforced.join(", ")}. ` +
          `PrivateAssets does not prevent this: the reference has to be absent from ` +
          `the COMPILE, which is what the #if SITREP_CODEGEN split is for.`,
      );
    }
  }

  for (const [member, xml] of Object.entries(pkg.xmlDocs)) {
    if (/<internal>/.test(xml)) {
      failures.push(
        `${member} still carries <internal> maintainer prose. ` +
          `mod/Sitrep.Contract.Package/strip-internal-doc-prose.xslt is meant to drop ` +
          `it; if it stopped matching, the prose reaches an Uplink author's IntelliSense.`,
      );
    }
  }

  return failures;
}

// ── Self-check: plant a violation of every family ────────────────────────────

const clone = (pkg) => structuredClone(pkg);

/**
 * One mutation per failure family. Each must be CAUGHT; a family that stops
 * matching would otherwise turn this whole gate into a green no-op.
 */
const PLANTS = [
  {
    what: "a Reinforced.Typings dependency in the netstandard2.0 group",
    mutate: (p) => {
      p.dependencyGroups["netstandard2.0"] = [
        { id: "Reinforced.Typings", version: "1.6.5" },
      ];
    },
  },
  {
    what: "xunit leaking into the net472 group a KSP plugin resolves",
    mutate: (p) => {
      p.dependencyGroups.net472 = [{ id: "xunit.assert", version: "2.9.2" }];
    },
  },
  {
    what: "TestSupport.dll placed in lib/net472",
    mutate: (p) => {
      p.libFiles.net472 = [
        ...p.libFiles.net472,
        "Sitrep.Contract.TestSupport.dll",
      ];
    },
  },
  {
    what: "the contract assembly missing from lib/net10.0",
    mutate: (p) => {
      p.libFiles["net10.0"] = p.libFiles["net10.0"].filter(
        (f) => f !== "Sitrep.Contract.dll",
      );
    },
  },
  {
    what: "a Reinforced.Typings assembly reference inside a packed .dll",
    mutate: (p) => {
      p.assemblyNamesInBytes["lib/net472/Sitrep.Contract.dll"] = [
        "Reinforced.Typings",
      ];
    },
  },
  {
    what: "the codegen twin copied into a lib folder a plugin resolves",
    mutate: (p) => {
      p.assemblyNamesInBytes["lib/netstandard2.0/Sitrep.Contract.dll"] =
        p.assemblyNamesInBytes[CODEGEN_TWIN];
    },
  },
  {
    what: "the shipped assembly in the codegen twin's place",
    mutate: (p) => {
      p.assemblyNamesInBytes[CODEGEN_TWIN] =
        p.assemblyNamesInBytes["lib/netstandard2.0/Sitrep.Contract.dll"];
    },
  },
  {
    what: "a codegen twin carrying no contract stamp",
    mutate: (p) => {
      p.contractStamps[CODEGEN_TWIN] = null;
    },
  },
  {
    what: "the codegen twin missing from the package",
    mutate: (p) => {
      delete p.contractStamps[CODEGEN_TWIN];
      delete p.assemblyNamesInBytes[CODEGEN_TWIN];
    },
  },
  {
    what: "CodegenTwin.props missing from the package",
    mutate: (p) => {
      p.codegenProps = null;
    },
  },
  {
    what: "a CodegenTwin.props that restores no Reinforced.Typings",
    mutate: (p) => {
      p.codegenProps = p.codegenProps.replace(
        /Reinforced\.Typings/g,
        "Nothing",
      );
    },
  },
  {
    what: "a CodegenTwin.props that writes no documentation file",
    mutate: (p) => {
      p.codegenProps = p.codegenProps.replace(
        /<GenerateDocumentationFile>true/,
        "<GenerateDocumentationFile>false",
      );
    },
  },
  {
    what: "<internal> maintainer prose surviving into a packed XML doc",
    mutate: (p) => {
      p.xmlDocs["lib/net472/Sitrep.Contract.xml"] =
        "<doc><summary>a<internal>why</internal></summary></doc>";
    },
  },
  {
    what: "a package version that is not the one this run ships",
    mutate: (p) => {
      p.version = "999.0.0";
    },
  },
  {
    what: "a contract stamp that disagrees with ContractVersion.cs",
    mutate: (p) => {
      p.contractStamps["lib/net472/Sitrep.Contract.dll"] = "1.0";
    },
  },
  {
    what: "a Sitrep.Contract.dll carrying no contract stamp",
    mutate: (p) => {
      p.contractStamps["lib/netstandard2.0/Sitrep.Contract.dll"] = null;
    },
  },
  {
    what: "a version range written into the README",
    mutate: (p) => {
      p.readmeText += "\nReference [29.0.0, 30.0.0).\n";
    },
  },
  {
    what: "a missing package README",
    mutate: (p) => {
      p.readme = undefined;
    },
  },
];

function selfCheck(pkg, expected) {
  const blind = [];
  for (const plant of PLANTS) {
    const mutated = clone(pkg);
    plant.mutate(mutated);
    if (auditPackage(mutated, expected).length === 0) {
      blind.push(plant.what);
    }
  }
  return blind;
}

// ── Driver ───────────────────────────────────────────────────────────────────

/** The contract's Major.Minor, read the way ContractVersion.props reads it. */
function contractVersion() {
  const contractSrc = readFileSync(CONTRACT_VERSION_CS, "utf8");
  const readContract = (name) => {
    const m = new RegExp(
      `public\\s+const\\s+int\\s+${name}\\s*=\\s*(\\d+)\\s*;`,
    ).exec(contractSrc);
    if (!m) {
      throw new Error(
        `no "public const int ${name}" in ${CONTRACT_VERSION_CS}: the declaration ` +
          `moved, and both this gate and ContractVersion.props read it by shape`,
      );
    }
    return m[1];
  };
  return `${readContract("Major")}.${readContract("Minor")}`;
}

/** The release version, which the csproj reads out of the same manifest. */
function releaseVersion() {
  return JSON.parse(readFileSync(RELEASE_MANIFEST, "utf8")).version;
}

function pack() {
  const out = makeTempDir("sitrep-contract-pack-");
  execFileSync(
    "dotnet",
    ["pack", PACK_PROJECT, "-c", "Release", "-o", out, "--nologo"],
    { stdio: "inherit", cwd: REPO_ROOT },
  );
  const nupkg = listMembersOfDir(out).find(
    (f) => f.endsWith(".nupkg") && !f.endsWith(".symbols.nupkg"),
  );
  if (!nupkg) throw new Error(`dotnet pack produced no .nupkg in ${out}`);
  return join(out, nupkg);
}

function listMembersOfDir(dir) {
  return execFileSync("ls", ["-1", dir], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

const [given, rcFlag, rcVersion] = process.argv.slice(2);
if (given && !existsSync(given)) {
  console.error(`no such .nupkg: ${given}`);
  process.exit(2);
}

/** The version an RC must carry: the one asked for, refused unless it is an -rc.<n> prerelease. */
function releaseCandidateVersion(rc) {
  if (!/^\d+\.\d+\.\d+-rc\.\d+$/.test(rc ?? "")) {
    console.error(`--rc ${rc} is not an X.Y.Z-rc.<n> prerelease`);
    process.exit(2);
  }
  return rc;
}

const expected = {
  version:
    rcFlag === "--rc" ? releaseCandidateVersion(rcVersion) : releaseVersion(),
  contract: contractVersion(),
};
const nupkg = given ?? pack();
const pkg = describePackage(nupkg);

const blind = selfCheck(pkg, expected);
if (blind.length > 0) {
  console.error(
    "\nnuget-contract-package-gate is BLIND: it did not catch a planted\n" +
      blind.map((b) => `  ✗ ${b}`).join("\n") +
      "\nA gate that cannot see its own failure reports zero, and zero reads as success.\n",
  );
  process.exit(1);
}

const failures = auditPackage(pkg, expected);
if (failures.length > 0) {
  console.error(
    `\n${nupkg} is NOT a publishable ${PACKAGE_ID}:\n` +
      failures.map((f) => `  ✗ ${f}`).join("\n") +
      "\n",
  );
  process.exit(1);
}

const snupkg = nupkg.replace(/\.nupkg$/, ".snupkg");
console.log(
  `${pkg.id} ${pkg.version} is clean: ` +
    `every Sitrep.Contract.dll is stamped contract ${expected.contract}, the README states no version, ` +
    `net472 and netstandard2.0 carry Sitrep.Contract alone with no dependencies, ` +
    `net10.0 adds Sitrep.Contract.TestSupport, Sitrep.Core and xunit.assert, ` +
    `the codegen twin and CodegenTwin.props sit outside every lib group, ` +
    `no Reinforced.Typings anywhere but that twin, and no <internal> prose in ${Object.keys(pkg.xmlDocs).length} packed XML docs. ` +
    `${PLANTS.length} planted violations were all caught. ` +
    `Symbols: ${existsSync(snupkg) ? "present" : "ABSENT"}.`,
);
