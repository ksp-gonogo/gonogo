import { describe, expect, it } from "vitest";
import { commandDelayed } from "./map-command";

/**
 * The one fact about a command that outlived the write-half migration, reached
 * through this package's re-export barrel rather than the SDK's own module, so
 * an app-side import of it is what is under test.
 *
 * Everything else that file held was a translation from a widget-facing action
 * key onto the command it meant, and every caller names its command directly
 * now. This does not translate anything: it answers whether a command's delay
 * UX applies at all, and it answers it by reading the mod's own declaration off
 * the generated command rail rather than from a list kept here.
 */
describe("commandDelayed", () => {
  it("exempts the simulation controls, which do not travel to a craft", () => {
    expect(commandDelayed("time.setWarpIndex")).toBe(false);
    expect(commandDelayed("time.setPaused")).toBe(false);
  });

  it("exempts a scene change, which every vantage sees at once", () => {
    expect(commandDelayed("ksp.launch")).toBe(false);
    expect(commandDelayed("ksp.revertToLaunch")).toBe(false);
    expect(commandDelayed("ksp.toTrackingStation")).toBe(false);
  });

  it("exempts a presentation choice, which sends nothing anywhere", () => {
    expect(commandDelayed("system.frame.set")).toBe(false);
    expect(commandDelayed("vessel.trajectory.forVantage")).toBe(false);
  });

  it("delays everything else, which is the default a new command gets", () => {
    expect(commandDelayed("vessel.control.setSas")).toBe(true);
    expect(commandDelayed("vessel.control.stage")).toBe(true);
    expect(commandDelayed("vessel.maneuver.add")).toBe(true);
  });

  /*
   * The commands the two halves used to disagree about. The mod ran all three
   * instantly and this answered `true` for every one, so each was drawn with a
   * countdown and an in-flight queue row it did not have. Both sides now read
   * one declaration, and the ruling that settled these is the one that says a
   * career write and a target designation are orders rather than ground-side
   * facts.
   */
  it("agrees with the mod about the ones it used to contradict", () => {
    expect(commandDelayed("career.tech.unlock")).toBe(true);
    expect(commandDelayed("vessel.target.set")).toBe(true);
    expect(commandDelayed("career.facility.upgrade")).toBe(true);
  });

  it("delays a command nothing declared, the safe direction to be wrong in", () => {
    expect(commandDelayed("nobody.declared.this")).toBe(true);
  });
});
