/**
 * The vanilla fallback for the `comms` capability: the SAME
 * `CommsCapability` shape as the real courier-backed provider
 * (`courier-provider.ts`), wired for immediate (zero-delay) delivery.
 *
 * Reuses `@ksp-gonogo/sitrep-server`'s `Courier`/`StubNetwork`/`ManualClock`
 * unchanged — a nonzero base delay collapsed by `StubNetwork`'s `scale: 0`
 * — rather than a hand-rolled bypass, so "vanilla" and "real" differ only
 * in configuration, never in code path. No `@ksp-gonogo/sitrep-client`
 * dependency needed.
 */
import { Courier, ManualClock, StubNetwork } from "@ksp-gonogo/sitrep-server";
import type { CommsCapability } from "./comms-capability";

/** Base one-way delay before the zero scale collapses it — proves scale, not just a zero default, is what makes delivery immediate. */
const BASE_DELAY_SECONDS = 2;

const NODE = "vessel";
const VANTAGE = "ksc";

/** Build a fresh vanilla (zero-delay) `CommsCapability` instance. */
export function createVanillaComms(): CommsCapability {
  const clock = new ManualClock();
  const network = new StubNetwork({ delay: BASE_DELAY_SECONDS }, 0);
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
