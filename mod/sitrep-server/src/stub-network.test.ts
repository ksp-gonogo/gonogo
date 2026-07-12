import { describe, expect, it } from "vitest";
import { StubNetwork } from "./stub-network";

describe("StubNetwork", () => {
  it("defaults to delay 0 and reachable true for any unset pair", () => {
    const network = new StubNetwork();

    expect(network.delayTo("KSC", "v1")).toBe(0);
    expect(network.reachable("KSC", "v1")).toBe(true);
    expect(network.delayTo("anywhere", "anything")).toBe(0);
    expect(network.reachable("anywhere", "anything")).toBe(true);
  });

  it("honours constructor-provided defaults for unset pairs", () => {
    const network = new StubNetwork({ delay: 120, reachable: false });

    expect(network.delayTo("KSC", "v1")).toBe(120);
    expect(network.reachable("KSC", "v1")).toBe(false);
  });

  it("setDelay overrides delay only for the given pair, leaving other pairs at default", () => {
    const network = new StubNetwork();

    network.setDelay("KSC", "v1", 240);

    expect(network.delayTo("KSC", "v1")).toBe(240);
    expect(network.delayTo("KSC", "v2")).toBe(0);
    expect(network.delayTo("Woomera", "v1")).toBe(0);
  });

  it("setReachable overrides reachability only for the given pair, leaving other pairs at default", () => {
    const network = new StubNetwork();

    network.setReachable("KSC", "v1", false);

    expect(network.reachable("KSC", "v1")).toBe(false);
    expect(network.reachable("KSC", "v2")).toBe(true);
    expect(network.reachable("Woomera", "v1")).toBe(true);
  });

  it("keeps delay and reachability independent for the same pair", () => {
    const network = new StubNetwork();

    network.setDelay("KSC", "v1", 300);

    expect(network.delayTo("KSC", "v1")).toBe(300);
    expect(network.reachable("KSC", "v1")).toBe(true);

    network.setReachable("KSC", "v1", false);

    expect(network.reachable("KSC", "v1")).toBe(false);
    expect(network.delayTo("KSC", "v1")).toBe(300);
  });

  it("keys pairs collision-safely (does not confuse ('ab','c') with ('a','bc'))", () => {
    const network = new StubNetwork();

    network.setDelay("ab", "c", 111);

    expect(network.delayTo("ab", "c")).toBe(111);
    expect(network.delayTo("a", "bc")).toBe(0);
  });

  it("allows re-setting a value for the same pair", () => {
    const network = new StubNetwork();

    network.setDelay("KSC", "v1", 50);
    network.setDelay("KSC", "v1", 75);

    expect(network.delayTo("KSC", "v1")).toBe(75);
  });

  describe("scale", () => {
    it("defaults to scale 1, leaving delays unaffected", () => {
      const network = new StubNetwork({ delay: 120 });
      network.setDelay("KSC", "v1", 240);

      expect(network.delayTo("KSC", "v1")).toBe(240);
      expect(network.delayTo("KSC", "v2")).toBe(120);
    });

    it("setScale(2) doubles both the default delay and pinned pair delays", () => {
      const network = new StubNetwork({ delay: 120 });
      network.setDelay("KSC", "v1", 240);

      network.setScale(2);

      expect(network.delayTo("KSC", "v1")).toBe(480);
      expect(network.delayTo("KSC", "v2")).toBe(240);
    });

    it("setScale(0) zeroes delay for every pair, default and pinned alike", () => {
      const network = new StubNetwork({ delay: 120 });
      network.setDelay("KSC", "v1", 240);

      network.setScale(0);

      expect(network.delayTo("KSC", "v1")).toBe(0);
      expect(network.delayTo("KSC", "v2")).toBe(0);
      expect(network.delayTo("anywhere", "anything")).toBe(0);
    });

    it("does not affect reachable at any scale", () => {
      const network = new StubNetwork();
      network.setReachable("KSC", "v1", false);

      network.setScale(0);

      expect(network.reachable("KSC", "v1")).toBe(false);
      expect(network.reachable("KSC", "v2")).toBe(true);
    });

    it("can also be set via the constructor", () => {
      const network = new StubNetwork({ delay: 100 }, 0);

      expect(network.delayTo("KSC", "v1")).toBe(0);
    });

    it("setScale can be changed again after being set, affecting subsequent delayTo calls", () => {
      const network = new StubNetwork({ delay: 100 });

      network.setScale(0);
      expect(network.delayTo("KSC", "v1")).toBe(0);

      network.setScale(1);
      expect(network.delayTo("KSC", "v1")).toBe(100);
    });

    it("clamps a negative setScale value to 0, never scheduling deliveries in the past", () => {
      const network = new StubNetwork({ delay: 100 });

      network.setScale(-1);

      expect(network.delayTo("KSC", "v1")).toBe(0);
    });

    it("clamps a negative constructor scale value to 0", () => {
      const network = new StubNetwork({ delay: 100 }, -5);

      expect(network.delayTo("KSC", "v1")).toBe(0);
    });
  });
});
