import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAllKnownTopicIds,
  isTopicId,
  lookupUnit,
  unitsForTopic,
  unitsForType,
  useStream,
} from "@ksp-gonogo/sitrep-sdk";
import { renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import type { KosProcessorInfo } from "./__generated__/contract";
import { setupStreamFixture } from "./test/setupStreamFixture";
// Side-effect import: registers `kos.processors` into the SDK's runtime registry
// and feeds this Uplink's own generated unit/shape maps into BOTH halves of the
// relocated unit registry.
import { KOS_PROCESSORS_TOPIC } from "./topics";

// src -> client -> GonogoKosUplink
const UPLINK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The value of a `const string <name>` in KosChannels.cs, as the C# declares it. */
function csTopic(constName: string): string {
  const src = readFileSync(join(UPLINK_ROOT, "KosChannels.cs"), "utf8");
  const m = src.match(
    new RegExp(`const\\s+string\\s+${constName}\\s*=\\s*"([^"]+)"`),
  );
  if (!m) {
    throw new Error(`${constName} constant not found in KosChannels.cs`);
  }
  return m[1];
}

describe("kos.processors Topic (relocated out of Sitrep.Contract)", () => {
  it("registers the same string the C# Uplink declares", () => {
    expect(KOS_PROCESSORS_TOPIC).toBe(csTopic("ProcessorsTopic"));
  });

  // It used to be a static member of the SDK's own TOPIC_IDS, because
  // KosProcessorInfo lived in Sitrep.Contract and carried [SitrepTopic]. It is
  // now a runtime registration from this client, so this assertion is what
  // stands between the relocation and `isTopicId("kos.processors")` silently
  // going false for every consumer.
  it("is a known TopicId once this client's topics module has loaded", () => {
    expect(isTopicId(KOS_PROCESSORS_TOPIC)).toBe(true);
    expect(getAllKnownTopicIds()).toContain(KOS_PROCESSORS_TOPIC);
  });

  it("still carries its payload down the real stream pipeline", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KOS_PROCESSORS_TOPIC],
      pinnedUt: 1000,
    });

    // useStream, not useTelemetry: this is the hook KosTerminal itself reads
    // kos.processors through, and it is what this package's test host bridges.
    const { result } = renderHook(
      () => useStream<KosProcessorInfo[]>(KOS_PROCESSORS_TOPIC),
      { wrapper: fixture.Provider },
    );

    fixture.emit(
      KOS_PROCESSORS_TOPIC,
      [
        {
          coreId: 7,
          tag: "mainframe",
          hasBooted: true,
          bootFilePath: null,
          processorMode: "READY",
          partName: "Probe Core",
        },
      ] satisfies unknown as KosProcessorInfo[],
      { ut: 1000 },
    );

    await waitFor(() => {
      expect(result.current?.[0]?.coreId).toBe(7);
    });
    expect(result.current?.[0]?.tag).toBe("mainframe");
    expect(result.current?.[0]?.processorMode).toBe("READY");
  });
});

// ── The relocated unit registry: both halves, and what each actually carries ──────
//
// Every other relocated slice proves its registration by DECODING a frame and
// finding a Value where a bare number would otherwise be. This slice cannot, and
// the reason is not a gap in the test: there is nothing on `kos.processors` for a
// Value to be. All six of its declared units are non-quantity tokens, so
// `wrapTopicPayload` correctly wraps none of them, with or without the
// registration.
//
// Asserting a decode here would therefore pass identically with the
// registerTopicUnits loop DELETED, which is the definition of a vacuous test and
// exactly the trap this comment exists to keep the next reader out of. So these
// assert the REGISTRY, which is real public SDK surface (`unitOf` /
// `unitsForTopic` / `unitsForType`) and which the relocation genuinely did break
// until topics.ts restored it. Delete either loop in topics.ts and the matching
// test below goes red.
describe("registerTopicUnits: the Topic-keyed half", () => {
  it("restores unitsForTopic for the relocated Topic", () => {
    const units = unitsForTopic(KOS_PROCESSORS_TOPIC);

    // The six the C# declares, which came out of the SDK's own generated map
    // before the relocation and out of this Uplink's generated map after it.
    expect(units).toEqual({
      bootFilePath: "text",
      coreId: "id",
      hasBooted: "flag",
      partName: "text",
      processorMode: "text",
      tag: "text",
    });
  });

  // The other half of the honest accounting: WHY the decode above hands back
  // bare values rather than Values, tied to the rule instead of to luck. A token
  // the unit model has no dimension for is a non-quantity, and `wrapTopicPayload`
  // skips it on exactly that test.
  it("declares only non-quantity tokens, so nothing on this Topic hydrates", () => {
    for (const unit of Object.values(unitsForTopic(KOS_PROCESSORS_TOPIC))) {
      expect(
        lookupUnit(unit),
        `${unit} resolved to a dimension: this Topic would now hydrate, and this test's premise (and topics.ts's comment) needs updating`,
      ).toBeUndefined();
    }
  });
});

describe("registerTypeUnits: the type-keyed half", () => {
  // The one declared quantity in the whole eleven-type slice. Its type is
  // reached by no Topic's shape map, because `kos.compute.<id>.status` is a
  // dynamic channel name, so nothing decodes through it today, which was already
  // true while the type lived in core. The lookup is what the relocation broke
  // and what this restores.
  it("restores unitsForType for the slice's one real quantity", () => {
    expect(unitsForType("KosComputeStatus").lastGoodAt).toBe("s");
    expect(lookupUnit("s")).toBeDefined();
  });

  // Every type in the slice, not just the one with a quantity: a type-keyed
  // lookup that silently returned {} for the command args would be just as much
  // a regression, and this is the assertion that would catch a loop narrowed to
  // "only the interesting one".
  it("restores unitsForType for all eleven relocated types", () => {
    for (const typeName of [
      "KosProcessorInfo",
      "KosComputeStatus",
      "KosExecArgs",
      "KosReEnableArgs",
      "KosTerminalFrame",
      "KosTerminalOpenArgs",
      "KosKeystrokeArgs",
      "KosTerminalResizeArgs",
      "KosTerminalCloseArgs",
      "KosRunArgs",
      "KosRunResult",
    ]) {
      expect(
        Object.keys(unitsForType(typeName)).length,
        `${typeName} has no type-keyed unit entry`,
      ).toBeGreaterThan(0);
    }
  });
});
