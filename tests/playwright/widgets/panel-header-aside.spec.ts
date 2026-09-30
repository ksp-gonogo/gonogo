/**
 * The panel-header aside, in BOTH of its states.
 *
 * This surface is a `<details>` (`PanelAsideExpand` in ui-kit's Panel.tsx) that
 * measures whether the title and the aside fit the header row side by side and
 * collapses the aside behind a summary when they do not. Both halves matter and
 * neither was covered: every widget spec asserts on titles and body content, so
 * the only assertion reaching inside the aside at all was CrewStatus's
 * "1/1 aboard" headcount badge, and nothing anywhere exercised the collapsed
 * state.
 *
 * That gap let a real defect ship for eight days: the `<details>` was rendered
 * WITHOUT `open` in the inline state and its content pulled back into view by
 * CSS alone, so the markup told every structural consumer (a screen reader,
 * Playwright's webkit visibility check) that painted badges were collapsed. Two
 * engines disagreed about the same pixels because two engines asked the question
 * differently. These assertions are about the state the DOM CLAIMS, so they hold
 * in every engine.
 *
 * The behaviour is generic `PanelHeader`; the widgets are chosen for their
 * asides. CrewStatus's headcount badge is a stable, stream-driven aside value,
 * but a tile narrow enough to crowd it out is a tiny tile, where the kit draws
 * CrewStatus's tiny form and a tiny form has no header row to collapse. The
 * narrow case is PowerSystems instead: it has no tiny form, and its resource
 * picker is a wide aside at its three-column floor.
 */
import { test } from "@playwright/test";
import { PORTS } from "../../../playwright.config";
import { bootstrapPair, expect, teardownPair } from "../helpers";

const HEADCOUNT = "1/1 aboard";

test.describe("panel header aside", () => {
  test("renders the aside inline, and says so, when the header has room", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "crew-status", {
      waitForMain: async (page) => {
        await expect(page.getByText("CREW", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    // The badge is reachable as visible content, not merely attached: the
    // distinction is the whole point, since a closed <details> keeps its
    // content attached while claiming it is collapsed.
    await expect(pair.main.getByText(HEADCOUNT, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // No collapse affordance is offered while the content is inline, so the
    // <details> must not be advertising a disclosure it cannot perform.
    // `data-panel-aside-expand` is Panel.tsx's own documented targeting hook
    // for this box; the accessible name sits on the summary INSIDE it, so a
    // role query names the trigger rather than the box whose state we want.
    await expect(
      pair.main.locator("[data-panel-aside-expand]"),
    ).toHaveAttribute("open", "");

    await teardownPair(pair);
  });

  test("collapses the aside behind its summary on a tile too narrow for it", async ({
    browser,
  }) => {
    // Four grid columns, the narrowest that still draws the body: narrower than the title plus the badge together, so the measured fit collapses.
    const pair = await bootstrapPair(browser, "crew-status", {
      widget: { size: { w: 4, h: 6 } },
      waitForMain: async (page) => {
        await expect(page.getByText("CREW", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    const box = pair.main.locator("[data-panel-aside-expand]");
    const summary = pair.main.getByLabel("Panel status and controls");
    await expect(box).not.toHaveAttribute("open", "");
    // Genuinely behind the disclosure now, and the summary is the way in.
    await expect(
      pair.main.getByText(HEADCOUNT, { exact: true }),
    ).not.toBeVisible();

    await summary.click();
    await expect(pair.main.getByText(HEADCOUNT, { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await teardownPair(pair);
  });

  test("offers no disclosure on a tiny tile, which draws the tiny form instead", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "crew-status", {
      widget: { size: { w: 2, h: 6 } },
      waitForMain: async (page) => {
        await expect(page.locator("[data-tiny-panel]")).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    await expect(pair.main.locator("[data-panel-aside-expand]")).toHaveCount(0);

    await teardownPair(pair);
  });
});
