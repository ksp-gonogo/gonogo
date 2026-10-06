// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  declarePending,
  freezeEntry,
  frozenAt,
  gradeLedger,
  type Ledger,
  ledgerJson,
  nextVersion,
  parseLedger,
  reprintFloor,
  seedLedger,
} from "./published-surface.ledger";

const BASE = [
  "p . A :: interface",
  "p . A#x :: string",
  "p . A#y? :: number",
  "p . f :: (n: number): string",
];

const TS = "5.0.0";

const seeded = (
  versioning: Ledger["versioning"] = "semver",
  moves: Ledger["versionMoves"] = "at-release",
  version = "6.0.0",
) => seedLedger(BASE, version, TS, versioning, moves);

const grade = (
  ledger: Ledger,
  current: readonly string[],
  version = ledger.entries[ledger.entries.length - 1].version,
  typescript = TS,
) => gradeLedger({ ledger, current, version, typescript });

const problems = (results: Record<string, string[]>) =>
  Object.entries(results).flatMap(([rule, list]) =>
    list.map((p) => `${rule}: ${p}`),
  );

describe("a ledger over an unchanged shape", () => {
  it("passes every rule", () => {
    expect(problems(grade(seeded(), BASE))).toEqual([]);
  });

  it("survives a round trip through its file", () => {
    const ledger = seeded();
    expect(parseLedger(ledgerJson(ledger))).toEqual(ledger);
  });
});

describe("EachVersionAppearsExactlyOnceInTheLedger", () => {
  it("fails when two entries carry one version", () => {
    const ledger = seeded();
    ledger.entries.push({ ...ledger.entries[0], floor: undefined });
    expect(
      grade(ledger, BASE).EachVersionAppearsExactlyOnceInTheLedger,
    ).toHaveLength(1);
  });
});

describe("CurrentVersionIsRecordedInTheLedger", () => {
  it("fails when the code moved to a version the ledger never recorded", () => {
    const results = grade(seeded(), BASE, "7.0.0");
    expect(results.CurrentVersionIsRecordedInTheLedger).toHaveLength(1);
  });

  it("fails on an empty ledger", () => {
    const ledger = { ...seeded(), entries: [] };
    expect(
      grade(ledger, BASE, "6.0.0").CurrentVersionIsRecordedInTheLedger,
    ).toHaveLength(1);
  });
});

describe("CurrentShapeIsAdditiveOverTheFrozenFloor", () => {
  it("fails on a removal that pending does not declare", () => {
    const results = grade(
      seeded(),
      BASE.filter((l) => !l.startsWith("p . f")),
    );
    expect(results.CurrentShapeIsAdditiveOverTheFrozenFloor).toEqual([
      expect.stringContaining("p . f"),
    ]);
  });

  it("fails on a retype that pending does not declare", () => {
    const retyped = BASE.map((l) =>
      l === "p . A#x :: string" ? "p . A#x :: number" : l,
    );
    expect(
      grade(seeded(), retyped).CurrentShapeIsAdditiveOverTheFrozenFloor,
    ).toHaveLength(1);
  });

  it("passes when pending declares the break with a note", () => {
    const ledger = seeded();
    ledger.pending.breaks.push({ key: "p . f", note: "gone" });
    expect(
      problems(
        grade(
          ledger,
          BASE.filter((l) => !l.startsWith("p . f")),
        ),
      ),
    ).toEqual([]);
  });
});

describe("PendingDeclaresExactlyTheComputedChange", () => {
  const WITH_NEW = [...BASE, "p . g :: (): void"];

  it("fails on an addition that pending does not declare", () => {
    expect(
      grade(seeded(), WITH_NEW).PendingDeclaresExactlyTheComputedChange,
    ).toEqual([expect.stringContaining("p . g")]);
  });

  it("passes when the addition is declared with a note", () => {
    const ledger = seeded();
    ledger.pending.additions.push({ key: "p . g", note: "new" });
    expect(problems(grade(ledger, WITH_NEW))).toEqual([]);
  });

  it("fails on a declared note that is empty", () => {
    const ledger = seeded();
    ledger.pending.additions.push({ key: "p . g", note: "  " });
    expect(
      grade(ledger, WITH_NEW).PendingDeclaresExactlyTheComputedChange,
    ).toHaveLength(1);
  });

  it("fails on a declaration the shape does not carry out", () => {
    const ledger = seeded();
    ledger.pending.additions.push({ key: "p . g", note: "new" });
    ledger.pending.breaks.push({ key: "p . f", note: "gone" });
    expect(
      grade(ledger, BASE).PendingDeclaresExactlyTheComputedChange,
    ).toHaveLength(2);
  });

  it("counts a new required member of an existing interface as a break, not an addition", () => {
    const ledger = seeded();
    ledger.pending.additions.push({ key: "p . A#z", note: "new" });
    const results = grade(ledger, [...BASE, "p . A#z :: string"]);
    expect(results.PendingDeclaresExactlyTheComputedChange).toHaveLength(1);
    expect(results.CurrentShapeIsAdditiveOverTheFrozenFloor).toHaveLength(1);
  });

  it("holds an every-change ledger to no pending and no unrecorded change", () => {
    const ledger = seeded("semver", "every-change");
    const results = grade(ledger, WITH_NEW);
    expect(results.PendingDeclaresExactlyTheComputedChange).not.toHaveLength(0);
    ledger.pending.additions.push({ key: "p . g", note: "new" });
    expect(
      grade(ledger, BASE).PendingDeclaresExactlyTheComputedChange,
    ).not.toHaveLength(0);
  });
});

