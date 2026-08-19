import {
  type Reading,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type VesselOrbitPayload,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { defineTopicManifest } from "./defineTopicManifest";

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

const ORBIT: VesselOrbitPayload = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12,
};

describe("defineTopicManifest", () => {
  it("returns the declared arrays verbatim for registerComponent", () => {
    const { channels, optionalChannels } = defineTopicManifest({
      channels: ["vessel.resources", "vessel.orbit"],
      optionalChannels: ["comms.delay"],
    });
    expect(channels).toEqual(["vessel.resources", "vessel.orbit"]);
    expect(optionalChannels).toEqual(["comms.delay"]);
  });

  it("defaults optionalChannels to an empty array when omitted", () => {
    const { optionalChannels } = defineTopicManifest({
      channels: ["vessel.resources"],
    });
    expect(optionalChannels).toEqual([]);
  });

  it("bound hook reads a required Topic straight off the mounted TimelineStore", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const { useTelemetry } = defineTopicManifest({
      channels: ["vessel.orbit"],
    });

    function Orbit() {
      // The bound hook answers with a `Reading` too, so a manifest read confronts
      // currency exactly as a direct one does. That was the point of correcting
      // `WidgetTopicValue`: it promised a payload while the hook it wraps returned a
      // `Reading`, and the `as unknown as` cast in the factory meant nothing checked.
      const orbit = judgeable(useTelemetry("vessel.orbit"));
      // `.magnitude`: `sma` is a declared length, so the decode hands the
      // widget a `Value`. The probe prints the number to keep the assertion
      // about the read path rather than about rendering.
      const sma: number | undefined = orbit?.sma.magnitude;
      return <div>sma:{sma === undefined ? NULL_DISPLAY : String(sma)}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Orbit />
      </TelemetryProvider>,
    );

    expect(screen.getByText(`sma:${NULL_DISPLAY}`)).toBeTruthy();

    act(() => {
      transport.emit("vessel.orbit", ORBIT, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
    });

    await waitFor(() => expect(screen.getByText("sma:700000")).toBeTruthy());
  });

  it("bound hook returns undefined when no TelemetryProvider is mounted", () => {
    const { useTelemetry } = defineTopicManifest({
      channels: ["vessel.orbit"],
      optionalChannels: ["comms.delay"],
    });
    const { result } = renderHook(() => useTelemetry("comms.delay"));
    // `pending`, not `undefined`: the bound hook answers with a `Reading` like every
    // other read, and "no provider" is the same statement as "nothing has arrived".
    expect(result.current).toEqual({ state: "pending" });
  });
});
