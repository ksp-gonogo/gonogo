import { useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  renderHook,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { KERBALISM_CREW_TOPIC, KERBALISM_LIFESUPPORT_TOPIC } from "./topics";

/**
 * The three leaves that used to be spelled like a `Reading` currency member,
 * pinned as FIELD READINGS.
 *
 * This is the assertion the rename exists for, and it is why a doc comment
 * would not do. A topic reading is `TopicCurrency<P> & TopicFields<P>`, so a
 * payload field called `value` or `asOfUt` lands on the currency's own member
 * and the intersection collapses: the field cannot be reached through the
 * reading at all, and the currency answers in its place. Reaching each of these
 * THROUGH the reading is what the old spelling made impossible, so putting the
 * old name back turns these assertions red rather than leaving them green.
 */
describe("the renamed reserved leaves are reachable through the reading", () => {
  it("reads a life-support as-of time as the payload's own field", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBALISM_LIFESUPPORT_TOPIC],
    });
    const { result } = renderHook(
      () => useTelemetry(KERBALISM_LIFESUPPORT_TOPIC),
      { wrapper: fixture.Provider },
    );

    fixture.emit(KERBALISM_LIFESUPPORT_TOPIC, { asOfKerbalismUt: 1_234 });

    await waitFor(() => {
      expect(result.current.state).toBe("observed");
    });
    const payload =
      result.current.state === "observed" ? result.current.value : undefined;
    /*
     * The PAYLOAD's own instant, in its own unit, and distinct from the
     * reading's `asOfUt`, which belongs to the currency and is not a quantity
     * the payload declared.
     */
    expect(payload?.asOfKerbalismUt).toMatchObject({
      magnitude: 1_234,
      unit: "ut",
    });
  });

  it("reads a crew entry's rules-as-of time and a rule's problem", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: [KERBALISM_CREW_TOPIC],
    });
    const { result } = renderHook(() => useTelemetry(KERBALISM_CREW_TOPIC), {
      wrapper: fixture.Provider,
    });

    fixture.emit(KERBALISM_CREW_TOPIC, [
      {
        name: "Jebediah Kerman",
        trait: "Pilot",
        rulesAsOfKerbalismUt: 2_468,
        rules: [{ name: "radiation", problem: 12.5, fatalThreshold: 50 }],
      },
    ]);

    await waitFor(() => {
      expect(result.current.state).toBe("observed");
    });
    const crew =
      result.current.state === "observed" ? result.current.value : undefined;
    expect(crew?.[0]?.rulesAsOfKerbalismUt).toMatchObject({
      magnitude: 2_468,
      unit: "ut",
    });
    // Two levels down, and the one that cost a rename on a wire-visible type.
    expect(crew?.[0]?.rules?.[0]?.problem).toMatchObject({
      magnitude: 12.5,
      unit: "units",
    });
  });
});
