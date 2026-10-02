import { act } from "@ksp-gonogo/sitrep-sdk/testing";
import { expect } from "vitest";

const LIVE_REGION =
  '[aria-live], [role="status"], [role="log"], [role="alert"]';

/**
 * Asserts that a component's live region is in the document, empty, before its
 * first message, and that the same element is still there holding the message
 * afterwards.
 *
 * Assistive tech announces a CHANGE to a region it already knows. A region
 * inserted together with its words is often never announced, and a test that
 * only looks at the final DOM cannot see that: the words are there either way.
 * Call this with `container` rendered in the state that has nothing to say, and
 * `reveal` doing whatever makes the component say something (a rerender, a
 * store write, a click). Rendering the region only once it has content, as
 * `{message && <span role="status">{message}</span>}` does, fails the first
 * check; keeping the region mounted for as long as the thing it reports on is
 * on screen passes.
 *
 * `region` narrows which live region is under test when a component carries
 * several, as a selector. It defaults to every `aria-live` element and every
 * `status`, `log` and `alert` role under `container`.
 *
 * @example
 * ```tsx
 * const { container, rerender } = render(<Outcome entries={[]} />);
 * await expectLiveRegionPrimed(container, () =>
 *   rerender(<Outcome entries={[sent]} />),
 * );
 * ```
 *
 * @category Testing
 */
export async function expectLiveRegionPrimed(
  container: HTMLElement,
  reveal: () => void | Promise<void>,
  region: string = LIVE_REGION,
): Promise<HTMLElement[]> {
  const before = [...container.querySelectorAll<HTMLElement>(region)];
  expect(
    before,
    `No live region matching "${region}" is mounted before the component has anything to say, so its first message arrives together with the region and is often not announced. Keep a live region mounted for as long as what it reports on is on screen.`,
  ).not.toHaveLength(0);
  expect(
    before.filter((el) => (el.textContent ?? "").trim() !== ""),
    "A live region already holds text before anything was revealed, so there is no change for assistive tech to announce. Render the component in the state that has nothing to say.",
  ).toEqual([]);

  await act(async () => {
    await reveal();
  });

  const after = [...container.querySelectorAll<HTMLElement>(region)];
  expect(
    before.filter((el) => !after.includes(el)),
    "A live region that was mounted before the reveal was replaced by a new element, so assistive tech saw a fresh region rather than a change to the one it knew. Update the region's content in place.",
  ).toEqual([]);
  expect(
    after.filter((el) => (el.textContent ?? "").trim() !== ""),
    "The reveal put no text into any live region.",
  ).not.toHaveLength(0);
  return after;
}
