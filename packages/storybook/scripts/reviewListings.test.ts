import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Fingerprinter } from "./fingerprint";
import type { TargetKind } from "./generate-stories";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const TARGETS = resolve(HERE, "../dist/stories/review-targets.json");

const targets: Record<TargetKind, Record<string, string[]>> = JSON.parse(
  readFileSync(TARGETS, "utf8"),
);

const fingerprinter = new Fingerprinter(REPO);

/**
 * The review sheet refuses to write when a listing has no story or no source
 * it can fingerprint. These are the same two checks on the generator's own
 * output, so a new widget, extension or ui-kit export without a story fails
 * here and not on the operator's next review pass.
 */
it.each([
  "extension",
  "primitive",
] as const)("every %s has a story and a source to fingerprint", (kind) => {
  const faults: string[] = [];
  for (const [id, stories] of Object.entries(targets[kind])) {
    const print = fingerprinter.fingerprint({ kind, id, stories });
    if ("fault" in print) faults.push(print.fault);
  }
  expect(faults).toEqual([]);
}, 120_000);

/* A widget target is also keyed by the name of a hand-written story group that is no registered widget id, so only its stories can be held to the sheet's rule here. */
it("every widget has a story", () => {
  const without = Object.entries(targets.widget)
    .filter(([, stories]) => stories.length === 0)
    .map(([id]) => id);
  expect(without).toEqual([]);
});

it("lists the ui-kit exports the generator found, so the check above is not reading an empty file", () => {
  expect(Object.keys(targets.primitive).length).toBeGreaterThan(50);
  expect(Object.keys(targets.extension).length).toBeGreaterThan(20);
  expect(Object.keys(targets.widget).length).toBeGreaterThan(20);
});
