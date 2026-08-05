import { describe, expect, it } from "vitest";
import { commandDelayed, commandShape } from "./map-command";

describe("command shape / delayed classification", () => {
  it("classifies fly-by-wire setAxes as a stream command", () => {
    expect(commandShape("vessel.control.setAxes")).toBe("stream");
  });

  it("classifies a one-shot command as discrete", () => {
    expect(commandShape("career.tech.unlock")).toBe("discrete");
    expect(commandShape("ksp.launch")).toBe("discrete");
  });

  it("marks a discrete command as delayed", () => {
    expect(commandDelayed("career.tech.unlock")).toBe(true);
    expect(commandDelayed("vessel.control.setAxes")).toBe(true);
  });

  it("marks sim-meta time controls as never delayed", () => {
    expect(commandDelayed("time.setWarpIndex")).toBe(false);
    expect(commandDelayed("time.setPaused")).toBe(false);
  });
});
