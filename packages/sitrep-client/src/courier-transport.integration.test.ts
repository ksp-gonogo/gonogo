import {
  Courier,
  CourierTransport,
  ManualClock,
  StubNetwork,
} from "@gonogo/sitrep-server";
import { describe, expect, it } from "vitest";
import { LOSS_MARGIN, TelemetryClient } from "./client";

// These cases drive a real M2 `TelemetryClient` over the M3 delay-modelling
// server stack (`Courier` + `CourierTransport` + `StubNetwork`, all from
// `@gonogo/sitrep-server`). They live here — not in sitrep-server's own
// `courier-transport.test.ts` — because sitrep-server must not depend on
// sitrep-client: the natural DAG is `sitrep-sdk <- sitrep-server <-
// sitrep-client`, and this package already has a test-only devDependency on
// sitrep-server (see package.json) to support exactly this kind of
// integration proof.

describe("CourierTransport", () => {
  it("delivers a delayed stream sample to a real M2 TelemetryClient only after the delay elapses", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport);

    const received: unknown[] = [];
    client.subscribe("alt", (value) => received.push(value));

    courier.record("vessel", "alt", 100, 0);

    // Not delivered before the delay elapses.
    clock.advanceTo(1);
    expect(received).toHaveLength(0);

    // Delivered exactly when UT reaches validAt + delay, through the
    // unchanged M2 client's subscribe callback.
    clock.advanceTo(2);
    expect(received).toEqual([100]);
    expect(client.getValue("alt")).toBe(100);
  });

  it("resolves a dispatched command to confirmed after the full uplink+downlink round trip", async () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    courier.setCommandHandler((command) => ({ ok: command }));
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("deploy");
    // etaConfirm comes from the transport's predictConfirmEta (dispatch UT
    // 0 + roundTripEta 4). The client shares the same ManualClock as the
    // courier/transport so its loss timer lives in the same UT domain as
    // predictConfirmEta — required per the domain note on `Clock` (see
    // packages/sitrep-client/src/clock.ts). This test never lets that timer
    // fire — the confirmation below cancels it first, deterministically
    // (advanceTo(4) is still short of the loss deadline at 4 + LOSS_MARGIN).
    expect(client.getCommand(requestId)).toEqual({
      phase: "in-flight",
      requestId,
      etaConfirm: 4,
    });

    // Uplink elapsed (executes on the node) but confirmation still in
    // flight downlink — the client must still see in-flight.
    clock.advanceTo(2);
    expect(client.getCommand(requestId)).toEqual({
      phase: "in-flight",
      requestId,
      etaConfirm: 4,
    });

    // Downlink elapsed: confirmation arrives back at the vantage, through
    // the unchanged M2 client's dispatch() promise.
    clock.advanceTo(4);
    await expect(result).resolves.toEqual({ ok: "deploy" });
    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy" },
    });
  });

  it("does not deliver anything through the client once unsubscribed", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport);

    const received: unknown[] = [];
    const off = client.subscribe("alt", (value) => received.push(value));

    courier.record("vessel", "alt", 100, 0);
    off();

    clock.advanceTo(2);
    expect(received).toHaveLength(0);
  });
});

describe("CourierTransport + TelemetryClient client-side loss inference (Task 8)", () => {
  it("infers lost and rejects on honest silence when the node is unreachable", async () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    network.setReachable("KSC", "vessel", false);
    const courier = new Courier({ clock, network });
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("deploy");
    expect(client.getCommand(requestId)).toEqual({
      phase: "in-flight",
      requestId,
      etaConfirm: 4,
    });

    clock.advanceTo(4 + LOSS_MARGIN);

    await expect(result).rejects.toMatchObject({ code: "E_LOST" });
    expect(client.getCommand(requestId)).toEqual({
      phase: "lost",
      requestId,
      reason: "signal-lost",
    });
  });

  it("a reachable command confirms before the predicted deadline, cancelling the loss timer for good", async () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    courier.setCommandHandler((command) => ({ ok: command }));
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport, clock);

    const { requestId, result } = client.dispatch("deploy");
    clock.advanceTo(4);
    await expect(result).resolves.toEqual({ ok: "deploy" });
    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy" },
    });

    // Well past the would-be loss deadline: confirming must have cancelled
    // the loss timer, so this never flips to lost.
    clock.advanceTo(4 + LOSS_MARGIN + 10);
    expect(client.getCommand(requestId)).toEqual({
      phase: "confirmed",
      requestId,
      result: { ok: "deploy" },
    });
  });
});
