/**
 * The milestone's headline proof: the M3 delay engine is just one swappable
 * `comms` provider behind the capability kernel. Same capability id
 * ("comms"), same `CommsCapability` interface — whichever provider the
 * kernel resolves to is the only thing that decides "delayed" vs
 * "immediate" delivery.
 */
import { describe, expect, it } from "vitest";
import { Kernel } from "../registry";
import {
  type CommsCapability,
  type CommsSample,
  commsCapability,
} from "./comms-capability";
import {
  COURIER_DELAY_SECONDS,
  courierCommsProvider,
} from "./courier-provider";

describe("comms capability: courier provider vs vanilla fallback", () => {
  it("real provider active: delivery is delayed until the shared clock advances by the courier's delay", () => {
    const kernel = new Kernel();
    kernel.registerCapability(commsCapability);
    kernel.registerProvider(courierCommsProvider);

    kernel.resolve({ kernelVersion: "1.0.0" });

    const comms = kernel.query<CommsCapability>("comms");
    const received: CommsSample[] = [];
    comms.subscribe("vessel.altitude", (sample) => received.push(sample));

    const recordedAt = comms.clock.now();
    comms.record("vessel.altitude", 100, recordedAt);

    // Not delivered at record time.
    expect(received).toHaveLength(0);

    // Not delivered even on a same-instant flush — this isn't a "needs a
    // tick" quirk, the courier genuinely schedules delivery in the future.
    comms.clock.advanceTo(recordedAt);
    expect(received).toHaveLength(0);

    // Not delivered just short of the delay.
    comms.clock.advanceTo(recordedAt + COURIER_DELAY_SECONDS - 0.001);
    expect(received).toHaveLength(0);

    // Delivered exactly once the delay has elapsed.
    comms.clock.advanceTo(recordedAt + COURIER_DELAY_SECONDS);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      value: 100,
      validAt: recordedAt,
      deliveredAt: recordedAt + COURIER_DELAY_SECONDS,
    });
  });

  it("fallback to vanilla: with the courier provider absent, delivery is immediate (delay 0)", () => {
    const kernel = new Kernel();
    kernel.registerCapability(commsCapability);
    // Deliberately no registerProvider() call — the courier provider is
    // absent, so resolve() must fall back to the vanilla zero-delay comms.

    const { notices } = kernel.resolve({ kernelVersion: "1.0.0" });
    expect(notices).toContainEqual(
      expect.objectContaining({
        capability: "comms",
        kind: "vanilla-fallback",
      }),
    );

    const comms = kernel.query<CommsCapability>("comms");
    const received: CommsSample[] = [];
    comms.subscribe("vessel.altitude", (sample) => received.push(sample));

    const recordedAt = comms.clock.now();
    comms.record("vessel.altitude", 100, recordedAt);

    // Delivered on a same-instant flush — zero elapsed time required.
    comms.clock.advanceTo(recordedAt);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      value: 100,
      validAt: recordedAt,
      deliveredAt: recordedAt,
    });
  });

  it("the switch is observable through the kernel alone: same capability id, opposite delay behavior", () => {
    const withCourier = new Kernel();
    withCourier.registerCapability(commsCapability);
    withCourier.registerProvider(courierCommsProvider);
    withCourier.resolve({ kernelVersion: "1.0.0" });
    const realComms = withCourier.query<CommsCapability>("comms");

    const withoutCourier = new Kernel();
    withoutCourier.registerCapability(commsCapability);
    withoutCourier.resolve({ kernelVersion: "1.0.0" });
    const vanillaComms = withoutCourier.query<CommsCapability>("comms");

    const realReceived: CommsSample[] = [];
    realComms.subscribe("vessel.altitude", (sample) =>
      realReceived.push(sample),
    );
    const vanillaReceived: CommsSample[] = [];
    vanillaComms.subscribe("vessel.altitude", (sample) =>
      vanillaReceived.push(sample),
    );

    realComms.record("vessel.altitude", 42, realComms.clock.now());
    vanillaComms.record("vessel.altitude", 42, vanillaComms.clock.now());

    // Same instant, same topic, same value, no time elapsed on either
    // clock — yet only the vanilla side has delivered.
    realComms.clock.advanceTo(realComms.clock.now());
    vanillaComms.clock.advanceTo(vanillaComms.clock.now());

    expect(realReceived).toHaveLength(0);
    expect(vanillaReceived).toHaveLength(1);
  });
});
