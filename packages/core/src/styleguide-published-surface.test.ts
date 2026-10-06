// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXTENSION_API_VERSION } from "@ksp-gonogo/sitrep-sdk";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  declarePending,
  freezeEntry,
  gradeLedger,
  type Ledger,
  ledgerJson,
  parseLedger,
  RULE_NAMES,
  reprintFloor,
  seedLedger,
} from "./published-surface.ledger";
import { keyOf, scanPublishedSurface } from "./published-surface.scan";

/**
 * The type surface of every published package is held to a ledger of frozen
 * floors, in the shape of the C# `ContractShapeGateTests`. The surface is
 * derived from each package's export map, never listed by hand, and a change
 * to it that the ledger does not declare fails here.
 *
 * Two ledgers: the sitrep-sdk and ui-kit share one under
 * `EXTENSION_API_VERSION`, the number the loader refuses an Uplink on; the
 * uplink-tools surface has its own, whose entries are the releases that froze
 * them (every published package carries the release version).
 *
 * While `versionMoves` is `at-release`, a change is declared in the ledger's
 * `pending` entry, each break and addition by key with a note, and the version
 * does not move. The release freeze turns `pending` into an entry and says what
 * the version must become.
 *
 * Utilities, each guarded by its variable alone (vitest has no unconditional
 * skip), naming a ledger id:
 *
 * - `GONOGO_SURFACE_SEED`: records the first floor of an empty ledger
 * - `GONOGO_SURFACE_DECLARE`: writes the computed change into `pending`,
 *   keeping notes already written; fill in each empty `note` afterwards
 * - `GONOGO_SURFACE_FREEZE`: turns a fully declared `pending` into the next
 *   entry; `GONOGO_SURFACE_NOTE` is its note, and `GONOGO_SURFACE_RELEASE` the
 *   release version a `release`-versioned ledger records it under
 * - `GONOGO_SURFACE_REPRINT`: re-prints the floor after TypeScript moved
 *
 * Each prints the `biome check --write` the ledger file then needs.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

interface LedgerSpec {
  id: string;
  file: string;
  packages: readonly string[];
  /** The version the code carries, which the ledger's latest entry must equal. */
  version: () => string;
  /** The least exported names the walk may find in each package, set under today's counts. */
  census: Readonly<Record<string, number>>;
}

function packageVersion(dir: string): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8"),
  );
  const version =
    typeof manifest === "object" && manifest !== null
      ? Reflect.get(manifest, "version")
      : null;
  if (typeof version !== "string") throw new Error(`${dir} has no version`);
  return version;
}

const LEDGERS: readonly LedgerSpec[] = [
  {
    id: "extension-api",
    file: "mod/sitrep-sdk/extension-api.ledger.json",
    packages: ["@ksp-gonogo/sitrep-sdk", "@ksp-gonogo/ui-kit"],
    version: () => EXTENSION_API_VERSION,
    census: { "@ksp-gonogo/sitrep-sdk": 600, "@ksp-gonogo/ui-kit": 500 },
  },
  {
    id: "uplink-tools",
    file: "packages/uplink-tools/api-surface.ledger.json",
    packages: ["@ksp-gonogo/uplink-tools"],
    version: () => packageVersion("packages/uplink-tools"),
    census: { "@ksp-gonogo/uplink-tools": 60 },
  },
];

const VERSIONING = {
  "extension-api": "semver",
  "uplink-tools": "release",
} as const;

const shapes = scanPublishedSurface(REPO_ROOT);

const currentOf = (spec: LedgerSpec): string[] =>
  spec.packages.flatMap((pkg) => shapes.get(pkg)?.lines ?? []);

const readLedger = (spec: LedgerSpec): Ledger =>
  parseLedger(readFileSync(join(REPO_ROOT, spec.file), "utf8"));

function writeLedger(spec: LedgerSpec, ledger: Ledger): void {
  writeFileSync(join(REPO_ROOT, spec.file), ledgerJson(ledger));
  console.info(
    `wrote ${spec.file}; now run: pnpm exec biome check --write ${spec.file}`,
  );
}

const ledgerOptional = (spec: LedgerSpec): Ledger | null => {
  try {
    return readLedger(spec);
  } catch {
    return null;
  }
};

