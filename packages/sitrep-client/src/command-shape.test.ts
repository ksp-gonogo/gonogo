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
 * UX applies at all, keyed by the command's own topic.
 */
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

  /*
   * The gap this file is the visible end of: the mod declares 26 commands
   * `Delayed = false` and the set behind `commandDelayed` names two, so every
   * one of these answers `true` and is drawn with a countdown it does not have.
   * Pinned as a KNOWN-WRONG reading rather than left unasserted, so closing the
   * gap fails here and gets the assertion flipped rather than passing silently.
   */
  it("still answers true for the 24 the mod says are instant", () => {
    expect(commandDelayed("career.tech.unlock")).toBe(true);
    expect(commandDelayed("ksp.revertToLaunch")).toBe(true);
    expect(commandDelayed("vessel.target.set")).toBe(true);
  });
});
