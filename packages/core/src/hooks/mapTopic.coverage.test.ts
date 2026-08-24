import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isKnownLegacyKeyGap, mapTopic } from "@ksp-gonogo/sitrep-client";
import { isTopicId } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { classifyRequirement } from "../declarations";

/**
 * Coverage gate for the M3 `mapTopic` migration table (M2 Task 7): every
 * legacy flat key a real widget actually asks for, via a declared
 * `dataRequirements` entry or a literal `useTelemetry("data", "<key>")` call,
 * must be either mapped to a new stream topic (`mapTopic("data", key)`) or
 * explicitly listed as a known gap (`isKnownLegacyKeyGap`). Anything
 * neither mapped nor gap-listed is a silent miss: a widget that gets
 * migrated onto the shim later would quietly regress to `undefined` forever
 * instead of falling back to its working legacy `DataSource` read.
 *
 * This test scans `packages/components/src` directly (rather than
 * hardcoding a key list) so a newly-added widget with an un-audited key
 * fails CI immediately, instead of silently slipping through until someone
 * notices the widget stopped updating after a future migration.
 */

const COMPONENTS_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "components",
  "src",
);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry)) continue;
    if (entry.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

/**
 * Extracts every double-quoted string literal inside the array that follows
 * `dataRequirements:` in `source`, starting the scan at `fromIndex`.
 *
 * A plain non-greedy regex (`\[(.*?)\]`) breaks here because several
 * `dataRequirements` entries are themselves bracketed, parametric legacy
 * keys (e.g. `"r.resource[LiquidFuel]"`): the FIRST `]` a naive regex finds
 * is inside one of those string literals, not the end of the array. This
 * walks the array as a tiny state machine (string-literal aware) so an `]`
 * inside a quoted key doesn't end the scan early.
 */
function extractDataRequirementsArray(
  source: string,
  fromIndex: number,
): string[] {
  const openBracket = source.indexOf("[", fromIndex);
  if (openBracket === -1) return [];

  const keys: string[] = [];
  let inString = false;
  let current = "";
  for (let i = openBracket + 1; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '"') {
        keys.push(current);
        current = "";
        inString = false;
      } else if (ch === "\\") {
        i++; // skip escaped char
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "]") break; // end of the (flat, non-nested) array
  }
  return keys;
}

function collectWidgetLegacyKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of listSourceFiles(COMPONENTS_SRC)) {
    const source = readFileSync(file, "utf-8");

    for (const match of source.matchAll(/dataRequirements:\s*\[/g)) {
      for (const key of extractDataRequirementsArray(
        source,
        match.index ?? 0,
      )) {
        keys.add(key);
      }
    }

    for (const match of source.matchAll(
      /useTelemetry\(\s*"data"\s*,\s*"([^"]+)"/g,
    )) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * ---------------------------------------------------------------------------
 * THE DYNAMIC-KEY BLIND SPOT IS CLOSED, this scan is now complete
 * ---------------------------------------------------------------------------
 * There used to be a `collectDynamicLegacyKeys()` here, and a documented
 * hole it patched: `ActionGroup` resolved its read key dynamically
 * (`useTelemetry("data", group?.value ?? "v.sasValue")`) off `@ksp-gonogo/core`'s
 * hardcoded `ACTION_GROUPS` registry, with an empty `dataRequirements: []`. The
 * regex scan above only sees LITERAL `useTelemetry("data", "<key>")` strings, so
 * `v.sasValue`/`v.ag1Value`/… were invisible to it and had to be re-derived from
 * the registry by hand.
 *
 * That widget no longer reads any legacy key at all: it reads the canonical
 * `vessel.control` / `vessel.structure` Topics one-arg and resolves each group's
 * value from the payload, so there is no dynamic key left to collect. The
 * registry itself stopped carrying read keys entirely (`ActionGroup` in
 * `types.ts` lost its `value:` field), which is what made the hole structurally
 * impossible rather than merely patched.
 *
 * If a component ever again resolves a `useDataValue` key from a runtime
 * registry, this scan goes blind to it and the hole comes back; prefer a
 * canonical `useTelemetry(topicId)` read, and if that's genuinely impossible,
 * reinstate a collector here rather than letting the key go unpoliced.
 */

describe("mapTopic coverage: every widget legacy key is mapped or a declared gap", () => {
  // A `dataRequirements` entry can now ALSO be a native SDK topic id read
  // canonically (`useTelemetry(topicId)`, bypassing `mapTopic` entirely:
  // `ShipMap`/`PowerSystems`'s `"vessel.parts"`, the `useTopology` un-gap),
  // or a DERIVED channel a widget reads wholesale (`useStream("vessel.state")`,
  // which is not an `isTopicId` because nothing on the wire publishes it).
  // Those aren't old legacy keys at all, so this scan, built to police
  // the legacy-key migration table specifically: excludes them rather than
  // asking `mapTopic`/`isKnownLegacyKeyGap` to account for a key that was
  // never theirs to route. `classifyRequirement` owns the full set of legal
  // declaration forms; this test only cares which of them are legacy keys.
  const scanned = collectWidgetLegacyKeys();
  const widgetKeys = new Set(
    [...scanned].filter(
      (key) =>
        !isTopicId(key) &&
        classifyRequirement(key) !== "derived-channel" &&
        classifyRequirement(key) !== "field-path",
    ),
  );

  it("found a non-trivial number of widget keys (scan sanity check)", () => {
    // Guards against the scan silently finding nothing (e.g. a moved
    // packages/components/src) and the coverage assertion below vacuously
    // passing over an empty set.
    //
    // Counts EVERYTHING the scan found, not the legacy subset. The subset
    // shrinks with every slice of the vocabulary migration and is meant to
    // reach zero, so a floor under it would fail on success and say nothing
    // about whether the scan worked. What this needs to know is that the scan
    // is still reading a real directory full of declarations.
    expect(scanned.size).toBeGreaterThan(100);
  });

  it("maps or explicitly gaps every widget-declared legacy key, no silent misses", () => {
    const unaccounted = [...widgetKeys]
      .filter(
        (key) =>
          mapTopic("data", key) === undefined &&
          !isKnownLegacyKeyGap("data", key),
      )
      .sort();

    expect(unaccounted).toEqual([]);
  });

  it("mapped keys and known gaps are mutually exclusive for every widget key", () => {
    const bothMappedAndGapped = [...widgetKeys].filter(
      (key) =>
        mapTopic("data", key) !== undefined && isKnownLegacyKeyGap("data", key),
    );

    expect(bothMappedAndGapped).toEqual([]);
  });
});
