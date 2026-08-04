import { describe, expect, it } from "vitest";
import { controlChannelIds, getControlChannel } from "./control-channels";

/**
 * `getControlChannel` returns `undefined` for an unknown key, and every test
 * below is about a key that exists. A `!` would silence the type without
 * saying anything when the lookup does start returning nothing; this fails
 * with the key that went missing.
 */
function channel(key: string) {
  const found = getControlChannel(key);
  if (found === undefined) throw new Error(`no control channel for "${key}"`);
  return found;
}

describe("control channels", () => {
  it("resolves the throttle channel into one handle unifying both wire keys", () => {
    const throttle = channel("vessel.control.throttle");
    expect(throttle.readTopic).toBe("vessel.control");
    expect(throttle.readField).toBe("throttle");
    expect(throttle.writeCommand).toBe("vessel.control.setThrottle");
  });

  it("wraps a scalar value into the command's wire args", () => {
    const throttle = channel("vessel.control.throttle");
    expect(throttle.toArgs(0.7)).toEqual({ value: 0.7 });
  });

  it("returns undefined for an unknown channel id", () => {
    expect(getControlChannel("vessel.control.nope")).toBeUndefined();
  });

  it("lists the declared channel ids", () => {
    expect(controlChannelIds()).toContain("vessel.control.throttle");
  });
});
