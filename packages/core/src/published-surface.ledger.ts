import { diffShape, keyOf } from "./published-surface.scan";

/**
 * The ledger behind `styleguide-published-surface.test.ts`: the frozen floors
 * of a published type surface and every change declared since, in the shape of
 * the C# `ContractShapeGateTests` baseline.
 *
 * Entries are ascending. An entry that starts a new version line carries a
 * `floor` (every shape line at that moment); any other carries only the lines
 * it added. The frozen shape is the latest floor plus every later addition, so
 * a floor is never rewritten. Only the two most recent floors are kept; an older
 * entry keeps its version, note, breaks and additions.
 *
 * `pending` holds the changes declared since the last entry while
 * `versionMoves` is `at-release`: each key the computed diff reports, with a
 * note. The freeze turns it into an entry and moves the version.
 */

export type Versioning = "semver" | "zero-major";

export interface DeclaredChange {
  key: string;
  note: string;
}

export interface DeclaredAddition extends DeclaredChange {
  /** The shape lines the key adds, so the frozen shape can be rebuilt without a floor. */
  lines: string[];
}

export interface LedgerEntry {
  version: string;
  note: string;
  breaks: DeclaredChange[];
  additions: DeclaredAddition[];
  floor?: string[];
}

export interface Pending {
  breaks: DeclaredChange[];
  additions: DeclaredChange[];
}

export interface Ledger {
  typescript: string;
  versioning: Versioning;
  versionMoves: "at-release" | "every-change";
  entries: LedgerEntry[];
  pending: Pending;
}

const FLOORS_KEPT = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`${what} is not a list of strings`);
  }
  return value.map(String);
}

