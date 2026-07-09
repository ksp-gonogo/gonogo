import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type VesselOrbitPayload,
} from "@gonogo/sitrep-client";
import { Quality } from "@gonogo/sitrep-sdk";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defineTopicManifest } from "./defineTopicManifest";

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
      const orbit = useTelemetry("vessel.orbit");
      const sma: number | undefined = orbit?.sma;
      return <div>sma:{sma === undefined ? "—" : String(sma)}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Orbit />
      </TelemetryProvider>,
    );

    expect(screen.getByText("sma:—")).toBeTruthy();

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
    expect(result.current).toBeUndefined();
  });
});