describe("the published surface utilities", () => {
  for (const spec of LEDGERS) {
    const tag = (variable: string) =>
      process.env[variable] === spec.id
        ? `${spec.id}: ${variable} is set`
        : `${spec.id}: skipped, ${variable} is not set`;

    it.runIf(process.env.GONOGO_SURFACE_SEED === spec.id)(
      tag("GONOGO_SURFACE_SEED"),
      () => {
        if (ledgerOptional(spec)) {
          throw new Error(
            `${spec.file} exists, and a floor is never rewritten`,
          );
        }
        writeLedger(
          spec,
          seedLedger(
            currentOf(spec),
            spec.version(),
            ts.version,
            VERSIONING[spec.id as keyof typeof VERSIONING],
            "at-release",
          ),
        );
      },
    );

    it.runIf(process.env.GONOGO_SURFACE_DECLARE === spec.id)(
      tag("GONOGO_SURFACE_DECLARE"),
      () => {
        const declared = declarePending(readLedger(spec), currentOf(spec));
        writeLedger(spec, declared);
        const { breaks, additions } = declared.pending;
        console.info(
          [
            `breaks (${breaks.length}):`,
            ...breaks.map((c) => `  ${c.key}`),
            `additions (${additions.length}):`,
            ...additions.map((c) => `  ${c.key}`),
            "write each empty note in pending, then run the freeze at release",
          ].join("\n"),
        );
      },
    );

    it.runIf(process.env.GONOGO_SURFACE_FREEZE === spec.id)(
      tag("GONOGO_SURFACE_FREEZE"),
      () => {
        const note = process.env.GONOGO_SURFACE_NOTE?.trim();
        if (!note)
          throw new Error("set GONOGO_SURFACE_NOTE to the entry's note");
        const { ledger, version } = freezeEntry(
          readLedger(spec),
          currentOf(spec),
          note,
          process.env.GONOGO_SURFACE_RELEASE,
        );
        writeLedger(spec, ledger);
        console.info(
          `froze ${version}: set the version the code carries to ${version}`,
        );
      },
    );

    it.runIf(process.env.GONOGO_SURFACE_REPRINT === spec.id)(
      tag("GONOGO_SURFACE_REPRINT"),
      () => {
        writeLedger(
          spec,
          reprintFloor(readLedger(spec), currentOf(spec), ts.version),
        );
      },
    );
  }
});

describe("the published surface is derived, and read whole", () => {
  it("covers every published package in exactly one ledger", () => {
    const covered = LEDGERS.flatMap((spec) => [...spec.packages]).sort();
    expect(covered).toEqual([...shapes.keys()].sort());
  });

  for (const spec of LEDGERS) {
    for (const pkg of spec.packages) {
      it(`${pkg}: the walk reads at least ${spec.census[pkg]} exported names`, () => {
        expect(shapes.get(pkg)?.names ?? 0).toBeGreaterThanOrEqual(
          spec.census[pkg],
        );
      });
    }
  }

  it("names no machine's path in a line", () => {
    for (const spec of LEDGERS) {
      const lines = currentOf(spec).filter(
        (line) => line.includes(REPO_ROOT) || /\/(Users|home)\//.test(line),
      );
      expect(lines.slice(0, 3).map(keyOf)).toEqual([]);
    }
  });

  it("types a contract Minor as a number and a contract Major as its literal", () => {
    const lines = currentOf(LEDGERS[0]);
    const typeOf = (name: string) =>
      lines.find((line) => line.startsWith(`sitrep-sdk . ${name} :: `));
    expect(typeOf("CONTRACT_MINOR")).toBe(
      "sitrep-sdk . CONTRACT_MINOR :: number",
    );
    expect(typeOf("CONTRACT_MAJOR")).toMatch(/:: \d+$/);
  });

  it("reads the export map's subpaths, none left out by judgement", () => {
    const subpaths = (pkg: string) =>
      shapes.get(pkg)?.entries.map((entry) => entry.subpath) ?? [];
    expect(subpaths("@ksp-gonogo/sitrep-sdk")).toEqual(
      expect.arrayContaining([
        ".",
        "./frames",
        "./spine",
        "./registry",
        "./testing",
      ]),
    );
    expect(subpaths("@ksp-gonogo/ui-kit")).toEqual(
      expect.arrayContaining([".", "./testing", "./grid", "./guards"]),
    );
  });
});

for (const spec of LEDGERS) {
  describe(`${spec.id} ledger (${spec.file})`, () => {
    const ledger = ledgerOptional(spec);

    it("exists and parses", () => {
      expect(ledger, `${spec.file} is missing or malformed`).not.toBeNull();
    });

    const graded = ledger
      ? gradeLedger({
          ledger,
          current: currentOf(spec),
          version: spec.version(),
          typescript: ts.version,
        })
      : null;

    for (const rule of RULE_NAMES) {
      it(rule, () => {
        expect(graded?.[rule] ?? ["no ledger"]).toEqual([]);
      });
    }

    it("sees a planted removal, retype and addition, or the gate is blind", () => {
      if (!ledger) throw new Error("no ledger");
      const current = currentOf(spec);
      const grade = (planted: string[]) =>
        gradeLedger({
          ledger,
          current: planted,
          version: spec.version(),
          typescript: ts.version,
        });
      const declared = new Set(
        [...ledger.pending.breaks, ...ledger.pending.additions].map(
          (c) => c.key,
        ),
      );
      const victim =
        current.find(
          (line) => line.includes(" :: ") && !declared.has(keyOf(line)),
        ) ?? "";
      const removed = grade(current.filter((line) => line !== victim));
      const retyped = grade(
        current.map((line) => (line === victim ? `${line} | undefined` : line)),
      );
      const added = grade([...current, "planted . Fresh :: interface"]);
      const seen = (results: Record<string, string[]>) =>
        Object.values(results).some((list) => list.length > 0);
      expect(seen(removed), "a removed export went unseen: BLIND").toBe(true);
      expect(seen(retyped), "a retyped export went unseen: BLIND").toBe(true);
      expect(seen(added), "an undeclared addition went unseen: BLIND").toBe(
        true,
      );
    });
  });
}