function changes(value: unknown, what: string): DeclaredChange[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not a list`);
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.key !== "string" ||
      typeof item.note !== "string"
    ) {
      throw new Error(`${what} holds an item with no key and note`);
    }
    return { key: item.key, note: item.note };
  });
}

function additions(value: unknown, what: string): DeclaredAddition[] {
  const declared = changes(value, what);
  return declared.map((change, i) => {
    const raw = Array.isArray(value) ? value[i] : null;
    return {
      ...change,
      lines: strings(isRecord(raw) ? raw.lines : null, `${what}[${i}].lines`),
    };
  });
}

/** Reads a ledger file's JSON, refusing a shape the rules cannot grade. */
export function parseLedger(text: string): Ledger {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error("the ledger is not an object");
  const { typescript, versioning, versionMoves, entries, pending } = raw;
  if (typeof typescript !== "string") throw new Error("no typescript version");
  if (versioning !== "semver" && versioning !== "zero-major") {
    throw new Error(`unknown versioning ${String(versioning)}`);
  }
  if (versionMoves !== "at-release" && versionMoves !== "every-change") {
    throw new Error(`unknown versionMoves ${String(versionMoves)}`);
  }
  if (!Array.isArray(entries)) throw new Error("entries is not a list");
  if (!isRecord(pending)) throw new Error("pending is not an object");
  return {
    typescript,
    versioning,
    versionMoves,
    entries: entries.map((entry, i) => {
      if (
        !isRecord(entry) ||
        typeof entry.version !== "string" ||
        typeof entry.note !== "string"
      ) {
        throw new Error(`entries[${i}] has no version and note`);
      }
      return {
        version: entry.version,
        note: entry.note,
        breaks: changes(entry.breaks, `entries[${i}].breaks`),
        additions: additions(entry.additions, `entries[${i}].additions`),
        ...(entry.floor === undefined
          ? {}
          : { floor: strings(entry.floor, `entries[${i}].floor`) }),
      };
    }),
    pending: {
      breaks: changes(pending.breaks, "pending.breaks"),
      additions: changes(pending.additions, "pending.additions"),
    },
  };
}

/** The ledger as the file holds it. `biome check --write` settles the final layout. */
export function ledgerJson(ledger: Ledger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

type Triple = [number, number, number];

function parseVersion(version: string): Triple | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** The version a change set moves a package to, by the ledger's versioning rule. */
export function nextVersion(
  previous: string,
  hasBreaks: boolean,
  versioning: Versioning,
): string {
  const parsed = parseVersion(previous);
  if (!parsed) throw new Error(`${previous} is not a version`);
  const [major, minor, patch] = parsed;
  if (versioning === "semver") {
    return hasBreaks ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
  }
  return hasBreaks
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
}

/** The shape lines frozen as of the entry at `upTo` (inclusive), or null when no floor is kept for it. */
export function frozenAt(ledger: Ledger, upTo: number): string[] | null {
  let start = -1;
  for (let i = upTo; i >= 0; i -= 1) {
    if (ledger.entries[i].floor) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const lines = new Set(ledger.entries[start].floor);
  for (let i = start + 1; i <= upTo; i += 1) {
    for (const added of ledger.entries[i].additions) {
      for (const line of added.lines) lines.add(line);
    }
  }
  return [...lines];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function setDiff(a: readonly string[], b: readonly string[]): string {
  const missing = a.filter((x) => !b.includes(x));
  const extra = b.filter((x) => !a.includes(x));
  return [
    missing.length > 0 ? `missing ${missing.join(", ")}` : "",
    extra.length > 0 ? `not in the diff ${extra.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export interface LedgerInputs {
  ledger: Ledger;
  /** The current shape lines of the packages this ledger covers. */
  current: readonly string[];
  /** The version the code carries: `EXTENSION_API_VERSION`, or the package's own. */
  version: string;
  /** The TypeScript the current shape was printed with. */
  typescript: string;
}

/** Each rule's problems, keyed by the rule's name. An empty list is a pass. */
export type RuleResults = Record<string, string[]>;

export const RULE_NAMES = [
  "EachVersionAppearsExactlyOnceInTheLedger",
  "CurrentVersionIsRecordedInTheLedger",
  "CurrentShapeIsAdditiveOverTheFrozenFloor",
  "PendingDeclaresExactlyTheComputedChange",
  "EveryEntryDeclaresExactlyWhatItChanged",
  "ShapeWasPrintedByTheLedgersTypeScript",
] as const;

/** Grades a current shape against a ledger, one list of problems per rule. */
export function gradeLedger({
  ledger,
  current,
  version,
  typescript,
}: LedgerInputs): RuleResults {
  const results: RuleResults = Object.fromEntries(
    RULE_NAMES.map((name) => [name, []]),
  );
  const { entries } = ledger;

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.version)) {
      results.EachVersionAppearsExactlyOnceInTheLedger.push(
        `${entry.version} appears twice`,
      );
    }
    seen.add(entry.version);
  }

  const last = entries[entries.length - 1];
  if (!last) {
    results.CurrentVersionIsRecordedInTheLedger.push("the ledger has no entry");
  }
  if (last && last.version !== version) {
    results.CurrentVersionIsRecordedInTheLedger.push(
      `the code is at ${version} and the ledger's latest entry is ${last.version}: a version moves through the freeze at release, never by hand`,
    );
  }

  if (ledger.typescript !== typescript) {
    results.ShapeWasPrintedByTheLedgersTypeScript.push(
      `the ledger was printed with TypeScript ${ledger.typescript} and ${typescript} is installed: re-print the floor (GONOGO_SURFACE_REPRINT)`,
    );
  }

  const frozen = last ? frozenAt(ledger, entries.length - 1) : null;
  if (frozen) {
    const { breaks, additions: added } = diffShape(frozen, current);
    const declared = ledger.pending;
    const pendingBreaks = declared.breaks.map((c) => c.key);
    const pendingAdds = declared.additions.map((c) => c.key);
    const problems = results.PendingDeclaresExactlyTheComputedChange;
    const gone = results.CurrentShapeIsAdditiveOverTheFrozenFloor;
    if (ledger.versionMoves === "every-change") {
      for (const key of breaks) {
        gone.push(
          `${key}: broken with no entry, a break needs a version that moves`,
        );
      }
      for (const key of added) {
        problems.push(
          `${key}: added with no entry, an addition needs a version that moves`,
        );
      }
      if (pendingBreaks.length + pendingAdds.length > 0) {
        problems.push(
          "pending must be empty while versionMoves is every-change",
        );
      }
    } else {
      for (const key of breaks) {
        if (!pendingBreaks.includes(key)) {
          gone.push(
            `${key}: removed, retyped or made harder to satisfy, and not declared as a break in pending`,
          );
        }
      }
      for (const key of added) {
        if (!pendingAdds.includes(key)) {
          problems.push(`${key}: added and not declared in pending`);
        }
      }
      for (const key of pendingBreaks.filter((k) => !breaks.includes(k))) {
        problems.push(
          `${key}: declared as a break and the shape does not break it`,
        );
      }
      for (const key of pendingAdds.filter((k) => !added.includes(k))) {
        problems.push(
          `${key}: declared as an addition and the shape does not add it`,
        );
      }
      for (const change of [...declared.breaks, ...declared.additions]) {
        if (change.note.trim() === "") {
          problems.push(`${change.key}: declared with no note`);
        }
      }
    }
  } else {
    results.CurrentShapeIsAdditiveOverTheFrozenFloor.push(
      "the ledger has no floor",
    );
  }

  const problems = results.EveryEntryDeclaresExactlyWhatItChanged;
  entries.forEach((entry, i) => {
    const before = i > 0 ? frozenAt(ledger, i - 1) : null;
    const hasBreaks = entry.breaks.length > 0;
    if (i > 0) {
      const expected = nextVersion(
        entries[i - 1].version,
        hasBreaks,
        ledger.versioning,
      );
      if (entry.version !== expected) {
        problems.push(
          `${entry.version}: ${hasBreaks ? "breaks" : "only adds"} after ${entries[i - 1].version}, so it must be ${expected}`,
        );
      }
      if (!hasBreaks && entry.additions.length === 0) {
        problems.push(
          `${entry.version}: records neither a break nor an addition`,
        );
      }
    }
    if (entry.floor && before) {
      const diff = diffShape(before, entry.floor);
      if (
        !sameSet(
          diff.breaks,
          entry.breaks.map((c) => c.key),
        )
      ) {
        problems.push(
          `${entry.version}: breaks differ from the computed diff (${setDiff(
            diff.breaks,
            entry.breaks.map((c) => c.key),
          )})`,
        );
      }
      if (
        !sameSet(
          diff.additions,
          entry.additions.map((c) => c.key),
        )
      ) {
        problems.push(
          `${entry.version}: additions differ from the computed diff (${setDiff(
            diff.additions,
            entry.additions.map((c) => c.key),
          )})`,
        );
      }
    }
    if (!entry.floor && before) {
      const have = new Set(before.map(keyOf));
      for (const added of entry.additions) {
        if (have.has(added.key)) {
          problems.push(
            `${entry.version}: ${added.key} is already in the floor`,
          );
        }
      }
    }
    if (!entry.floor && hasBreaks) {
      problems.push(`${entry.version}: records breaks and carries no floor`);
    }
    for (const change of [...entry.breaks, ...entry.additions]) {
      if (change.note.trim() === "") {
        problems.push(`${entry.version}: ${change.key} has no note`);
      }
    }
  });
  return results;
}

