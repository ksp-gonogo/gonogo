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
 * The accessibility smoke assertion every widget test owes, with the `act`
 * wrapping done here so no caller has to know about it.
 *
 * ```ts
 * await expectNoA11yViolations(container);
 * ```
 *
 * `axe` walks the DOM asynchronously and takes real time, so a widget with a
 * clock or a subscription keeps updating throughout; awaited bare, each update
 * lands outside `act`. Every await here, the lazy `jest-axe` import included,
 * is inside the `act` scope.
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
