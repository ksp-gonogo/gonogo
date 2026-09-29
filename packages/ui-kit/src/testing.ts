import type { FormatQuantityOptions } from "./units";
import { writeQuantity } from "./units";

/**
 * Testing helpers for the readouts this kit renders, published as
 * `@ksp-gonogo/ui-kit/testing` (separate from the root so a runtime bundle
 * never pulls testing code in). `<Unit>` splits a readout into a number, a
 * symbol and a hidden spoken word, so `getByText("12.4 km")` finds nothing;
 * these read it back.
 *
 * `renderWidget` mounts a widget inside the dashboard's provider stack, which is
 * made of this package's providers. It does not re-export the sdk's testing
 * entry: an Uplink's setup takes a host from the sdk and a provider stack from
 * here.
 */

/**
 * What a sighted reader sees, with the screen-reader words removed:
 * `textContent` of a `<Unit>` reads "12.4 km kilometres", this reads
 * "12.4 km". Assert on `textContent`, or `getByText("kilometres")`, when the
 * announcement is under test.
 *
 * Defaults to `document.body`. The thin space between a number and its symbol
 * is normalised to an ordinary space.
 */
export function visibleText(container: HTMLElement = document.body): string {
  const clone = container.cloneNode(true) as HTMLElement;
  // `<Unit>`'s spoken-only nodes: the unit's word, and the caption a non-current reading carries.
  for (const hidden of clone.querySelectorAll(
    "[data-unit-word], [data-unit-currency]",
  )) {
    hidden.remove();
  }
  return (clone.textContent ?? "").replace(/ /g, " ");
}

/** The shape a matcher reports back to its test framework. */
interface MatcherResult {
  pass: boolean;
  message: () => string;
}

/**
 * `expect(container).toShowQuantity(value("m", 12400))`.
 *
 * Asserts that a quantity is on screen without naming how it is spelled: it
 * formats through `writeQuantity`, the same ladder `<Unit>` renders with, so it
 * survives a change to where metres hand off to kilometres. For the same
 * reason it cannot catch a formatting bug. To pin the exact spelling, assert
 * the literal:
 *
 * ```ts
 * expect(visibleText()).toContain("12.4 km");
 * ```
 *
 * Register it once, in a setup file:
 *
 * ```ts
 * import { expect } from "vitest";
 * import { unitMatchers } from "@ksp-gonogo/ui-kit/testing";
 * expect.extend(unitMatchers);
 * ```
 */
export const unitMatchers = {
  toShowQuantity(
    received: HTMLElement | undefined,
    quantity: { magnitude: number; unit: string } | null | undefined,
    opts: FormatQuantityOptions = {},
  ): MatcherResult {
    const expected = writeQuantity(quantity, opts);
    const actual = visibleText(received ?? document.body);
    const pass = actual.includes(expected);
    return {
      pass,
      message: () =>
        pass
          ? `expected the screen NOT to show ${expected}, but it does:\n  ${actual}`
          : `expected the screen to show ${expected}\n` +
            `what a reader sees:\n  ${actual}\n` +
            "(screen-reader words are stripped; assert on textContent when the announcement is the point)",
    };
  },
};

/**
 * Type augmentation for the matcher above, for a Vitest consumer to merge
 * explicitly (importing this module never changes `expect` types on its own):
 *
 * ```ts
 * declare module "vitest" {
 *   interface Assertion<T> extends UnitMatchers<T> {}
 * }
 * ```
 */
export interface UnitMatchers<Result = unknown> {
  toShowQuantity(
    quantity: { magnitude: number; unit: string } | null | undefined,
    opts?: FormatQuantityOptions,
  ): Result;
}

export {
  CHECKER_TOLERANCE,
  type CheckerFit,
  type CheckerGrid,
  type CheckerPaint,
  type FramingFault,
  fitOf,
  framingFaults,
  paintChecker,
} from "./checkerFraming";
export { expectNoA11yViolations } from "./expectNoA11yViolations";
export {
  type RenderWidgetOptions,
  renderWidget,
  WidgetHost,
  WidgetHostFor,
} from "./renderWidget";

/**
 * One observation of `target` at the given size, as a complete
 * `ResizeObserverEntry` with every box filled. jsdom lays nothing out, so a
 * self-sizing component otherwise renders at zero.
 */
