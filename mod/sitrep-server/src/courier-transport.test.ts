import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { Courier } from "./courier";
import { CourierTransport } from "./courier-transport";
import { StubNetwork } from "./stub-network";

// The cases that drive a real M2 `TelemetryClient` (from `@ksp-gonogo/sitrep-client`)
// over this transport live in
// `packages/sitrep-client/src/courier-transport.integration.test.ts` instead —
// sitrep-server must not depend on sitrep-client (see package.json). Only the
// pure, client-agnostic cases stay here.

describe("Courier.roundTripEta", () => {
  it("returns twice the one-way delay between vantage and node", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });

    expect(courier.roundTripEta("vessel", "KSC")).toBe(4);
  });
});

describe("CourierTransport.predictConfirmEta", () => {
  it("predicts clock.now() + the courier's round-trip ETA for this (node, vantage) pair", () => {
    const clock = new ManualClock(10);
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });

    expect(transport.predictConfirmEta()).toBe(14);
  });
});
