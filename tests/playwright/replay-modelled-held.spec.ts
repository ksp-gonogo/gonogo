/**
 * A main screen and two stations replay recordings in which a craft goes out
 * of contact, and the Tracking Station, the ground track and the flight
 * figures must show the same text, the same marks and the same live, held or
 * modelled state on every screen at each step.
 */
import { expect, type Page, test } from "@playwright/test";
import { bootMissionControl, expectScreensAgree } from "./mission-control";

const OUT_OF_CONTACT =
  "tests/fixtures/wire/recovery-out-of-contact-landed.jsonl";
const HELD_THEN_RELEASED =
  "tests/fixtures/wire/recovery-held-then-released.jsonl";

async function textOf(page: Page, i: string): Promise<string> {
  return await page
    .locator(`[data-i="${i}"]`)
    .evaluate((el) =>
      (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
    );
}

async function expectSameText(
  pages: { name: string; page: Page }[],
  i: string,
  timeout = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const shown = await Promise.all(pages.map(({ page }) => textOf(page, i)));
    if (shown.every((text) => text === shown[0])) return shown[0];
    if (Date.now() > deadline) {
      throw new Error(
        `screens disagree on "${i}":\n${pages.map(({ name }, n) => `  ${name}: ${shown[n]}`).join("\n")}`,
      );
    }
    await new Promise((done) => setTimeout(done, 250));
  }
}

const HELD_CAPTION = /held from the craft's report/;

for (const [label, fixture, heldExpected] of [
  ["out of contact then landed", OUT_OF_CONTACT, true],
  ["held then released", HELD_THEN_RELEASED, false],
] as const) {
  test(`every screen agrees through a craft ${label}`, async ({ browser }) => {
    const mc = await bootMissionControl(browser, {
      fixture,
      widgets: [
        { componentId: "tracking-station", size: { w: 12, h: 10 } },
        { componentId: "ground-track" },
        { componentId: "landing-status" },
        { componentId: "semi-major-axis" },
        { componentId: "comm-signal" },
      ],
    });
    const { durationMs } = await mc.replay.state();
    const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((f) =>
      Math.floor(f * durationMs),
    );
    const seen = new Set<string>();
    for (const ms of steps) {
      await mc.replay.advanceTo(ms);
      for (const i of ["semi-major-axis", "landing-status", "comm-signal"]) {
        await expectScreensAgree(mc, i, { allowEmpty: true });
      }
      for (const i of ["tracking-station", "ground-track"]) {
        seen.add(await expectSameText(mc.screens, i));
      }
    }
    expect(seen.size).toBeGreaterThan(1);
    if (heldExpected) {
      expect([...seen].some((text) => HELD_CAPTION.test(text))).toBe(true);
    }
    await mc.close();
  });
}

test("a station drawing the Tracking Station held while the main draws it live fails the check", async ({
  browser,
}) => {
  const mc = await bootMissionControl(browser, {
    fixture: OUT_OF_CONTACT,
    widgets: [{ componentId: "tracking-station", size: { w: 12, h: 10 } }],
  });
  const { durationMs } = await mc.replay.state();
  await mc.replay.advanceTo(Math.floor(durationMs * 0.1));
  await expectSameText(mc.screens, "tracking-station");

  /* The replay is paused, so nothing re-renders over the edit. */
  await mc.stations[1].evaluate(() => {
    const root = document.querySelector('[data-i="tracking-station"]');
    root?.insertAdjacentText(
      "afterbegin",
      "Route and encounters held from the craft's report 9min ago",
    );
  });
  await expect(
    expectSameText(mc.screens, "tracking-station", 1_000),
  ).rejects.toThrow(/screens disagree on "tracking-station"/);

  await mc.close();
});