export function resizeObservation(
  target: Element,
  size: { width: number; height: number },
): ResizeObserverEntry {
  const box: ResizeObserverSize = {
    blockSize: size.height,
    inlineSize: size.width,
  };
  return {
    target,
    contentRect: DOMRectReadOnly.fromRect({
      width: size.width,
      height: size.height,
    }),
    borderBoxSize: [box],
    contentBoxSize: [box],
    devicePixelContentBoxSize: [box],
  };
}

/**
 * Who currently holds `globalThis.ResizeObserver`, or `null`. The installers
 * assign the global directly, so `vi.unstubAllGlobals()` does not undo them and
 * the returned closure is the only way back; a second install over a live one
 * (by either installer) throws, surfacing a dropped closure. Installing once at
 * module scope and never restoring is fine.
 */
let resizeObserverHolder: string | null = null;

function claimResizeObserver(installer: string): void {
  if (resizeObserverHolder !== null) {
    throw new Error(
      `${installer}: globalThis.ResizeObserver is already held by ` +
        `${resizeObserverHolder}, which has not been restored.\n\n` +
        `These installers return the ONLY uninstall, so whoever called ` +
        `${resizeObserverHolder} still owes a call to it. The way this is ` +
        `usually lost is a local binding shadowing the one that holds it:\n\n` +
        `  let restoreResizeObserver = () => {};\n` +
        `  beforeEach(() => { restoreResizeObserver = install...(); });\n` +
        `  describe("...", () => {\n` +
        `    const restoreResizeObserver = () => {};  // shadows it\n` +
        `    afterEach(() => { restoreResizeObserver(); });  // calls the shadow\n` +
        `  });\n\n` +
        `Call the restore you were given, or install once at module scope and ` +
        `never restore, which is also fine.`,
    );
  }
  resizeObserverHolder = installer;
}

/** Idempotent. */
function releaseResizeObserver(): void {
  resizeObserverHolder = null;
}

/**
 * Install a `ResizeObserver` that reports one fixed size to everything observed,
 * and return the uninstall (the only one: see {@link resizeObserverHolder}).
 * `deliver` fires the callback during `observe` (`"sync"`), or on a macrotask
 * for a component that must not see a size during its own mount.
 */
export function installFixedSizeResizeObserver(options: {
  width: number;
  height: number;
  deliver?: "sync" | "macrotask";
}): () => void {
  claimResizeObserver("installFixedSizeResizeObserver");
  const previous = globalThis.ResizeObserver;
  const { width, height, deliver = "sync" } = options;

  class FixedSizeResizeObserver implements ResizeObserver {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      const fire = () =>
        this.callback([resizeObservation(target, { width, height })], this);
      if (deliver === "sync") fire();
      else setTimeout(fire, 0);
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = FixedSizeResizeObserver;
  return () => {
    globalThis.ResizeObserver = previous;
    releaseResizeObserver();
  };
}

/** A `ResizeObserver` a test drives by hand: see {@link installDrivableResizeObserver}. */
export interface DrivableResizeObservers {
  /** Deliver one observation of `target` at `size` to every observer watching it. */
  resize(target: Element, size: { width: number; height: number }): void;
  uninstall(): void;
}

/**
 * Install a `ResizeObserver` whose observations a test delivers itself, for a
 * component whose behaviour is the response to a size change. `resize` reaches
 * only observers watching the element, so a component that never subscribed
 * cannot pass.
 */
export function installDrivableResizeObserver(): DrivableResizeObservers {
  claimResizeObserver("installDrivableResizeObserver");
  const previous = globalThis.ResizeObserver;
  const live = new Set<DrivableResizeObserver>();

  class DrivableResizeObserver implements ResizeObserver {
    readonly observed = new Set<Element>();
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      live.add(this);
    }
    observe(target: Element): void {
      this.observed.add(target);
    }
    unobserve(target: Element): void {
      this.observed.delete(target);
    }
    disconnect(): void {
      this.observed.clear();
    }
  }

  globalThis.ResizeObserver = DrivableResizeObserver;
  return {
    resize(target, size) {
      for (const observer of live) {
        if (!observer.observed.has(target)) continue;
        observer.callback([resizeObservation(target, size)], observer);
      }
    },
    uninstall() {
      live.clear();
      globalThis.ResizeObserver = previous;
      releaseResizeObserver();
    },
  };
}