describe("EveryEntryDeclaresExactlyWhatItChanged", () => {
  const afterBreak = BASE.filter((l) => !l.startsWith("p . f"));

  const frozenBreak = () =>
    freezeEntry(
      {
        ...seeded(),
        pending: { breaks: [{ key: "p . f", note: "gone" }], additions: [] },
      },
      afterBreak,
      "drop f",
    );

  it("accepts an entry the freeze wrote", () => {
    const { ledger, version } = frozenBreak();
    expect(version).toBe("7.0.0");
    expect(problems(grade(ledger, afterBreak))).toEqual([]);
  });

  it("fails a major that under-declares what it broke", () => {
    const { ledger } = frozenBreak();
    ledger.entries[1].breaks = [];
    ledger.entries[1].additions = [
      { key: "p . x", note: "n", lines: ["p . x :: 1"] },
    ];
    expect(
      grade(ledger, afterBreak).EveryEntryDeclaresExactlyWhatItChanged,
    ).not.toHaveLength(0);
  });

  it("fails a major that over-declares", () => {
    const { ledger } = frozenBreak();
    ledger.entries[1].breaks.push({ key: "p . A#x", note: "n" });
    expect(
      grade(ledger, afterBreak).EveryEntryDeclaresExactlyWhatItChanged,
    ).not.toHaveLength(0);
  });

  it("fails a major that leaves an addition undeclared", () => {
    const current = [...afterBreak, "p . g :: (): void"];
    const { ledger } = freezeEntry(
      {
        ...seeded(),
        pending: {
          breaks: [{ key: "p . f", note: "gone" }],
          additions: [{ key: "p . g", note: "new" }],
        },
      },
      current,
      "drop f, add g",
    );
    expect(problems(grade(ledger, current))).toEqual([]);
    ledger.entries[1].additions = [];
    expect(
      grade(ledger, current).EveryEntryDeclaresExactlyWhatItChanged,
    ).not.toHaveLength(0);
  });

  it("fails a break recorded under a minor's version", () => {
    const { ledger } = frozenBreak();
    ledger.entries[1].version = "6.1.0";
    expect(
      grade(ledger, afterBreak, "6.1.0").EveryEntryDeclaresExactlyWhatItChanged,
    ).not.toHaveLength(0);
  });

  it("fails a minor that adds nothing", () => {
    const ledger = seeded();
    ledger.entries.push({
      version: "6.1.0",
      note: "n",
      breaks: [],
      additions: [],
    });
    expect(
      grade(ledger, BASE, "6.1.0").EveryEntryDeclaresExactlyWhatItChanged,
    ).not.toHaveLength(0);
  });

  it("fails a minor that adds what the floor already has", () => {
    const ledger = seeded();
    ledger.entries.push({
      version: "6.1.0",
      note: "n",
      breaks: [],
      additions: [
        { key: "p . f", note: "n", lines: ["p . f :: (n: number): string"] },
      ],
    });
    expect(
      grade(ledger, BASE, "6.1.0").EveryEntryDeclaresExactlyWhatItChanged,
    ).not.toHaveLength(0);
  });
});

describe("ShapeWasPrintedByTheLedgersTypeScript", () => {
  it("fails when another TypeScript is installed", () => {
    expect(
      grade(seeded(), BASE, "6.0.0", "6.0.0")
        .ShapeWasPrintedByTheLedgersTypeScript,
    ).toHaveLength(1);
  });
});

