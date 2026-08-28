import { act } from "@ksp-gonogo/sitrep-sdk/testing";
import type { axe as axeFn, toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

/**
 * jest-axe, loaded the first time the assertion is used and never before.
 *
 * It is an OPTIONAL peer of this package, and a module-scope
 * `import { axe } from "jest-axe"` made it mandatory for anyone who touched
 * `@ksp-gonogo/ui-kit/testing` for any reason at all. `render-probe` imports
 * `WidgetHost` from there, so bundling the render harness's probe entry pulled
 * this file in, and every `gonogo-uplink render` and `docs` run failed with
 * "Could not resolve jest-axe" on a package that has nothing to do with
 * rendering. An Uplink author generating a README was being asked to install an
 * accessibility-testing library.
 *
 * `expect.extend` moves in here with it, for the same reason: it ran at module
 * scope and needed the matcher the import provided.
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
 * <b>Why this is a helper and not a documented pattern.</b> `axe` walks the DOM
 * asynchronously and takes real time, so a widget with a clock or a subscription
 * keeps updating throughout. Awaited bare, every one of those updates lands
 * outside `act`, and the bare form was the single largest source of act warnings
 * in this repo: 29 across four files, including one that ranged 0 to 21 per run
 * depending on machine load. The assertion was never wrong, only its await.
 *
 * The correct form is five lines with a nullable local and an `Awaited<>` type,
 * and documenting that trades one bad pattern for five lines people skip or copy
 * wrongly. A caller writing one line cannot get it wrong, which is the point:
 * the framework absorbs the correctness detail rather than teaching it.
 *
 * Published from `@ksp-gonogo/ui-kit/testing` beside `renderWidget`, because an
 * a11y smoke test is a widget concern and an Uplink author has to be able to
 * reach it. A private helper would make this first-party-only, which is the
 * two-tier split this kit exists to avoid.
 */
export async function expectNoA11yViolations(
  container: Element | string,
): Promise<void> {
  const { axe } = await jestAxe();
  let results: Awaited<ReturnType<typeof axe>> | undefined;
  await act(async () => {
    results = await axe(container);
  });
  expect(results).toHaveNoViolations();
}
