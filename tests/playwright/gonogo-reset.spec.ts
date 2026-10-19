/**
 * Resetting the Go/no-go poll starts it over: every connected station is still
 * listed, each one's vote is back to "NO-GO", and the countdown waits until
 * every station has voted "GO" again.
 */
import { expect, type Page, test } from "@playwright/test";
import { bootMissionControl } from "./mission-control";

const PAD = "tests/fixtures/wire/pad-idle.jsonl";

const cells = (main: Page) =>
  main.locator('[data-i="gonogo"] [role="status"][aria-label*=":"]');

const vote = (station: Page) =>
  station.locator('[data-i="gonogo"] button[role="status"]');

test("resetting the poll keeps every station listed and the countdown waits for each", async ({
  browser,
}) => {
  const mc = await bootMissionControl(browser, {
    fixture: PAD,
    widgets: [{ componentId: "gonogo" }],
  });
  const [one, two] = mc.stations;

  await expect(cells(mc.main)).toHaveCount(2);
  await expect(cells(mc.main).filter({ hasText: "NO-GO" })).toHaveCount(2);

  await vote(one).click();
  await expect(cells(mc.main).filter({ hasText: "GO" })).toHaveCount(2);
  await expect(cells(mc.main).filter({ hasText: "NO-GO" })).toHaveCount(1);

  await mc.main.getByRole("button", { name: "Reset" }).click();

  await expect(cells(mc.main)).toHaveCount(2);
  await expect(cells(mc.main).filter({ hasText: "NO-GO" })).toHaveCount(2);

  await vote(one).click();
  await expect(cells(mc.main).filter({ hasText: /^.*: GO$/ })).toHaveCount(0);
  await expect(mc.main.getByRole("timer")).toHaveCount(0);
  await mc.main.waitForTimeout(1_000);
  await expect(mc.main.getByRole("timer")).toHaveCount(0);

  await vote(two).click();
  await expect(mc.main.getByRole("timer")).toBeVisible();

  await mc.close();
});
