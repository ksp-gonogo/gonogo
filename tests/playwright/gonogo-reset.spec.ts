/**
 * Resetting the Go/no-go poll starts it over: every connected station is still
 * listed, each one's vote is back to "NO-GO", and the countdown waits until
 * every station has voted "GO" again.
 */
import { expect, type Page, test } from "@playwright/test";
import { bootMissionControl } from "./mission-control";

const PAD = "tests/fixtures/wire/pad-craft-loading.jsonl";

const poll = (screen: Page) => screen.getByRole("group", { name: "GO/NO-GO" });

const cells = (main: Page) =>
  poll(main).locator('[role="status"][aria-label*=":"]');

const goCells = (main: Page) =>
  poll(main).locator('[role="status"][aria-label$=": GO"]');

const vote = (station: Page) =>
  poll(station).getByRole("button", { name: /^(GO|NO-GO)$/ });

test("resetting the poll keeps every station listed and the countdown waits for each", async ({
  browser,
}) => {
  /* The poll is drawn only in the flight scene, which this recording enters about ten seconds in, with the craft still on the pad. */
  const mc = await bootMissionControl(browser, {
    fixture: PAD,
    widgets: [],
    startMs: 10_500,
  });
  const [one, two] = mc.stations;

  await expect(cells(mc.main)).toHaveCount(2, { timeout: 30_000 });
  await expect(cells(mc.main).filter({ hasText: "NO-GO" })).toHaveCount(2);

  await vote(one).click();
  await expect(goCells(mc.main)).toHaveCount(1);
  await expect(cells(mc.main).filter({ hasText: "NO-GO" })).toHaveCount(1);

  await mc.main.getByRole("button", { name: /On go:/ }).click();
  await mc.main.getByRole("button", { name: "Reset" }).click();

  await expect(cells(mc.main)).toHaveCount(2);
  await expect(cells(mc.main).filter({ hasText: "NO-GO" })).toHaveCount(2);

  await vote(one).click();
  await expect(goCells(mc.main)).toHaveCount(1);
  await expect(mc.main.getByRole("timer")).toHaveCount(0);
  await mc.main.waitForTimeout(1_000);
  await expect(mc.main.getByRole("timer")).toHaveCount(0);

  await vote(two).click();
  await expect(mc.main.getByRole("timer")).toBeVisible();

  await mc.close();
});
