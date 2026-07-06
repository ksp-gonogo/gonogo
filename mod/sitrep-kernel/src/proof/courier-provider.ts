/**
 * The "real" `comms` provider: wires an actual M3 `Courier` + `StubNetwork`
 * (fixed one-way delay, `COURIER_DELAY_SECONDS`) + a shared `ManualClock`,
 * all imported unchanged from `@gonogo/sitrep-server` — this file only
 * adapts them to the `CommsCapability` shape, it never modifies M3 code.
 *
 * This is the milestone's headline: the entire M3 delay engine collapses to
 * one swappable provider behind the kernel's `comms` capability.
 */
import { Courier, ManualClock, StubNetwork } from "@gonogo/sitrep-server";
import type { ProviderRegistration } from "../capability";
import { COMMS_CAPABILITY_ID, type CommsCapability } from "./comms-capability";

/** One-way delay (UT seconds) the courier provider's StubNetwork is fixed at. */
export const COURIER_DELAY_SECONDS = 2;

const NODE = "vessel";
const VANTAGE = "ksc";

/** Build a fresh courier-backed `CommsCapability` instance (its own clock/courier). */
export function createCourierComms(): CommsCapability {
  const clock = new ManualClock();
  const network = new StubNetwork({ delay: COURIER_DELAY_SECONDS });
  const courier = new Courier({ clock, network });

  return {
    clock,
    record(topic, value, validAtUt) {
      courier.record(NODE, topic, value, validAtUt);
    },
    subscribe(topic, onData) {
      return courier.subscribeStream(NODE, topic, VANTAGE, (message) => {
        onData({
          value: message.payload,
          validAt: message.meta.validAt,
          deliveredAt: message.meta.deliveredAt,
        });
      });
    },
  };
}

/** Registration for the kernel: the real, courier-backed `comms` provider. */
export const courierCommsProvider: ProviderRegistration<CommsCapability> = {
  capability: COMMS_CAPABILITY_ID,
  id: "courier",
  factory: () => createCourierComms(),
};
