import { act } from "@ksp-gonogo/sitrep-sdk/testing";
import { axe, toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

expect.extend(toHaveNoViolations);

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
  let results: Awaited<ReturnType<typeof axe>> | undefined;
  await act(async () => {
    results = await axe(container);
  });
  expect(results).toHaveNoViolations();
}
