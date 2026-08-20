import type { FormatQuantityOptions } from "./units";
import { writeQuantity } from "./units";

/**
 * Testing helpers for the readouts this kit renders.
 *
 * Published as `@ksp-gonogo/ui-kit/testing`, deliberately: `<Unit>` splits a
 * readout into a number, a symbol and a hidden word for screen readers, so
 * `getByText("12.4 km")` finds nothing. That is correct behaviour and a
 * surprise every single time, and until now the way to cope with it lived in
 * `@ksp-gonogo/test-utils`, which is `private: true` and which a third-party
 * Uplink therefore cannot install.
 *
 * So an Uplink author rendering `<Unit>` in their own widget had no way to
 * assert on it except by discovering the markup themselves. The kit that
 * splits the readout should ship the way to read it back.
 *
 * This entrypoint is separate from the root so a runtime bundle never pulls
 * testing code in.
 *
 * It also ships `renderWidget`, which mounts a widget inside the provider stack the
 * dashboard puts around one. That belongs here rather than in
 * `@ksp-gonogo/sitrep-sdk/testing` for a structural reason and not a filing one:
 * the stack IS this package's providers (`DelayRailProvider`,
 * `PanelStatusStoreProvider`, `ContributionsProvider`, `PanelBadgesProvider`,
 * `PanelStatusProvider`), and the sdk cannot import them. Putting it there would
 * have meant handing the sdk seven ui-kit values so it could reassemble a ui-kit
 * stack, which is not an injectable seam, it is the subject matter.
 *
 * The two testing entries do NOT re-export each other. A design-system package
 * fronting a generic test harness is a dependency inversion wearing a convenience,
 * so an Uplink's setup names both when it needs both: a host from the sdk, a
 * provider stack from here. Those are genuinely two things.
 */

/**
 * What a SIGHTED READER sees, with the screen-reader words removed.
 *
 * `<Unit>` renders `12.4` and `km` as separate elements, plus a visually
 * hidden ` kilometres` for anyone listening. `textContent` therefore reads
 * "12.4 km kilometres", and `getByText`, which matches one node, matches
 * neither.
 *
 * Assert on this for what is on screen. Assert on `textContent` when the
 * ANNOUNCEMENT is the thing under test, or better, `getByText("kilometres")`,
 * which says so.
 *
 * Defaults to `document.body`, so an assertion about what is on screen needs
 * no container plumbed to it. Pass one when a test renders more than one
 * thing and needs to say which.
 *
 * The thin space between a number and its symbol is normalised to an ordinary
 * one. A reader sees a space; which space it is is a typographic detail, and
 * one that otherwise produces assertion failures reading
 * `expected "12.4 km" to be "12.4 km"`.
 */
export function visibleText(container: HTMLElement = document.body): string {
  const clone = container.cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll("[data-unit-word]")) {
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
 * Asserts that a quantity is on screen, WITHOUT naming how it is spelled. It
 * formats through `writeQuantity`, the same ladder `<Unit>` renders with, so
 * the assertion says "this readout shows this distance" rather than "the
 * characters 12.4 km appear".
 *
 * That distinction is the point. A string assertion pins the ladder: change
 * where metres hand off to kilometres and every test naming `12.4 km` breaks,
 * which is how a presentation change turns into a six-hundred-file diff. This
 * one keeps passing, because the expectation moved with the component.
 *
 * ## What it cannot do
 *
 * It formats with the same code the component renders with, so it cannot
 * catch a formatting BUG: if the ladder starts emitting the wrong rung, both
 * sides move together and the test stays green. When the exact spelling is
 * what you mean to pin, assert the literal:
 *
 * ```ts
 * expect(visibleText()).toContain("12.4 km");
 * ```
 *
 * Both are legitimate. Use the matcher for "the widget shows the altitude it
 * was given", and the literal for "this readout reads exactly this".
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
 * Type augmentation for the matcher above, for a consumer using Vitest.
 *
 * Declared as an interface a consumer can merge rather than a global side
 * effect, so importing this module never changes anyone's `expect` types
 * without them asking:
 *
 * ```ts
 * declare module "vitest" {
 *   interface Assertion<T> extends UnitMatchers<T> {}
 * }
 * ```
 */
export interface UnitMatchers<R = unknown> {
  toShowQuantity(
    quantity: { magnitude: number; unit: string } | null | undefined,
    opts?: FormatQuantityOptions,
  ): R;
}

// The a11y smoke assertion, with its `act` wrapping done once here rather than
// spelled out at every call site. See the module for why it is a helper.
export { expectNoA11yViolations } from "./expectNoA11yViolations";
// The widget render harness. Its own module because it is 200 lines of provider
// stack and JSX, and this file is otherwise plain functions over strings.
export {
  type RenderWidgetOptions,
  renderWidget,
  WidgetHost,
} from "./renderWidget";
