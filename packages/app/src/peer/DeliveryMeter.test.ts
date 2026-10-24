import { describe, expect, it } from "vitest";
import { DeliveryMeter, deliveryChannel } from "./DeliveryMeter";

describe("DeliveryMeter", () => {
  it("reports frames per second and the longest gap, counting the silence up to the window's end", () => {
    let t = 0;
    const meter = new DeliveryMeter("station", 10_000, () => t);
    meter.start();
    for (const at of [0, 100, 200, 3_200, 3_300]) {
      t = at;
      meter.record("sitrep:vessel.flight");
    }
    t = 10_000;
    const out = meter.flush();
    meter.stop();
    expect(out["sitrep:vessel.flight"]).toEqual({
      n: 5,
      fps: 0.5,
      maxGapMs: 6_700,
    });
  });

  it("names a Sitrep frame by its Topic and ignores a replayed one", () => {
    const frame = {
      type: "sitrep-frame",
      message: { type: "frame", topic: "vessel.flight" },
    } as never;
    expect(deliveryChannel(frame)).toBe("sitrep:vessel.flight");
    expect(
      deliveryChannel({ ...(frame as object), replay: true } as never),
    ).toBe(undefined);
  });
});
