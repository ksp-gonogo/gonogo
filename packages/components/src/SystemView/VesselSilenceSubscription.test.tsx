import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { render, StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { VesselSilenceSubscription } from "./VesselSilenceSubscription";

function mount(guid: string) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  render(
    <TelemetryProvider client={client}>
      <VesselSilenceSubscription guid={guid} />
    </TelemetryProvider>,
  );
  return transport;
}

describe("VesselSilenceSubscription", () => {
  it("subscribes the vessel's silence topic", () => {
    expect(mount("v1").isSubscribed("silence.v1.state")).toBe(true);
  });
});
