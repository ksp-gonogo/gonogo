import { describe, expect, it } from "vitest";
import { controlChannelIds, getControlChannel } from "./control-channels";

describe("control channels", () => {
  it("resolves the throttle channel into one handle unifying both wire keys", () => {
    const throttle = getControlChannel("vessel.control.throttle");
    expect(throttle).toBeDefined();
    expect(throttle!.readTopic).toBe("vessel.control");
    expect(throttle!.readField).toBe("throttle");
    expect(throttle!.writeCommand).toBe("vessel.control.setThrottle");
  });

  it("wraps a scalar value into the command's wire args", () => {
    const throttle = getControlChannel("vessel.control.throttle")!;
    expect(throttle.toArgs(0.7)).toEqual({ value: 0.7 });
  });

  it("returns undefined for an unknown channel id", () => {
    expect(getControlChannel("vessel.control.nope")).toBeUndefined();
  });

  it("lists the declared channel ids", () => {
    expect(controlChannelIds()).toContain("vessel.control.throttle");
  });
});
