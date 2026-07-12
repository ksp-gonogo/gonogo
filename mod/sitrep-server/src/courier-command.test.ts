import type { CommandResponse } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "./clock";
import { Courier } from "./courier";
import { StubNetwork } from "./stub-network";

describe("Courier command round-trip", () => {
  it("executes at uplink and confirms at uplink+downlink", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });

    const handler = vi.fn((command: string) => ({ ok: command }));
    courier.setCommandHandler(handler);

    const onResponse = vi.fn();
    courier.dispatchCommand("vessel", "r1", "deploy", null, "KSC", onResponse);

    // Nothing yet — command is still in flight uplink.
    clock.advanceTo(1);
    expect(handler).not.toHaveBeenCalled();
    expect(onResponse).not.toHaveBeenCalled();

    // Uplink elapsed: the handler executes on the vessel, but the
    // confirmation is still in flight downlink.
    clock.advanceTo(2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("deploy", null, "vessel");
    expect(onResponse).not.toHaveBeenCalled();

    // Downlink elapsed: confirmation arrives back at the vantage.
    clock.advanceTo(4);
    expect(onResponse).toHaveBeenCalledTimes(1);
    const response = onResponse.mock.calls[0][0] as CommandResponse<unknown>;
    expect(response).toMatchObject({
      type: "command-response",
      requestId: "r1",
      result: { ok: "deploy" },
      meta: {
        source: "vessel",
        vantage: "KSC",
        validAt: 2,
        deliveredAt: 4,
      },
    });
  });

  it("drops a command entirely with honest silence when the node is unreachable", () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    network.setReachable("KSC", "vessel", false);
    const courier = new Courier({ clock, network });

    const handler = vi.fn((command: string) => ({ ok: command }));
    courier.setCommandHandler(handler);

    const onResponse = vi.fn();
    courier.dispatchCommand("vessel", "r1", "deploy", null, "KSC", onResponse);

    clock.advanceTo(100);
    expect(handler).not.toHaveBeenCalled();
    expect(onResponse).not.toHaveBeenCalled();
  });
});
