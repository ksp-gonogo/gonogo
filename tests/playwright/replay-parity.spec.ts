/**
 * A main screen and two stations replay one recorded flight, and every screen
 * must show each widget's figures with the same text, in the same live, held
 * or modelled state, with the same marks, at each step.
 *
 * Adding a case:
 *
 *   1. Cut an excerpt of a wire recording into `tests/fixtures/wire/`, keeping
 *      it short (seconds, not minutes):
 *        node tests/playwright/wire-fixture.mjs trim <recording.jsonl> \
 *          tests/fixtures/wire/<name>.jsonl --from <s> --to <s>
 *      The excerpt opens with what the screens would already know at `--from`
 *   2. Boot the screens with the widgets under test:
 *        const mc = await bootMissionControl(browser, {
 *          fixture: "tests/fixtures/wire/<name>.jsonl",
 *          widgets: [{ componentId: "landing-status" }],
 *        });
 *   3. Step the replay and check after each step:
 *        await mc.replay.advanceTo(8_000);
 *        await expectScreensAgree(mc, "landing-status");
 *      `advanceTo` takes milliseconds from the excerpt's first frame. A
 *      failure lists each screen's figures and every difference from main
 *   4. `await mc.close()` at the end
 *
 * A reproduction of a disagreement is this, failing, and passes once the fix
 * lands. For anything the figures do not cover (a plot, a banner), read the
 * page directly through `mc.screens`.
 */
import { expect, type Page, test } from "@playwright/test";
import {
  bootMissionControl,
  diffViews,
  expectScreensAgree,
  type WidgetView,
} from "./mission-control";

const DESCENT = "tests/fixtures/wire/landing-sea-descent.jsonl";
const LINK_LOST = "tests/fixtures/wire/splashed-probe-link-lost.jsonl";

async function textOf(page: Page, i: string): Promise<string> {
  return await page
    .locator(`[data-i="${i}"]`)
    .evaluate((el) =>
      (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
    );
}

test.describe("one recorded flight on a main screen and two stations", () => {
  test("every screen shows the same semi-major axis at each step", async ({
    browser,
  }) => {
    const mc = await bootMissionControl(browser, {
      fixture: DESCENT,
      widgets: [{ componentId: "semi-major-axis" }],
    });

    for (const ms of [0, 5_000, 10_000, 20_000]) {
      await mc.replay.advanceTo(ms);
      await expectScreensAgree(mc, "semi-major-axis");
    }

    await mc.close();
  });

  test("every screen agrees through a probe losing its link at splashdown", async ({
    browser,
  }) => {
    const mc = await bootMissionControl(browser, {
      fixture: LINK_LOST,
      widgets: [
        { componentId: "comm-signal" },
        { componentId: "semi-major-axis" },
      ],
    });

    const signal: string[] = [];
    for (const ms of [0, 2_000, 6_000, 10_000, 14_000]) {
      await mc.replay.advanceTo(ms);
      await expectScreensAgree(mc, "semi-major-axis");
      await expectScreensAgree(mc, "comm-signal", { allowEmpty: true });
      await expect
        .poll(async () => {
          const shown = await Promise.all(
            mc.screens.map(({ page }) => textOf(page, "comm-signal")),
          );
          return shown.every((text) => text === shown[0]) ? shown[0] : null;
        })
        .not.toBeNull();
      signal.push(await textOf(mc.main, "comm-signal"));
    }
    expect(new Set(signal).size).toBeGreaterThan(1);

    await mc.close();
  });

  test("a station showing a different value or state fails the check", async ({
    browser,
  }) => {
    const mc = await bootMissionControl(browser, {
      fixture: DESCENT,
      widgets: [{ componentId: "semi-major-axis" }],
    });
    await mc.replay.advanceTo(5_000);
    await expectScreensAgree(mc, "semi-major-axis");

    /* The replay is paused, so nothing re-renders over the edit. */
    await mc.stations[1].evaluate(() => {
      const figure = document.querySelector(
        '[data-i="semi-major-axis"] [data-figure]',
      );
      if (figure) figure.textContent = "0.0 km";
    });
    await expect(
      expectScreensAgree(mc, "semi-major-axis", { timeout: 1_000 }),
    ).rejects.toThrow(/station 2: figure 1 is "0\.0 km"/);

    await mc.stations[0].evaluate(() => {
      const figure = document.querySelector(
        '[data-i="semi-major-axis"] [data-figure]',
      );
      figure?.setAttribute("data-held", "");
      figure?.setAttribute("data-reckoned", "held");
    });
    await expect(
      expectScreensAgree(mc, "semi-major-axis", { timeout: 1_000 }),
    ).rejects.toThrow(/station 1: figure 1 is "[^"]+" \(held\)/);

    await mc.close();
  });

  test("the comparison names every difference from the main screen", () => {
    const main: WidgetView = {
      present: true,
      figures: [{ text: "773.9 km", state: "live" }],
      marks: [],
    };
    const lines = diffViews([
      { name: "main", view: main },
      { name: "station 1", view: main },
      {
        name: "station 2",
        view: {
          present: true,
          figures: [{ text: "773.9 km", state: "modelled" }],
          marks: ["modelled"],
        },
      },
    ]);
    expect(lines).toEqual([
      'station 2: figure 1 is "773.9 km" (modelled), main shows "773.9 km" (live)',
      "station 2: marks [modelled], main: []",
    ]);
  });
});
