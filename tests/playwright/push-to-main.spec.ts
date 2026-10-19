/**
 * A widget pushed from a station lands on the main screen at the size the
 * station sent, in the middle of the pushed-widgets area.
 */
import { expect, test } from "@playwright/test";
import { bootMissionControl } from "./mission-control";

const DESCENT = "tests/fixtures/wire/landing-sea-descent.jsonl";

/** The dashboard grid: 36 columns, 20px apart. */
const COLS = 36;
const GAP = 20;

test("a pushed widget is centred on the main screen at the size it was sent", async ({
  browser,
}) => {
  const size = { w: 9, h: 6 };
  const mc = await bootMissionControl(browser, {
    fixture: DESCENT,
    widgets: [{ componentId: "semi-major-axis", size }],
    stations: 1,
  });

  await mc.stations[0]
    .locator('[data-i="semi-major-axis"]')
    .getByRole("button", { name: "Push to main" })
    .click();

  const frame = mc.main.getByLabel(/^Pushed widget .* from /);
  await expect(frame).toBeVisible();

  const { area, shown } = await frame.evaluate((el) => {
    const parent = (el.parentElement as HTMLElement).getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return {
      area: { x: parent.x, y: parent.y, w: parent.width, h: parent.height },
      shown: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    };
  });

  const cellW = (area.w - (COLS - 1) * GAP) / COLS;
  expect(
    Math.abs(shown.w - (size.w * cellW + (size.w - 1) * GAP)),
  ).toBeLessThanOrEqual(1);
  /* Engines snap a fractional offset to the pixel grid differently, so centred means within a pixel. */
  expect(
    Math.abs(shown.x + shown.w / 2 - (area.x + area.w / 2)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(shown.y + shown.h / 2 - (area.y + area.h / 2)),
  ).toBeLessThanOrEqual(1);

  await mc.close();
});
