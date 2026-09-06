import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  it("defaults the TURN ports to the window the compose file publishes", () => {
    const c = loadConfig({});
    expect(c.turnPort).toBe(3478);
    expect(c.turnMinPort).toBe(49160);
    expect(c.turnMaxPort).toBe(49170);
  });

  it("takes the TURN window from the environment", () => {
    const c = loadConfig({
      TURN_PORT: "3479",
      TURN_MIN_PORT: "50000",
      TURN_MAX_PORT: "50040",
    });
    expect(c.turnPort).toBe(3479);
    expect(c.turnMinPort).toBe(50000);
    expect(c.turnMaxPort).toBe(50040);
  });

  it("falls back to the default rather than handing coturn an unusable port", () => {
    // coturn's failure on a NaN or out-of-range port is opaque, and the relay
    // would come up with no TURN at all for what is a typo in a .env file.
    const c = loadConfig({ TURN_MIN_PORT: "not-a-port", TURN_PORT: "70000" });
    expect(c.turnMinPort).toBe(49160);
    expect(c.turnPort).toBe(3478);
  });
});