describe("the freeze", () => {
  const WITH_NEW = [...BASE, "p . g :: (): void"];
  const declared = (ledger: Ledger, current: readonly string[]) => {
    const out = declarePending(ledger, current);
    const noted = (list: { key: string; note: string }[]) =>
      list.map((c) => ({ ...c, note: "why" }));
    return {
      ...out,
      pending: {
        breaks: noted(out.pending.breaks),
        additions: noted(out.pending.additions),
      },
    };
  };

  it("moves a major on a break and a minor on an addition under semver", () => {
    expect(nextVersion("6.0.0", true, "semver")).toBe("7.0.0");
    expect(nextVersion("6.2.0", false, "semver")).toBe("6.3.0");
  });

  it("moves the minor on a break and the patch on an addition at 0.x", () => {
    expect(nextVersion("0.1.0", true, "zero-major")).toBe("0.2.0");
    expect(nextVersion("0.1.4", false, "zero-major")).toBe("0.1.5");
  });

  it("records an addition as a minor entry that carries no floor", () => {
    const { ledger, version } = freezeEntry(
      declared(seeded(), WITH_NEW),
      WITH_NEW,
      "n",
    );
    expect(version).toBe("6.1.0");
    expect(ledger.entries[1].floor).toBeUndefined();
    expect(frozenAt(ledger, 1)).toContain("p . g :: (): void");
    expect(ledger.pending).toEqual({ breaks: [], additions: [] });
  });

  it("refuses to freeze an unchanged shape", () => {
    expect(() => freezeEntry(seeded(), BASE, "n")).toThrow(/nothing to freeze/);
  });

  it("refuses a change that was not declared first", () => {
    expect(() => freezeEntry(seeded(), WITH_NEW, "n")).toThrow(
      /declare the change first/,
    );
  });

  it("refuses a declaration with an empty note", () => {
    expect(() =>
      freezeEntry(declarePending(seeded(), WITH_NEW), WITH_NEW, "n"),
    ).toThrow(/no note/);
  });

  it("keeps a note already written when the change is declared again", () => {
    const once = declared(seeded(), WITH_NEW);
    const twice = declarePending(once, WITH_NEW);
    expect(twice.pending.additions[0].note).toBe("why");
  });

  it("keeps only the two most recent floors", () => {
    let ledger = seeded();
    let current = [...BASE];
    for (let i = 0; i < 3; i += 1) {
      current = current
        .filter((l) => !l.startsWith(`p . f${i === 0 ? "" : i}`))
        .concat(`p . f${i + 1} :: ${i}`);
      ledger = freezeEntry(declared(ledger, current), current, `n${i}`).ledger;
    }
    expect(ledger.entries.filter((e) => e.floor)).toHaveLength(2);
    expect(ledger.entries[0].floor).toBeUndefined();
  });
});

describe("re-printing a floor under another TypeScript", () => {
  it("keeps every key, taking the new print of each line", () => {
    const reprinted = BASE.map((l) => l.replace("string", "String"));
    const out = reprintFloor(seeded(), reprinted, "6.0.0");
    expect(out.typescript).toBe("6.0.0");
    expect(frozenAt(out, 0)).toEqual([...reprinted].sort());
  });

  it("refuses when the new print has dropped a floor key", () => {
    expect(() => reprintFloor(seeded(), BASE.slice(1), "6.0.0")).toThrow(
      /cannot re-print/,
    );
  });
});

describe("a ledger versioned by the release", () => {
  const WITH_NEW = [...BASE, "p . g :: (): void"];
  const AFTER_BREAK = BASE.filter((l) => !l.startsWith("p . f"));
  const released = () => seeded("release", "at-release", "0.1.0");
  const declare = (current: readonly string[]) => {
    const out = declarePending(released(), current);
    const noted = (list: { key: string; note: string }[]) =>
      list.map((c) => ({ ...c, note: "why" }));
    return {
      ...out,
      pending: {
        breaks: noted(out.pending.breaks),
        additions: noted(out.pending.additions),
      },
    };
  };

  it("records a change under the release version it is given, break or addition", () => {
    const added = freezeEntry(declare(WITH_NEW), WITH_NEW, "n", "0.4.0");
    expect(added.version).toBe("0.4.0");
    expect(problems(grade(added.ledger, WITH_NEW, "0.4.0"))).toEqual([]);
    const broken = freezeEntry(declare(AFTER_BREAK), AFTER_BREAK, "n", "0.4.0");
    expect(broken.ledger.entries[1].floor).toEqual([...AFTER_BREAK].sort());
    expect(problems(grade(broken.ledger, AFTER_BREAK, "0.4.0"))).toEqual([]);
  });

  it("refuses to freeze without a release version, or under one not above the last entry", () => {
    expect(() => freezeEntry(declare(WITH_NEW), WITH_NEW, "n")).toThrow(
      /needs the release version/,
    );
    expect(() =>
      freezeEntry(declare(WITH_NEW), WITH_NEW, "n", "0.1.0"),
    ).toThrow(/does not sort above 0\.1\.0/);
  });

  it("passes a code version past the latest entry, since a release moves the package whether or not its surface changed", () => {
    expect(problems(grade(released(), BASE, "0.3.0"))).toEqual([]);
  });

  it("fails a code version below the latest entry", () => {
    expect(problems(grade(released(), BASE, "0.0.9"))).toEqual([
      "CurrentVersionIsRecordedInTheLedger: the code is at 0.0.9, below the ledger's latest entry 0.1.0: the package version moves only through the release freeze",
    ]);
  });

  it("fails an entry that does not sort above the one before it", () => {
    const { ledger } = freezeEntry(declare(WITH_NEW), WITH_NEW, "n", "0.4.0");
    ledger.entries[1].version = "0.0.5";
    expect(problems(grade(ledger, WITH_NEW, "0.4.0"))).toContain(
      "EveryEntryDeclaresExactlyWhatItChanged: 0.0.5: does not sort above 0.1.0, and a release version only rises",
    );
  });

  it("has no version of its own to compute", () => {
    expect(() => nextVersion("0.1.0", true, "release")).toThrow(
      /given by the release/,
    );
  });
});
