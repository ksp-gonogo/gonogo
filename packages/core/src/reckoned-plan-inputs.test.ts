import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A command centre's contact plan is made only of what that centre has heard:
 * each craft's last received state, reckoned forward, over ground stations and
 * bodies that need no reception to know. A plan that reads anything else can
 * move before the light carrying the news has arrived, which is the leak the
 * 2026-10-03 audit found (the plan was made from every craft's live orbit).
 *
 * This is the guard that keeps it a rule. It fails when the plan builder is
 * given a way to reach the game, the live link graph, a comms backend or the
 * delay ledger, and when a plan is built anywhere but through it.
 *
 * A source scan because the only thing that separates a plan made from heard
 * state from one made from live state is what the code that builds it can
 * name. Each rule plants its own violation first and fails as BLIND if the
 * scan cannot see it, since a scan that cannot see reports a clean tree.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start: string): string {
  let dir = start;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error("no pnpm-workspace.yaml above " + start);
    dir = parent;
  }
  return dir;
}

const ROOT = findRepoRoot(HERE);
const COMMS = "mod/Sitrep.Host/Comms";

/** The builder, and the state it is handed: nothing here may reach anything live. */
const PURE_FILES = [`${COMMS}/ReckonedPlan.cs`, `${COMMS}/CraftState.cs`];

/** Where a centre's received states are kept: it may hear, and do nothing else. */
const HEARING_FILE = `${COMMS}/CentreHearing.cs`;

/** The namespaces a pure file may open: the language, the contract's data types and the propagation maths. */
const PURE_USINGS =
  /^(System(\.Collections\.Generic)?|Sitrep\.Contract|Sitrep\.Propagation(\.Contacts|\.Visibility)?)$/;

/**
 * Names that are a way to read something live. `Sitrep.Host.Comms` holds
 * several of them, so a `using` allowlist alone would not keep them out of a
 * file in that namespace.
 */
const LIVE_NAMES = [
  // the game
  "IContactGame",
  "ContactGameLook",
  "ContactGameNode",
  "KspSnapshot",
  "FlightGlobals",
  "Planetarium",
  "CommNet",
  // the comms backend and the kernel that elects it
  "Kernel",
  "CommsElection",
  "PropagationElection",
  "ICommsBackend",
  "ICommsContactModel",
  "ICommsReachModel",
  "ICommsOcclusionModel",
  "ISecularPropagation",
  // the engine, the delay ledger and the live link graph
  "IUplinkHost",
  "ChannelEngine",
  "Courier",
  "Archive",
  "INetwork",
  "StubNetwork",
  "DelayStamp",
  "IPlanAudienceHost",
  "ContactPlanSource",
  "CraftStateRecorder\\.Capture",
];

/** What the hearing must not do with the host it listens through. */
const HEARING_FORBIDDEN = [
  "RecordCraftState",
  "RecordCraftGone",
  "NoteCraftPresent",
];

/** C# with its comments taken out, so prose naming a forbidden type is not a use of it. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");

function usingsOf(source: string): string[] {
  return [
    ...code(source).matchAll(/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm),
  ].map((m) => m[1] ?? "");
}

function liveNamesIn(source: string, names: readonly string[]): string[] {
  const stripped = code(source);
  return names.filter((name) =>
    new RegExp(`(?<!\\w)${name}\\b`).test(stripped),
  );
}

function pureViolations(source: string): string[] {
  return [
    ...usingsOf(source)
      .filter((ns) => !PURE_USINGS.test(ns))
      .map((ns) => `opens ${ns}`),
    ...liveNamesIn(source, LIVE_NAMES).map(
      (name) => `names ${name.replace("\\", "")}`,
    ),
  ];
}

function hearingViolations(source: string): string[] {
  return [
    ...usingsOf(source)
      .filter((ns) => !PURE_USINGS.test(ns))
      .map((ns) => `opens ${ns}`),
    ...liveNamesIn(source, [...LIVE_NAMES, ...HEARING_FORBIDDEN]).map(
      (name) => `names ${name.replace("\\", "")}`,
    ),
  ];
}

const SKIP_DIRS = new Set(["bin", "obj", "node_modules"]);
const TEST_DIR = /\.(Tests|IntegrationTests)$/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || TEST_DIR.test(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (path.endsWith(".cs")) yield path;
  }
}

/**
 * The ways a plan is put together, and the one file each may be used in. A
 * plan request or a pair made anywhere else is a plan with inputs this scan
 * has not read.
 */
