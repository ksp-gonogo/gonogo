import { act } from "@ksp-gonogo/sitrep-sdk/testing";
import type { axe as axeFn, toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

/**
 * jest-axe, loaded the first time the assertion is used: it is an optional
 * peer, and `@ksp-gonogo/ui-kit/testing` is also imported by tools that never
 * run an accessibility check.
 */
let matchers: Promise<{ axe: typeof axeFn }> | undefined;
function jestAxe(): Promise<{ axe: typeof axeFn }> {
  matchers ??= import("jest-axe")
    .then(
      (mod: {
        axe: typeof axeFn;
        toHaveNoViolations: typeof toHaveNoViolations;
      }) => {
        expect.extend(mod.toHaveNoViolations);
        return { axe: mod.axe };
      },
    )
    .catch((err: unknown) => {
      if (
        err instanceof Error &&
        /Cannot find (module|package)|ERR_MODULE_NOT_FOUND/.test(err.message)
      ) {
        throw new Error(
          "expectNoA11yViolations needs jest-axe, which is not installed. It is " +
            "your dependency rather than ui-kit's:\n  npm i -D jest-axe",
        );
      }
      throw err;
    });
  return matchers;
}

/**
 * The accessibility smoke assertion for a widget test: runs `axe` over
 * `container` (an element or a selector) and fails on any violation.
 *
 * The whole check runs inside `act`, so a widget with a clock or a
 * subscription that keeps updating while `axe` walks the DOM raises no act
 * warning. Call this rather than `axe` directly. Needs `jest-axe` installed as
 * a dev dependency of your own; it is loaded on first use.
 *
 * @example
 * ```tsx
 * import { expectNoA11yViolations, renderWidget } from "@ksp-gonogo/ui-kit/testing";
 *
 * it("has no accessibility violations", async () => {
 *   const { container } = renderWidget("my-gauge");
 *   await expectNoA11yViolations(container);
 * });
 * ```
 *
 * @category Testing
 */
export async function expectNoA11yViolations(
  container: Element | string,
): Promise<void> {
  let results: Awaited<ReturnType<typeof axeFn>> | undefined;
  await act(async () => {
    const { axe } = await jestAxe();
    results = await axe(container);
  });
  expect(results).toHaveNoViolations();
}
