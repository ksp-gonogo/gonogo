#!/usr/bin/env node
/**
 * Checks a built mod zip, and its netkan, against what CKAN reads.
 *
 * Usage: node scripts/check-ckan-zip.mjs --zip <zip> --folder <GameData folder>
 *          [--netkan <file> --netkan-schema <NetKAN.schema> --ckan-schema <CKAN.schema>]
 *
 * A zip CKAN cannot read installs nothing, and a version SpaceDock already
 * holds cannot be replaced, so the faults are caught after the zip is built
 * and before anything uploads it:
 *
 *   - exactly one `.version`, in KSP-AVC's object form for every version
 *   - a LICENSE inside the mod folder
 *   - one root, `GameData/<folder>/`, and nothing beside it
 *   - the codename `Sitrep` in nothing a player reads: only `Sitrep.*.dll`
 *     under Plugins/ may carry it, by name and by content (a dll's own bytes
 *     are not text a player reads)
 *   - the netkan validates against CKAN's published NetKAN schema
 *
 * Before it looks at the real zip it plants each fault in a copy of a good
 * one and requires every one to be reported. A checker that cannot see a
 * fault reports a clean zip, and a clean report reads as success, so a miss
 * exits BLIND rather than passing.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Ajv04 from "ajv-draft-04";
import { makeTempDir } from "./temp-dir.mjs";

const CKAN_SCHEMA_ID =
  "https://raw.githubusercontent.com/KSP-CKAN/CKAN/master/CKAN.schema";
const VERSION_KEYS = [
  "VERSION",
  "KSP_VERSION",
  "KSP_VERSION_MIN",
  "KSP_VERSION_MAX",
];
const BIG = 256 * 1024 * 1024;

const zipEntries = (zip) =>
  execFileSync("unzip", ["-Z1", zip], { encoding: "utf8", maxBuffer: BIG })
    .split("\n")
    .filter(Boolean);

const zipText = (zip, entry) =>
  execFileSync("unzip", ["-p", zip, entry], {
    encoding: "latin1",
    maxBuffer: BIG,
  });

const numeric = (value) =>
  typeof value === "object" &&
  value !== null &&
  ["MAJOR", "MINOR", "PATCH"].every((k) => Number.isInteger(value[k]));

const asNumber = (v) => v.MAJOR * 1e6 + v.MINOR * 1e3 + v.PATCH;

function versionProblems(zip, entry) {
  let file;
  try {
    file = JSON.parse(zipText(zip, entry));
  } catch (error) {
    return [`${entry} is not valid JSON: ${error.message}`];
  }
  const problems = [];
  if (typeof file.NAME !== "string" || file.NAME === "") {
    problems.push(`${entry}: NAME is missing`);
  }
  for (const key of VERSION_KEYS) {
    if (!numeric(file[key])) {
      problems.push(
        `${entry}: ${key} must be an object of numeric MAJOR, MINOR and PATCH (KSP-AVC's form), got ${JSON.stringify(file[key])}`,
      );
    }
  }
  if (VERSION_KEYS.every((k) => numeric(file[k]))) {
    const [min, game, max] = [
      file.KSP_VERSION_MIN,
      file.KSP_VERSION,
      file.KSP_VERSION_MAX,
    ].map(asNumber);
    if (min > game || game > max) {
      problems.push(
        `${entry}: KSP_VERSION must lie between KSP_VERSION_MIN and KSP_VERSION_MAX`,
      );
    }
  }
  return problems;
}

/** Every fault `zip` has as a CKAN package for `folder`; empty when clean. */
export function checkZip({ zip, folder }) {
  const entries = zipEntries(zip);
  const root = `GameData/${folder}/`;
  const problems = [];

  const stray = entries.filter((e) => e !== "GameData/" && !e.startsWith(root));
  if (stray.length > 0) {
    problems.push(
      `the zip's single root must be ${root}, found ${stray.length} entr${stray.length === 1 ? "y" : "ies"} outside it: ${stray.slice(0, 5).join(", ")}`,
    );
  }

  const versions = entries.filter((e) => e.endsWith(".version"));
  if (versions.length !== 1) {
    problems.push(
      `exactly one .version file is needed, found ${versions.length}${versions.length ? `: ${versions.join(", ")}` : ""}`,
    );
  } else {
    problems.push(...versionProblems(zip, versions[0]));
  }

  if (
    !entries.some(
      (e) => e.startsWith(root) && /^LICENSE(\.[A-Za-z]+)?$/.test(basename(e)),
    )
  ) {
    problems.push(`no LICENSE file inside ${root}`);
  }

  const allowedName = (e) =>
    e.startsWith(`${root}Plugins/`) && /^Sitrep\.[^/]+\.dll$/.test(basename(e));
  for (const entry of entries) {
    if (entry.endsWith("/")) continue;
    if (/sitrep/i.test(entry) && !allowedName(entry)) {
      problems.push(
        `the codename Sitrep is in a file name a player sees: ${entry}`,
      );
      continue;
    }
    if (entry.endsWith(".dll")) continue;
    if (/sitrep/i.test(zipText(zip, entry))) {
      problems.push(`the codename Sitrep is in the text of ${entry}`);
    }
  }
  return problems;
}