/** Refusals and edits the freeze utility makes, each a pure function of the ledger and the shape. */
export function declarePending(
  ledger: Ledger,
  current: readonly string[],
): Ledger {
  const frozen = frozenAt(ledger, ledger.entries.length - 1);
  if (!frozen) throw new Error("the ledger has no floor to declare against");
  const diff = diffShape(frozen, current);
  const keep = (list: DeclaredChange[], keys: string[]): DeclaredChange[] =>
    keys.map((key) => ({
      key,
      note: list.find((c) => c.key === key)?.note ?? "",
    }));
  return {
    ...ledger,
    pending: {
      breaks: keep(ledger.pending.breaks, diff.breaks),
      additions: keep(ledger.pending.additions, diff.additions),
    },
  };
}

/**
 * Turns the declared change into the next entry and clears `pending`. Refuses
 * when the declaration does not match the computed diff, when a note is empty,
 * or when there is nothing to freeze.
 */
export function freezeEntry(
  ledger: Ledger,
  current: readonly string[],
  note: string,
): { ledger: Ledger; version: string } {
  const last = ledger.entries[ledger.entries.length - 1];
  const frozen = last ? frozenAt(ledger, ledger.entries.length - 1) : null;
  if (!last || !frozen)
    throw new Error("the ledger has no floor: seed it first");
  const diff = diffShape(frozen, current);
  if (diff.breaks.length + diff.additions.length === 0) {
    throw new Error("nothing to freeze: the shape is the frozen floor");
  }
  const graded = gradeLedger({
    ledger,
    current,
    version: last.version,
    typescript: ledger.typescript,
  });
  const refusals = [
    ...graded.PendingDeclaresExactlyTheComputedChange,
    ...graded.CurrentShapeIsAdditiveOverTheFrozenFloor,
  ];
  if (refusals.length > 0) {
    throw new Error(
      `declare the change first (GONOGO_SURFACE_DECLARE), then write each note:\n${refusals.join("\n")}`,
    );
  }
  const version = nextVersion(
    last.version,
    diff.breaks.length > 0,
    ledger.versioning,
  );
  if (ledger.entries.some((e) => e.version === version)) {
    throw new Error(
      `${version} is already recorded and an entry is never rewritten`,
    );
  }
  const lineOf = (key: string) => current.filter((line) => keyOf(line) === key);
  const entry: LedgerEntry = {
    version,
    note,
    breaks: ledger.pending.breaks,
    additions: ledger.pending.additions.map((c) => ({
      ...c,
      lines: lineOf(c.key),
    })),
    ...(diff.breaks.length > 0 ? { floor: [...current].sort() } : {}),
  };
  const entries = [...ledger.entries, entry];
  let floors = 0;
  const pruned = [...entries].reverse().map((e) => {
    if (!e.floor) return e;
    floors += 1;
    if (floors <= FLOORS_KEPT) return e;
    const { floor: _dropped, ...rest } = e;
    return rest;
  });
  return {
    ledger: {
      ...ledger,
      entries: pruned.reverse(),
      pending: { breaks: [], additions: [] },
    },
    version,
  };
}

