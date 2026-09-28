import {
  observedValue,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import type { VesselOrbitPayload } from "@ksp-gonogo/sitrep-sdk/spine";
import { StubTransport, type WireOf } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry } from "../registry";
import { useTelemetry } from "./useTelemetry";

const ORBIT: WireOf<VesselOrbitPayload> = {
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

beforeEach(() => clearRegistry());

describe("useTelemetry: canonical TopicId read", () => {
  it("reads a Topic straight off the mounted TimelineStore, typed as TopicReading<TopicPayload<T>>", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    function Orbit() {
      const orbit = observedValue(useTelemetry("vessel.orbit"));
      // Compile-time proof: the canonical overload resolves to a `Reading` of the
      // Topic's payload, and `observedValue` narrows it back to the payload. A wrong
      // payload type here would fail `typecheck`.
      // `.magnitude`: `sma` is a declared length, so the decode hands the
      // widget a `Value`. The probe prints the number to keep the assertion
      // about the read path rather than about rendering.
      const sma: number | undefined = orbit?.sma.magnitude;
      return <div>sma:{sma === undefined ? NULL_DISPLAY : String(sma)}</div>;
    }

    // No carriedChannels prop: the canonical Topic read does not consult the migration-shim allowlist (it has no legacy fallback to protect).
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

    // Provider coalesces beginFrame() to the next animation frame, so the read resolves one frame after the emit rather than synchronously.
    await waitFor(() => expect(screen.getByText("sma:700000")).toBeTruthy());
  });

  it("answers `pending` when no TelemetryProvider is mounted", () => {
    // Not `undefined`: "there is no stream here" and "the stream has told us
    // nothing yet" are the same statement from a widget's point of view, and both
    // are the `pending` arm. A widget on a station with no host reads exactly what a
    // widget waiting for its first frame reads, which is the honest answer.
    const { result } = renderHook(() => useTelemetry("vessel.orbit"));
    expect(result.current).toEqual({
      state: "pending",
      reckoning: { status: "none" },
    });
  });
});
