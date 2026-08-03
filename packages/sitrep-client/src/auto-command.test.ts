import { describe, expect, it } from "vitest";
import { decideAutoDispatch } from "./auto-command";

// A command that should EXECUTE on the craft at game-UT `targetUt` must be
// DISPATCHED at `targetUt - oneWayDelay`, so it arrives on time under signal
// delay. `decideAutoDispatch` is the pure fire/skip/wait decision.
describe("decideAutoDispatch", () => {
  it("waits before the lead point (utNow < targetUt - delay)", () => {
    // targetUt 100, delay 10 → dispatch at 90; at 89 it's not time yet.
    expect(decideAutoDispatch(89, 100, 10)).toBe("wait");
  });

  it("fires exactly at the lead point (utNow === targetUt - delay)", () => {
    expect(decideAutoDispatch(90, 100, 10)).toBe("fire");
  });

  it("fires within the lead window (armed late, targetUt still future)", () => {
    // Armed at utNow 95 with delay 20 → dispatch point 80 already passed, but
    // the event (targetUt 100) is still ahead: fire immediately.
    expect(decideAutoDispatch(95, 100, 20)).toBe("fire");
  });

  it("fires right up to the event (utNow === targetUt)", () => {
    expect(decideAutoDispatch(100, 100, 10)).toBe("fire");
  });

  it("skips once the event itself is past (utNow > targetUt)", () => {
    // Dispatching now would arrive at utNow+delay, well past the event.
    expect(decideAutoDispatch(101, 100, 10)).toBe("skip-past");
  });

  it("no-delay (LAN): dispatch point collapses onto the event", () => {
    // delay 0 → dispatch at targetUt; nothing to lead-compensate.
    expect(decideAutoDispatch(95, 100, 0)).toBe("wait");
    expect(decideAutoDispatch(100, 100, 0)).toBe("fire");
  });
});
