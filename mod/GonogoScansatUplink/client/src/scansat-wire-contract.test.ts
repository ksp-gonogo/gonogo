import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SITREP_CARRIED_TOPICS,
  DYNAMIC_CARRIED_TOPIC_PREFIXES,
  isTopicCarried,
  mapTopic,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import { SCAN_TYPE } from "./schema";

// Client-half round-trip for the SCANsat dynamic wire contract, against the REAL
// TimelineStore configured exactly as the live TelemetryProvider configures it
// (dynamic-namespace prefixes injected into both the store resolution and the
// carried set). This reproduced the full break red before the two client fixes
// (Bug B: 2-segment mis-parse; Bug A: literal-only carry gate); it is the client
// definition-of-done that both are in place and agree on the canonical wire string.

// The carried set as the provider folds it: the literal promotion list PLUS the
// dynamic-namespace prefixes.
const carried = new Set([
  ...DEFAULT_SITREP_CARRIED_TOPICS,
  ...DYNAMIC_CARRIED_TOPIC_PREFIXES,
]);

function liveStore(): TimelineStore {
  return new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    { dynamicWholeTopicPrefixes: DYNAMIC_CARRIED_TOPIC_PREFIXES },
  );
}

// mod/GonogoScansatUplink/client/src -> mod/GonogoScansatUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The numeric bit values C# publishes coverage/mask for (ScanChannels.ClientScanTypes). */
function csClientScanTypes(): number[] {
  const src = readFileSync(join(UPLINK_ROOT, "ScanChannels.cs"), "utf8");
  const block = src.match(/ClientScanTypes\s*=\s*new short\[\]\s*\{([^}]*)\}/s);
  if (!block) throw new Error("ClientScanTypes not found in ScanChannels.cs");
  return [...block[1].matchAll(/(\d+)\s*,/g)].map((m) => Number(m[1]));
}

describe("scansat wire contract: mod emits <-> client subscribes", () => {
  it("client SCAN_TYPE bit values are a superset of the C# ClientScanTypes", () => {
    const clientBits = new Set<number>(Object.values(SCAN_TYPE));
    for (const bit of csClientScanTypes()) {
      expect(clientBits.has(bit), `client SCAN_TYPE missing bit ${bit}`).toBe(
        true,
      );
    }
  });

  it("[Bug B] the store resolves a dynamic topic to ITS OWN wire topic (identity), not a 2-segment parent", () => {
    const store = liveStore();
    expect(
      store.resolveSubscriptionTopics("scansat.coverage.Kerbin.8"),
    ).toEqual(["scansat.coverage.Kerbin.8"]);
    expect(store.resolveSubscriptionTopics("scansat.height.Kerbin")).toEqual([
      "scansat.height.Kerbin",
    ]);
    // control: an ordinary field-subtopic is untouched — still its 2-seg parent
    expect(store.resolveSubscriptionTopics("vessel.orbit.sma")).toEqual([
      "vessel.orbit",
    ]);
  });

  it("[Bug A+B] the dynamic coverage/mask/height topics ROUTE TO THE STREAM", () => {
    const store = liveStore();
    const body = "Kerbin";
    for (const bit of csClientScanTypes()) {
      const coverage = mapTopic("data", `scansat.coverage.${body}.${bit}`);
      const mask = mapTopic("data", `scansat.mask.${body}.${bit}`);
      expect(coverage).toBe(`scansat.coverage.${body}.${bit}`);
      expect(
        isTopicCarried(store, carried, coverage as string),
        `scansat.coverage.${body}.${bit} must route to the stream`,
      ).toBe(true);
      expect(isTopicCarried(store, carried, mask as string)).toBe(true);
    }
    const height = mapTopic("data", `scansat.height.${body}`) as string;
    expect(isTopicCarried(store, carried, height)).toBe(true);
  });
});
