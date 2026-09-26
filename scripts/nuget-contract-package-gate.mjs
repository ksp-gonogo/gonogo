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
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const PACKAGE_ID = "KspGonogo.Sitrep.Contract";

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

  return {
    id: pick("id"),
    version: pick("version"),
    readme: pick("readme"),
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
export function auditPackage(pkg, expectedVersion) {
  const failures = [];

  if (pkg.id !== PACKAGE_ID) {
    failures.push(
      `package id is ${pkg.id}, expected ${PACKAGE_ID}. The nuget.org trusted-publishing ` +
        `policy globs the whole ksp-gonogo org, so a typo publishes a second package ` +
        `rather than failing.`,
    );
  }

  if (pkg.version !== expectedVersion) {
    failures.push(
      `package version is ${pkg.version}, but ContractVersion.cs + PackagePatch say ` +
        `${expectedVersion}. Major.Minor IS the contract version; a drift there makes a ` +
        `PackageReference range say something false about the wire. Patch is the ` +
        `package's own: see PackagePatch in Sitrep.Contract.Package.csproj.`,
    );
  }

  if (!pkg.readme) failures.push("no <readme> in the nuspec");
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

  for (const [member, names] of Object.entries(pkg.assemblyNamesInBytes)) {
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
    what: "<internal> maintainer prose surviving into a packed XML doc",
    mutate: (p) => {
      p.xmlDocs["lib/net472/Sitrep.Contract.xml"] =
        "<doc><summary>a<internal>why</internal></summary></doc>";
    },
  },
  {
    what: "a package version that does not match ContractVersion.cs",
    mutate: (p) => {
      p.version = "999.0.0";
    },
  },
  {
    what: "a missing package README",
    mutate: (p) => {
      p.readme = undefined;
    },
  },
];

function selfCheck(pkg, expectedVersion) {
  const blind = [];
  for (const plant of PLANTS) {
    const mutated = clone(pkg);
    plant.mutate(mutated);
    if (auditPackage(mutated, expectedVersion).length === 0) {
      blind.push(plant.what);
    }
  }
  return blind;
}

// ── Driver ───────────────────────────────────────────────────────────────────

/**
 * The one source of truth for the package version, read the way MSBuild reads
 * it: Major.Minor off ContractVersion.cs, Patch off the csproj's own
 * PackagePatch (the package's own, not a mirror of the contract).
 *
 * Also mirrors the csproj's own `_CheckPackagePatchResetForContract` target:
 * a nonzero PackagePatch left over from an earlier contract line is caught
 * here too, before a pack is even attempted, rather than only at MSBuild time.
 */
function contractVersion() {
  const contractSrc = readFileSync(CONTRACT_VERSION_CS, "utf8");
  const readContract = (name) => {
    const m = new RegExp(
      `public\\s+const\\s+int\\s+${name}\\s*=\\s*(\\d+)\\s*;`,
    ).exec(contractSrc);
    if (!m) {
      throw new Error(
        `no "public const int ${name}" in ${CONTRACT_VERSION_CS}: the declaration ` +
          `moved, and both this gate and Sitrep.Contract.Package.csproj read it by shape`,
      );
    }
    return m[1];
  };
  const major = readContract("Major");
  const minor = readContract("Minor");

  const packSrc = readFileSync(PACK_PROJECT, "utf8");
  const readPack = (tag) => {
    const m = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(packSrc);
    if (!m) {
      throw new Error(
        `no <${tag}> in ${PACK_PROJECT}: the property moved, and this gate reads it by shape`,
      );
    }
    return m[1];
  };
  const patch = readPack("PackagePatch");
  const patchForContract = readPack("PackagePatchForContract");

  if (patch !== "0" && patchForContract !== `${major}.${minor}`) {
    throw new Error(
      `PackagePatch is ${patch}, left over from contract ${patchForContract}, but ` +
        `ContractVersion.cs now says ${major}.${minor}. Sitrep.Contract.Package.csproj's ` +
        `own _CheckPackagePatchResetForContract target enforces this at pack time; this ` +
        `mirror catches it before a pack is even attempted.`,
    );
  }

  return `${major}.${minor}.${patch}`;
}

function pack() {
  const out = mkdtempSync(join(tmpdir(), "sitrep-contract-pack-"));
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

const given = process.argv[2];
if (given && !existsSync(given)) {
  console.error(`no such .nupkg: ${given}`);
  process.exit(2);
}

const expectedVersion = contractVersion();
const nupkg = given ?? pack();
const pkg = describePackage(nupkg);

const blind = selfCheck(pkg, expectedVersion);
if (blind.length > 0) {
  console.error(
    "\nnuget-contract-package-gate is BLIND: it did not catch a planted\n" +
      blind.map((b) => `  ✗ ${b}`).join("\n") +
      "\nA gate that cannot see its own failure reports zero, and zero reads as success.\n",
  );
  process.exit(1);
}

const failures = auditPackage(pkg, expectedVersion);
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
    `net472 and netstandard2.0 carry Sitrep.Contract alone with no dependencies, ` +
    `net10.0 adds Sitrep.Contract.TestSupport, Sitrep.Core and xunit.assert, ` +
    `no Reinforced.Typings ` +
    `anywhere, and no <internal> prose in ${Object.keys(pkg.xmlDocs).length} packed XML docs. ` +
    `${PLANTS.length} planted violations were all caught. ` +
    `Symbols: ${existsSync(snupkg) ? "present" : "ABSENT"}.`,
);
