import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TELEMACHUS_CLEAN_HOMES } from "./map-topic";

/**
 * Fixture hardening: the deeper half of
 * `map-topic.rawFieldRoots.coverage.test.ts`'s guarantee. That test only
 * checks that a raw-field target's `<domain>.<channel>` ROOT names a real
 * published topic — it does NOT walk the rest of the dotted path against a
 * real payload, so it could never have caught the
 * `vessel.resources` bug (a correct root, wrong field PATH one layer
 * deeper — see `map-topic.ts`'s doc comment on the resource regex) or any
 * of its siblings hiding in a channel the old 6-topic reference wire
 * fixture never carried.
 *
 * This test is that missing check: for every `TELEMACHUS_CLEAN_HOMES`
 * target of the raw-field form (`<domain>.<channel>.<field...>`), it takes
 * a REAL captured payload for `<domain>.<channel>` from the grown
 * 15-channel `reference-wire-fixture.json`
 * (`mod/Sitrep.Host.IntegrationTests/WireFixtureGeneratorTests.cs`) and
 * walks `<field...>` into it — same mechanical split
 * `TimelineStore.resolveRawFieldSubtopic`/`sampleRawFieldSubtopic`
 * (`timeline-store.ts`) uses at runtime. A path that doesn't resolve
 * against a real payload is exactly the class of dead mapping this guards
 * against; a migrated widget hitting one would silently render a
 * permanent `undefined` instead of falling back to its working legacy
 * `DataSource` read.
 *
 * Skip-cleanly contract, same as `reference-wire-fixture.test.ts` and the C#
 * generator: the fixture is gitignored/local-only (`local_docs/` is
 * blanket-ignored). Regenerate via `dotnet test --filter
 * WireFixtureGeneratorTests` in `mod/`.
 *
 * This guard is a LOCAL/manual regression tool, not a CI gate — and it can't
 * be otherwise. The base `reference-wire-fixture.json` is replayed from a
 * ~7.5 MB real capture (`reference-session-2026-07-07.json`) that is itself
 * gitignored/local-only; there is no committable, CI-reproducible input that
 * produces the full 15-channel fixture (the self-contained synthetic
 * fixtures cover only the career/deployed-science channels, not the rest).
 * So wherever the fixture is absent — dev machine OR CI — this suite skips.
 * An earlier version tried to fail loudly in CI on a missing fixture, but
 * that just reddened CI permanently: the input recording can never live
 * there. Run it locally after regenerating the fixture to exercise the guard.
 */

interface WireFixture {
  subscribedTopics: string[];
  frames: string[];
}

