import { afterEach, describe, expect, it } from "vitest";
import { audioCaptureSupport } from "./audioCaptureSupport";

/**
 * The point under test is the ORDER of the two questions, not the media stack:
 * an insecure origin that still exposes `navigator.mediaDevices` has to be
 * blamed on the origin, because that is the browser state a station on a plain
 * http LAN address is actually in.
 */

const patched: Array<{ target: object; name: string }> = [];

function stub(target: object, name: string, value: unknown): void {
  patched.push({ target, name });
  Object.defineProperty(target, name, {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  for (const { target, name } of patched) Reflect.deleteProperty(target, name);
  patched.length = 0;
});

describe("audioCaptureSupport", () => {
  it("names the origin in an environment that is not a secure context at all", () => {
    expect(audioCaptureSupport()).toEqual({
      supported: false,
      reason: "insecure-origin",
    });
  });

  it("blames the origin, not the media stack, when both are wrong", () => {
    stub(globalThis, "isSecureContext", false);
    stub(navigator, "mediaDevices", { getUserMedia: () => {} });
    expect(audioCaptureSupport()).toEqual({
      supported: false,
      reason: "insecure-origin",
    });
  });

  it("blames the media stack on a secure origin without one", () => {
    stub(globalThis, "isSecureContext", true);
    expect(audioCaptureSupport()).toEqual({
      supported: false,
      reason: "no-media-devices",
    });
  });

  it("blames the media stack when the object is there without getUserMedia", () => {
    stub(globalThis, "isSecureContext", true);
    stub(navigator, "mediaDevices", {});
    expect(audioCaptureSupport()).toEqual({
      supported: false,
      reason: "no-media-devices",
    });
  });

  it("is supported on a secure origin with a media stack", () => {
    stub(globalThis, "isSecureContext", true);
    stub(navigator, "mediaDevices", { getUserMedia: () => {} });
    expect(audioCaptureSupport()).toEqual({ supported: true });
  });

  it("treats a merely truthy isSecureContext as insecure", () => {
    stub(globalThis, "isSecureContext", "yes");
    stub(navigator, "mediaDevices", { getUserMedia: () => {} });
    expect(audioCaptureSupport()).toEqual({
      supported: false,
      reason: "insecure-origin",
    });
  });
});
