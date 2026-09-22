import { afterEach, describe, expect, it } from "vitest";
import {
  installDrivableResizeObserver,
  installFixedSizeResizeObserver,
} from "./testing";

/**
 * The ResizeObserver installers hand back the ONLY uninstall, and dropping it
 * used to be silent.
 *
 * They assign `globalThis.ResizeObserver` directly rather than through
 * `vi.stubGlobal`, so `vi.unstubAllGlobals()` does not undo them. Two test
 * files dropped the closure the same way: a local `const restore = () => {}`
 * inside a `describe` shadowing the module-scope binding that held it, so
 * teardown called the shadow, and the only symptom was a `noUnusedVariables`
 * warning indistinguishable from a dead import.
 *
 * <p>What is asserted here is the SHAPE that occurred, twice, rather than a
 * tidier stand-in for it.</p>
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
    /*
     * `Graph/stream.test.tsx` as it stood: a module-scope binding assigned by
     * `beforeEach`, shadowed by a no-op const inside the describe, so the
     * afterEach restored nothing and the second test's beforeEach installed
     * over a live stub.
     */
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
    // The real one is still reachable; the diagnosis is the point, not a wedge.
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
    // Different function, same resource: a drivable one over a fixed-size one
    // is the same mistake and must not slip through.
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
    /*
     * Two Uplink client suites install once at module scope for the whole file
     * and drop the closure deliberately, because the widget under test needs a
     * sized container before any test runs. Vitest isolates per file, so
     * nothing outlives it, and a guard that failed this would have broken both
     * of them.
     */
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
