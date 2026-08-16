import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import {
  getLatestFleetVesselSilence,
  useFleetVesselSilence,
} from "./fleet-contact";
import { StubTransport } from "./stub-transport";

function SilenceProbe({ guid }: { guid: string }) {
  useFleetVesselSilence(guid);
  return null;
}

describe("useFleetVesselSilence's per-vessel bridge", () => {
  it("mirrors a live silence frame into getLatestFleetVesselSilence, keyed by vessel id", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <SilenceProbe guid="bridge-v1" />
      </TelemetryProvider>,
    );
    expect(getLatestFleetVesselSilence("bridge-v1")).toBeUndefined();

    act(() => {
      t.emit("silence.bridge-v1.state", {
        state: "Silent",
        silenceSinceUt: 10,
        deadlineUt: 40,
        deadlineBasis: "orbital-period",
        predictedReacquisitionUt: null,
      });
    });

    await waitFor(() =>
      expect(getLatestFleetVesselSilence("bridge-v1")?.state).toBe("Silent"),
    );
  });

  it("clears the bridge entry once the hook unmounts", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    const { unmount } = render(
      <TelemetryProvider client={client}>
        <SilenceProbe guid="bridge-v2" />
      </TelemetryProvider>,
    );
    act(() => {
      t.emit("silence.bridge-v2.state", { state: "Lost" });
    });
    await waitFor(() =>
      expect(getLatestFleetVesselSilence("bridge-v2")?.state).toBe("Lost"),
    );

    unmount();
    expect(getLatestFleetVesselSilence("bridge-v2")).toBeUndefined();
  });
});