/** Every way `netkanFile` fails CKAN's NetKAN schema; empty when it validates. */
export function checkNetkan({ netkan, netkanSchema, ckanSchema }) {
  const ajv = new Ajv04({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  ajv.addSchema(JSON.parse(readFileSync(ckanSchema, "utf8")), CKAN_SCHEMA_ID);
  const validate = ajv.compile(JSON.parse(readFileSync(netkanSchema, "utf8")));
  let doc;
  try {
    doc = JSON.parse(readFileSync(netkan, "utf8"));
  } catch (error) {
    return [`${netkan} is not valid JSON: ${error.message}`];
  }
  if (validate(doc)) return [];
  return validate.errors.map(
    (e) => `${basename(netkan)}${e.instancePath || ""}: ${e.message}`,
  );
}

function plant(dir, name, files) {
  const root = join(dir, name);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const zip = join(dir, `${name}.zip`);
  execFileSync("zip", ["-qr", zip, "."], { cwd: root });
  return zip;
}

const GOOD_VERSION = {
  NAME: "Planted",
  VERSION: { MAJOR: 0, MINOR: 2, PATCH: 0 },
  KSP_VERSION: { MAJOR: 1, MINOR: 12, PATCH: 3 },
  KSP_VERSION_MIN: { MAJOR: 1, MINOR: 12, PATCH: 0 },
  KSP_VERSION_MAX: { MAJOR: 1, MINOR: 12, PATCH: 99 },
};

const goodFiles = () => ({
  "GameData/Planted/LICENSE": "MIT License\n",
  "GameData/Planted/Planted.version": JSON.stringify(GOOD_VERSION),
  "GameData/Planted/Plugins/Planted.dll": "binary mentions Sitrep",
  "GameData/Planted/Plugins/Sitrep.Core.dll": "binary",
  "GameData/Planted/Plugins/build-info.txt": "version=v0.2.0\n",
});

/** Each planted fault and the problem the checker has to name. */
const FAULTS = [
  [
    "a string KSP_VERSION",
    {
      "GameData/Planted/Planted.version": JSON.stringify({
        ...GOOD_VERSION,
        KSP_VERSION: "1.12.3",
      }),
    },
    /KSP_VERSION must be an object/,
  ],
  [
    "a game version outside its range",
    {
      "GameData/Planted/Planted.version": JSON.stringify({
        ...GOOD_VERSION,
        KSP_VERSION_MAX: { MAJOR: 1, MINOR: 11, PATCH: 0 },
      }),
    },
    /between KSP_VERSION_MIN and KSP_VERSION_MAX/,
  ],
  [
    "a second .version",
    { "GameData/Planted/Plugins/Other.version": JSON.stringify(GOOD_VERSION) },
    /exactly one \.version/,
  ],
  [
    "no .version",
    { "GameData/Planted/Planted.version": null },
    /exactly one \.version/,
  ],
  ["no LICENSE", { "GameData/Planted/LICENSE": null }, /no LICENSE/],
  ["a file beside GameData", { "README.txt": "hello" }, /single root/],
  ["the wrong folder", { "GameData/Other/x.txt": "hello" }, /single root/],
  [
    "Sitrep in a text file",
    { "GameData/Planted/Plugins/build-info.txt": "built by Sitrep\n" },
    /text of .*build-info\.txt/,
  ],
  [
    "Sitrep in a file name outside the dlls",
    { "GameData/Planted/Sitrep.cfg": "x" },
    /file name a player sees/,
  ],
];

/** Plants every fault in `check` and lists those it did not report. */
export function selfTest(check = checkZip) {
  const dir = makeTempDir("check-ckan-zip-");
  const clean = check({
    zip: plant(dir, "good", goodFiles()),
    folder: "Planted",
  });
  const misses = [];
  if (clean.length > 0)
    misses.push(`the planted good zip was flagged: ${clean.join("; ")}`);
  for (const [label, change, expected] of FAULTS) {
    const files = { ...goodFiles(), ...change };
    for (const k of Object.keys(files)) if (files[k] === null) delete files[k];
    const found = check({
      zip: plant(dir, label.replace(/\W+/g, "-"), files),
      folder: "Planted",
    });
    if (!found.some((p) => expected.test(p)))
      misses.push(
        `${label} was not reported (got: ${found.join("; ") || "nothing"})`,
      );
  }
  return misses;
}

/** Plants a bad netkan; reports a miss when the schema does not reject it. */
function netkanSelfTest({ netkan, netkanSchema, ckanSchema }) {
  const dir = makeTempDir("check-ckan-netkan-");
  const bad = join(dir, "Bad.netkan");
  const doc = JSON.parse(readFileSync(netkan, "utf8"));
  writeFileSync(
    bad,
    JSON.stringify({ ...doc, identifier: undefined, license: 7 }),
  );
  return checkNetkan({ netkan: bad, netkanSchema, ckanSchema }).length > 0
    ? []
    : ["a netkan with no identifier and a numeric license was accepted"];
}

export function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2)
    args[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!args.zip || !args.folder) {
    console.error(
      "usage: check-ckan-zip.mjs --zip <zip> --folder <folder> [--netkan <f> --netkan-schema <f> --ckan-schema <f>]",
    );
    return 2;
  }
  const netkan = args.netkan
    ? {
        netkan: args.netkan,
        netkanSchema: args["netkan-schema"],
        ckanSchema: args["ckan-schema"],
      }
    : null;
  if (netkan && !(netkan.netkanSchema && netkan.ckanSchema)) {
    console.error("--netkan needs --netkan-schema and --ckan-schema");
    return 2;
  }

  const blind = [...selfTest(), ...(netkan ? netkanSelfTest(netkan) : [])];
  if (blind.length > 0) {
    console.error(
      `BLIND: the check cannot see what it exists to catch:\n  ${blind.join("\n  ")}`,
    );
    return 3;
  }

  const problems = [
    ...checkZip({ zip: args.zip, folder: args.folder }),
    ...(netkan ? checkNetkan(netkan) : []),
  ];
  if (problems.length > 0) {
    console.error(
      `${args.zip} is not what CKAN reads:\n  ${problems.join("\n  ")}`,
    );
    return 1;
  }
  console.log(
    `${basename(args.zip)}: what CKAN reads is in order${netkan ? `, and ${basename(netkan.netkan)} validates` : ""}`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
