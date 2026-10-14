import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { useTrackedVesselLink } from "./tracked-vessel-link";

function LinkProbe({ guid }: { guid: string }) {
  const reading = useTrackedVesselLink(guid);
  const link = reading.state === "observed" ? reading.value : undefined;
  const text = link
    ? `${link.oneWaySeconds ?? "none"}/${link.connected}`
    : "waiting";
  return <div>{`link:${text}`}</div>;
}

describe("useTrackedVesselLink", () => {
  it("reads bare oneWaySeconds + connected off the raw dynamic trackingStation.vessel.<guid>.link topic", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <LinkProbe guid="g1" />
      </TelemetryProvider>,
    );
    expect(screen.getByText("link:waiting")).toBeTruthy();

    // A dynamic topic: StubTransport (like production) can't unit-wrap it, so it arrives raw, oneWaySeconds is the bare number 4.5, not { magnitude: 4.5 }.
    act(() => {
      t.emit("trackingStation.vessel.g1.link", {
        oneWaySeconds: 4.5,
        connected: true,
      });
    });
    await waitFor(() => expect(screen.getByText("link:4.5/true")).toBeTruthy());
  });

  it("surfaces a no-path vessel (null delay, disconnected)", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <LinkProbe guid="g2" />
      </TelemetryProvider>,
    );
    act(() => {
      t.emit("trackingStation.vessel.g2.link", {
        oneWaySeconds: null,
        connected: false,
      });
    });
    await waitFor(() =>
      expect(screen.getByText("link:none/false")).toBeTruthy(),
    );
  });
});
