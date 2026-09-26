import { afterEach, describe, expect, it } from "vitest";
import {
  installDrivableResizeObserver,
  installFixedSizeResizeObserver,
} from "./testing";

/*
 * The ResizeObserver installers hand back the only uninstall: they assign
 * `globalThis.ResizeObserver` directly, so `vi.unstubAllGlobals()` does not undo
 * them. Dropping the uninstall must fail the next install loudly.
 */

const installed: Array<() => void> = [];

/** Leave the realm as found however an expectation lands. */
afterEach(() => {
  for (const restore of installed.splice(0)) restore();
});

function install(): () => void {
  const restore = installFixedSizeResizeObserver({ width: 400, height: 300 });
  installed.push(restore);
  return restore;
}

describe("a dropped ResizeObserver uninstall fails the next install", () => {
  it("catches the shadowed-binding shape that actually occurred", () => {
    // A module-scope binding shadowed by a no-op const, so the afterEach restores nothing.
    let restoreResizeObserver: () => void = () => {};
    const stubForOneTest = () => {
      restoreResizeObserver = install();
    };

    stubForOneTest(); // first test's beforeEach
    const shadow: () => void = () => {};
    shadow(); // the afterEach, calling the shadow instead of the real one

    expect(() => stubForOneTest()).toThrowError(
      /already held by installFixedSizeResizeObserver/,
    );
    // The real one is still reachable.
    restoreResizeObserver();
  });

  it("says what to do, naming both the shadowing shape and the way out", () => {
    install();
    let message = "";
    try {
      install();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("shadows it");
    expect(message).toContain("install once at module scope and never restore");
  });

  it("guards the global rather than either installer", () => {
    // A drivable installer over a fixed-size one is the same mistake.
    install();
    expect(() => installDrivableResizeObserver()).toThrowError(
      /already held by installFixedSizeResizeObserver/,
    );
  });
});

describe("the legitimate shapes still work", () => {
  it("allows install, restore, install again", () => {
    const first = installFixedSizeResizeObserver({ width: 10, height: 10 });
    first();
    const second = installFixedSizeResizeObserver({ width: 20, height: 20 });
    expect(() => second()).not.toThrow();
  });

  it("allows a single module-scope install that is never restored", () => {
    // A file-wide install at module scope, dropped deliberately, is legitimate: vitest isolates per file.
    install();
    expect(globalThis.ResizeObserver).toBeDefined();
  });

  it("tolerates restoring twice, so a defensive teardown is not a trap", () => {
    const restore = installFixedSizeResizeObserver({ width: 10, height: 10 });
    restore();
    expect(() => restore()).not.toThrow();
    expect(() =>
      installFixedSizeResizeObserver({ width: 10, height: 10 })(),
    ).not.toThrow();
  });
});
