/**
 * A station whose link to the main screen dies without the browser noticing
 * must say so on screen within seconds, and show the flight again once the
 * link is back.
 *
 * The cut drops everything the main screen sends down the stations' open
 * connections while leaving them open, which is what a path that stops
 * carrying packets looks like from the station: no close, no error, and the
 * figures stop where they were.
 */
import { expect, test } from "@playwright/test";
import { bootMissionControl, expectScreensAgree } from "./mission-control";

const DESCENT = "tests/fixtures/wire/landing-sea-descent.jsonl";
const BANNER = /RECONNECTING TO HOST\.\.\.|HOST DISCONNECTED/;

test.describe("a station that loses the main screen", () => {
  test("says so within seconds and recovers when the link returns", async ({
    browser,
  }) => {
    const mc = await bootMissionControl(browser, {
      fixture: DESCENT,
      widgets: [{ componentId: "semi-major-axis" }],
    });
    await mc.replay.advanceTo(5_000);
    await expectScreensAgree(mc, "semi-major-axis");
    const [station] = mc.stations;
    await expect(station.getByText(BANNER)).not.toBeVisible();

    await mc.main.evaluate(() => {
      const host = (
        window as unknown as {
          peerHostService: { connections: Set<{ send: () => void }> };
        }
      ).peerHostService;
      for (const conn of host.connections) conn.send = () => {};
    });
    await mc.replay.advanceTo(10_000);

    await expect(station.getByText(BANNER)).toBeVisible({ timeout: 10_000 });

    await expect(station.getByText(BANNER)).not.toBeVisible({
      timeout: 20_000,
    });
    await mc.replay.advanceTo(15_000);
    await expectScreensAgree(mc, "semi-major-axis");

    await mc.close();
  });
});
