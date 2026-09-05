import { afterEach, describe, expect, it } from "vitest";
import {
  isRadioSupported,
  RADIO_REQUIRED_GLOBALS,
  radioSupportStatus,
} from "./radio-support";

/**
 * These tests stand the four WebCodecs constructors up as stubs, because
 * the point under test is the ORDER of the two questions, not the codec.
 * The live codec is proved cross-engine in
 * `tests/playwright/radio-capability.spec.ts`; what cannot be proved there
 * is that a secure context with no codec and an insecure context with a
 * codec are told apart, since no engine offers both states.
 */

const patched: string[] = [];

function stub(name: string, value: unknown): void {
  patched.push(name);
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

function stubAllCodecGlobals(): void {
  for (const name of RADIO_REQUIRED_GLOBALS) stub(name, function fake() {});
}

afterEach(() => {
  for (const name of patched) {
    Reflect.deleteProperty(globalThis, name);
  }
  patched.length = 0;
});

describe("radioSupportStatus", () => {
  it("is unsupported in this (node) test environment, which is not a context at all", () => {
    expect(radioSupportStatus()).toEqual({
      supported: false,
      reason: "insecure-context",
      missing: [],
    });
    expect(isRadioSupported()).toBe(false);
  });

  it("is supported once the context is secure and every constructor is present", () => {
    stub("isSecureContext", true);
    stubAllCodecGlobals();
    expect(radioSupportStatus()).toEqual({ supported: true });
    expect(isRadioSupported()).toBe(true);
  });

  it("blames the insecure context, not the codec, when the constructors are all there", () => {
    // webkit's real behaviour on a plain-http LAN origin: the codec is
    // exposed and the microphone is still going to be refused. Reporting
    // "no codec" here would send the operator after the wrong problem.
    stub("isSecureContext", false);
    stubAllCodecGlobals();
    expect(radioSupportStatus()).toEqual({
      supported: false,
      reason: "insecure-context",
      missing: [],
    });
  });

  it("blames the codec, and names what is missing, on a secure context without it", () => {
    stub("isSecureContext", true);
    stubAllCodecGlobals();
    Reflect.deleteProperty(globalThis, "AudioEncoder");
    expect(radioSupportStatus()).toEqual({
      supported: false,
      reason: "no-codec",
      missing: ["AudioEncoder"],
    });
  });

  it("treats a merely truthy isSecureContext as insecure", () => {
    // `globalThis.isSecureContext` is a boolean in every browser. Anything
    // else is a host we do not recognise, and guessing in its favour is how
    // a probe ends up green somewhere the microphone is refused.
    stub("isSecureContext", "yes");
    stubAllCodecGlobals();
    expect(radioSupportStatus()).toMatchObject({ reason: "insecure-context" });
  });
});
