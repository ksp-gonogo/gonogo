import { describe, expect, it } from "vitest";
import { commandDelayed, commandShape } from "./map-command";

/**
 * The two facts about a command that outlived the write-half migration.
 *
 * Everything else that file held was a translation from a widget-facing action
 * key onto the command it meant, and every caller names its command directly
 * now. These do not translate anything: they answer how a command's delay
 * behaves, keyed by the command's own topic.
 */
describe("commandShape", () => {
  it("calls the per-frame axis override a stream", () => {
    // Every navball axis and translation action routes to this one topic, so
    // classifying it covers all of them.
    expect(commandShape("vessel.control.setAxes")).toBe("stream");
  });

  it("calls anything else discrete, which is the default a new command gets", () => {
    expect(commandShape("vessel.control.stage")).toBe("discrete");
    expect(commandShape("vessel.maneuver.add")).toBe("discrete");
    expect(commandShape("some.command.nobody.has.classified")).toBe("discrete");
  });
});

describe("commandDelayed", () => {
  it("exempts the simulation controls, which do not travel to a craft", () => {
    expect(commandDelayed("time.setWarpIndex")).toBe(false);
    expect(commandDelayed("time.setPaused")).toBe(false);
  });

  it("delays everything else, which is the default a new command gets", () => {
    expect(commandDelayed("vessel.control.setSas")).toBe(true);
    expect(commandDelayed("vessel.control.stage")).toBe(true);
    expect(commandDelayed("vessel.maneuver.add")).toBe(true);
  });
});
