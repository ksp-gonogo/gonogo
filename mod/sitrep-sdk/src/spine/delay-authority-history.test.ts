import { describe, expect, it } from "vitest";
import { DelayAuthority } from "./delay-authority";

describe("DelayAuthority.observeFigure", () => {
  it("holds the last measured delay when the newest frame reports no path", () => {
    const authority = new DelayAuthority();
    authority.observe({ oneWaySeconds: null });
    authority.observeFigure({ oneWaySeconds: 27.4 }, 100);
    expect(authority.delaySeconds()).toBeCloseTo(27.4);
  });

  it("does not let an older figure replace a newer one", () => {
    const authority = new DelayAuthority();
    authority.observeFigure({ oneWaySeconds: 30 }, 200);
    authority.observeFigure({ oneWaySeconds: 20 }, 100);
    expect(authority.delaySeconds()).toBe(30);
  });

  it("leaves the command delay unknown while the newest frame reports none", () => {
    const authority = new DelayAuthority();
    authority.observe({ oneWaySeconds: null });
    authority.observeFigure({ oneWaySeconds: 27.4 }, 100);
    expect(authority.commandDelaySeconds()).toBeNull();
  });
});