const BUILDING_BLOCKS: ReadonlyArray<{
  what: RegExp;
  only: readonly string[];
}> = [
  { what: /new\s+ContactPlanRequest\s*\(/, only: [`${COMMS}/ReckonedPlan.cs`] },
  { what: /new\s+PlanPair\s*\(/, only: [`${COMMS}/ReckonedPlan.cs`] },
  {
    what: /ContactPlanner\s*\.\s*Plan\s*\(/,
    only: [
      `${COMMS}/ContactPlanning.cs`,
      "mod/Sitrep.Propagation/Contacts/ContactPlanner.cs",
    ],
  },
];

function builtElsewhere(files: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];
  for (const [file, source] of files) {
    const stripped = code(source);
    for (const block of BUILDING_BLOCKS) {
      if (block.what.test(stripped) && !block.only.includes(file)) {
        found.push(`${file}: ${block.what.source}`);
      }
    }
  }
  return found;
}

function modSources(): Map<string, string> {
  const files = new Map<string, string>();
  for (const path of walk(join(ROOT, "mod"))) {
    files.set(
      relative(ROOT, path).split("\\").join("/"),
      readFileSync(path, "utf8"),
    );
  }
  return files;
}

const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

describe("a contact plan is made only of what its centre has heard", () => {
  it("sees a planted violation of every rule, or it is blind", () => {
    const clean =
      "using System;\nnamespace Sitrep.Host.Comms { public static class Clean { } }\n";
    expect(
      pureViolations(clean),
      "BLIND: a clean file reads as a violation",
    ).toEqual([]);
    expect(
      pureViolations(`using UnityEngine;\n${clean}`),
      "BLIND: a using outside the allowlist is not seen",
    ).toEqual(["opens UnityEngine"]);
    for (const name of LIVE_NAMES) {
      const spelled = name.replace("\\", "");
      expect(
        pureViolations(
          `${clean}class Planted { object x = ${spelled}(null); }`,
        ),
        `BLIND: a use of ${spelled} is not seen`,
      ).toEqual([`names ${spelled}`]);
    }
    expect(
      pureViolations(
        `${clean}// reads nothing from the Kernel or CommsElection\n/* ChannelEngine */`,
      ),
      "BLIND the other way: a comment naming a type reads as a use",
    ).toEqual([]);
    for (const name of HEARING_FORBIDDEN) {
      expect(
        hearingViolations(
          `${clean}class Planted { void M() { _host.${name}(x); } }`,
        ),
        `BLIND: the hearing calling ${name} is not seen`,
      ).toEqual([`names ${name}`]);
    }
    const planted = new Map([
      [
        "mod/Gonogo.KSP/Somewhere.cs",
        "var r = new ContactPlanRequest(a, b);\nvar p = new PlanPair (x, y);\nContactPlanner.Plan(n);",
      ],
      [
        `${COMMS}/ReckonedPlan.cs`,
        "var r = new ContactPlanRequest(a, b); var p = new PlanPair(x, y);",
      ],
    ]);
    expect(
      builtElsewhere(planted),
      "BLIND: a plan built outside the builder is not seen",
    ).toHaveLength(3);
  });

  it.each(PURE_FILES)("%s reaches nothing live", (file) => {
    expect(
      pureViolations(read(file)),
      `${file} builds a centre's plan, or is what the plan is built from. It may read only the craft states that ` +
        "centre has heard and the stations and bodies it is handed. Pass the fact in as data the centre has received, " +
        "never a way to look it up.",
    ).toEqual([]);
  });

  it("the hearing only listens", () => {
    expect(
      hearingViolations(read(HEARING_FILE)),
      `${HEARING_FILE} keeps what each centre has received. It may hear a craft's state at a centre and nothing else.`,
    ).toEqual([]);
  });

  it("no plan is built anywhere but the builder", () => {
    const sources = modSources();
    expect(sources.size, "BLIND: no C# found under mod/").toBeGreaterThan(100);
    expect(
      builtElsewhere(sources),
      "A contact plan's request and its pairs are made in ReckonedPlan.cs alone, from heard state. " +
        "Building one elsewhere gives it inputs nothing has checked.",
    ).toEqual([]);
  });
});
