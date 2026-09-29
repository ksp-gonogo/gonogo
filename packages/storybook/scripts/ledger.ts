/**
 * The review ledger: which review-sheet items the operator approved, and the
 * fingerprint each had when they did. An approval holds only while the item's
 * fingerprint is still the one it was approved at.
 *
 * The ledger is a local file outside the repo, never committed: `--ledger
 * <path>`, else `GONOGO_REVIEW_LEDGER`, else {@link DEFAULT_LEDGER}. A missing
 * file is an empty ledger, under which nothing is approved.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { TargetKind } from "./generate-stories";

export const DEFAULT_LEDGER = join(
  homedir(),
  "personal/claude-store/gonogo/local_docs/review-ledger.json",
);

export interface Entry {
  approved: boolean;
  /** The item's fingerprint in the tree the operator reviewed, or `null` when that tree could not give one. */
  fingerprint: string | null;
  /** When the sheet the decision was made on was generated, which decides the later of two exports. */
  date: string;
}

/** Entries by {@link ledgerKey}. */
export type Ledger = Record<string, Entry>;

/** How an item stands against the ledger: approved still, approved at a fingerprint it no longer has, or never approved. */
export type Standing = "approved" | "changed" | "unapproved";

export function ledgerKey(kind: TargetKind, id: string): string {
  return `${kind}:${id}`;
}

export function standing(
  entry: Entry | undefined,
  fingerprint: string,
): Standing {
  if (!entry?.approved) return "unapproved";
  return entry.fingerprint === fingerprint ? "approved" : "changed";
}

/** The ledger path a command was given, resolving a relative one against where it was run from. */
export function ledgerPath(argv: string[]): string {
  const i = argv.indexOf("--ledger");
  const given = i === -1 ? process.env.GONOGO_REVIEW_LEDGER : argv[i + 1];
  if (i !== -1 && (!given || given.startsWith("--"))) {
    throw new Error("--ledger needs a value");
  }
  if (!given) return DEFAULT_LEDGER;
  return resolve(process.env.INIT_CWD ?? process.cwd(), given);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function readLedger(file: string): Ledger {
  if (!existsSync(file)) return {};
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(raw)) throw new Error(`${file} is not an object`);
  const out: Ledger = {};
  for (const [key, v] of Object.entries(raw)) {
    if (
      !isRecord(v) ||
      typeof v.approved !== "boolean" ||
      (typeof v.fingerprint !== "string" && v.fingerprint !== null) ||
      typeof v.date !== "string"
    ) {
      throw new Error(
        `${file} entry ${key} is not { approved, fingerprint, date }`,
      );
    }
    out[key] = {
      approved: v.approved,
      fingerprint: v.fingerprint,
      date: v.date,
    };
  }
  return out;
}

export function writeLedger(ledger: Ledger, file: string): void {
  const sorted = Object.fromEntries(
    Object.keys(ledger)
      .sort()
      .map((key) => [key, ledger[key]]),
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

export interface ExportItem {
  kind: TargetKind;
  id: string;
  approved: boolean;
  /** Absent from an export written before the sheet carried fingerprints. */
  fingerprint?: string;
}

/** A review-sheet export, as its Export JSON button writes it. */
export interface SheetExport {
  generatedAt: string;
  sourceSha: string;
  items: ExportItem[];
}

const KINDS: readonly string[] = ["widget", "extension", "primitive"];

export function readExport(file: string): SheetExport {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    !isRecord(raw) ||
    typeof raw.generatedAt !== "string" ||
    typeof raw.sourceSha !== "string" ||
    !Array.isArray(raw.items)
  ) {
    throw new Error(`${file} is not a review-sheet export`);
  }
  const items = raw.items.map((item, i): ExportItem => {
    if (
      !isRecord(item) ||
      typeof item.kind !== "string" ||
      !KINDS.includes(item.kind) ||
      typeof item.id !== "string" ||
      typeof item.approved !== "boolean" ||
      (item.fingerprint !== undefined && typeof item.fingerprint !== "string")
    ) {
      throw new Error(`${file} item ${i} is malformed`);
    }
    return {
      kind: item.kind as TargetKind,
      id: item.id,
      approved: item.approved,
      fingerprint: item.fingerprint,
    };
  });
  return { generatedAt: raw.generatedAt, sourceSha: raw.sourceSha, items };
}

export interface Folded {
  written: number;
  /** Items the ledger already holds from a later export, left as they were. */
  older: number;
}

/**
 * Folds an export into the ledger, the later export winning per item. An
 * export item without a fingerprint takes the one `fingerprintOf` gives it.
 */
export function fold(
  ledger: Ledger,
  sheet: SheetExport,
  fingerprintOf: (item: ExportItem) => string | null,
): Folded {
  let written = 0;
  let older = 0;
  for (const item of sheet.items) {
    const key = ledgerKey(item.kind, item.id);
    const held = ledger[key];
    if (held && held.date > sheet.generatedAt) {
      older++;
      continue;
    }
    ledger[key] = {
      approved: item.approved,
      fingerprint: item.fingerprint ?? fingerprintOf(item),
      date: sheet.generatedAt,
    };
    written++;
  }
  return { written, older };
}