/** The first floor of a new ledger: the whole current shape at the version the code carries. */
export function seedLedger(
  current: readonly string[],
  version: string,
  typescript: string,
  versioning: Versioning,
  versionMoves: Ledger["versionMoves"],
): Ledger {
  return {
    typescript,
    versioning,
    versionMoves,
    entries: [
      {
        version,
        note: "The first recorded surface.",
        breaks: [],
        additions: [],
        floor: [...current].sort(),
      },
    ],
    pending: { breaks: [], additions: [] },
  };
}

/**
 * Re-prints the CURRENT floor under a new TypeScript. Sound only because the
 * gate already holds the floor to be reachable from the current tree: every
 * floor key still exists in it, so each can be printed afresh. Refuses when a
 * floor key has no line in the new print, which is a break and not a re-print.
 */
export function reprintFloor(
  ledger: Ledger,
  current: readonly string[],
  typescript: string,
): Ledger {
  const frozen = frozenAt(ledger, ledger.entries.length - 1);
  if (!frozen) throw new Error("the ledger has no floor to re-print");
  const currentKeys = new Set(current.map(keyOf));
  const missing = [...new Set(frozen.map(keyOf))].filter(
    (k) => !currentKeys.has(k),
  );
  if (missing.length > 0) {
    throw new Error(
      `cannot re-print: the tree no longer has ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` and ${missing.length - 10} more` : ""}; declare those as breaks first`,
    );
  }
  const floorIndex = lastFloorIndex(ledger);
  const floorKeys = new Set(
    (ledger.entries[floorIndex].floor ?? []).map(keyOf),
  );
  const entries = ledger.entries.map((entry, i) => {
    if (i < floorIndex) return entry;
    if (i === floorIndex) {
      return {
        ...entry,
        floor: current.filter((line) => floorKeys.has(keyOf(line))).sort(),
      };
    }
    return {
      ...entry,
      additions: entry.additions.map((added) => ({
        ...added,
        lines: current.filter((line) => keyOf(line) === added.key),
      })),
    };
  });
  return { ...ledger, typescript, entries };
}

function lastFloorIndex(ledger: Ledger): number {
  for (let i = ledger.entries.length - 1; i >= 0; i -= 1) {
    if (ledger.entries[i].floor) return i;
  }
  throw new Error("the ledger has no floor");
}