interface ParsedFrame {
  type: string;
  topic?: string;
  payload?: unknown;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const recordingsDir = path.join(
  currentDir,
  "../../../local_docs/telemetry-mod/recordings",
);
const fixturePath = path.join(recordingsDir, "reference-wire-fixture.json");
const fixtureExists = existsSync(fixturePath);

/**
 * All per-domain reference wire fixtures (`reference-wire-fixture*.json`) —
 * the base 15-channel one plus the per-domain captures
 * (`-dock`/`-maneuver`/`-comms`/`-career`,
 * `WireFixtureGeneratorTests.cs`). A raw-field target's channel may only be
 * captured in a per-domain fixture (e.g. `vessel.dock.*` lives ONLY in
 * `reference-wire-fixture-dock.json`, since `vessel.dock` is null in the base
 * capture's non-docking flight); merging their sample payloads lets this test
 * validate every CLEAN_HOMES raw-field entry against SOME real captured
 * payload, wherever it was recorded.
 */
function listWireFixturePaths(): string[] {
  if (!existsSync(recordingsDir)) return [];
  return readdirSync(recordingsDir)
    .filter(
      (name) =>
        name.startsWith("reference-wire-fixture") && name.endsWith(".json"),
    )
    .map((name) => path.join(recordingsDir, name));
}

/** Derived-channel roots (`vessel.state.*`) are out of this raw-field convention's scope — mirrors `map-topic.rawFieldRoots.coverage.test.ts`'s own carve-out. */
const DERIVED_CHANNEL_ROOTS: ReadonlySet<string> = new Set(["vessel.state"]);

function firstTwoSegments(topic: string): string {
  return topic.split(".").slice(0, 2).join(".");
}

function isRawFieldForm(target: string): boolean {
  return (
    target.split(".").length >= 3 &&
    !DERIVED_CHANNEL_ROOTS.has(firstTwoSegments(target))
  );
}

/** Walks `fieldPath` into `payload`, mirroring `sampleRawFieldSubtopic`'s own walk exactly — a missing key at any level is unresolved. */
function resolvesFieldPath(payload: unknown, fieldPath: string[]): boolean {
  let cursor = payload;
  for (const segment of fieldPath) {
    if (cursor === null || typeof cursor !== "object") return false;
    if (!(segment in (cursor as Record<string, unknown>))) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return true;
}

describe.skipIf(!fixtureExists)(
  "mapTopic raw-field paths resolve against the real grown reference wire fixture",
  () => {
    if (!fixtureExists) {
      it("SKIPPED: reference-wire-fixture.json not found (gitignored, local-only — regenerate via `dotnet test --filter WireFixtureGeneratorTests` in `mod/`; see this file's doc comment for why this is local-only, never a CI gate)", () => {});
      return;
    }

    // One representative non-null payload per raw topic, merged across every
    // per-domain fixture (the first one seen in arrival order per topic is
    // enough; this test only cares whether the FIELD PATH exists on a genuine
    // record shape, not about any particular value).
    const samplePayloadByTopic = new Map<string, Record<string, unknown>>();
    for (const fixtureFile of listWireFixturePaths()) {
      const fixture: WireFixture = JSON.parse(
        readFileSync(fixtureFile, "utf-8"),
      );
      for (const raw of fixture.frames) {
        const frame = JSON.parse(raw) as ParsedFrame;
        if (frame.type !== "stream-data" || !frame.topic) continue;
        if (samplePayloadByTopic.has(frame.topic)) continue;
        if (frame.payload === null || typeof frame.payload !== "object") {
          continue; // tombstone/absent — not a shape sample
        }
        samplePayloadByTopic.set(
          frame.topic,
          frame.payload as Record<string, unknown>,
        );
      }
    }

    const rawFieldEntries = Object.entries(TELEMACHUS_CLEAN_HOMES).filter(
      ([, target]) => isRawFieldForm(target),
    );

    it("sanity: found a non-trivial number of raw-field-form CLEAN_HOMES entries", () => {
      expect(rawFieldEntries.length).toBeGreaterThan(10);
    });

    it("sanity: captured a non-null sample payload for every raw topic a CLEAN_HOMES raw-field entry points at", () => {
      const missingSamples = [
        ...new Set(
          rawFieldEntries.map(([, target]) => firstTwoSegments(target)),
        ),
      ].filter((root) => !samplePayloadByTopic.has(root));
      expect(missingSamples).toEqual([]);
    });

    it("every raw-field CLEAN_HOMES target's field path resolves against a real captured payload", () => {
      const unresolved = rawFieldEntries
        .map(([key, target]) => {
          const root = firstTwoSegments(target);
          const fieldPath = target.split(".").slice(2);
          const sample = samplePayloadByTopic.get(root);
          return {
            key,
            target,
            resolved: !!sample && resolvesFieldPath(sample, fieldPath),
          };
        })
        .filter(({ resolved }) => !resolved)
        .map(({ key, target }) => `"${key}" -> "${target}"`);

      expect(unresolved).toEqual([]);
    });

    // The parametric `r.resource[X]`/`r.resourceMax[X]` family isn't a
    // static CLEAN_HOMES entry (mapTopic generates its target via regex —
    // see RESOURCE_VESSEL_TOTAL in map-topic.ts) but resolves through the
    // exact same raw-field mechanism, and is the concrete bug
    // this whole test family exists to prevent a recurrence of. Proven
    // directly against a real resource name captured in the fixture.
    it("the r.resource[X] parametric mapping resolves against a real vessel.resources payload", async () => {
      const { mapTopic } = await import("./map-topic");
      const target = mapTopic("data", "r.resource[LiquidFuel]");
      expect(target).toBe("vessel.resources.resources.LiquidFuel.current");

      const sample = samplePayloadByTopic.get("vessel.resources");
      expect(sample).toBeDefined();
      const fieldPath = target?.split(".").slice(2) ?? [];
      expect(resolvesFieldPath(sample, fieldPath)).toBe(true);
    });
  },
);
