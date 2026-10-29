import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import {
  closeAll,
  NAMES,
  NEAR,
  openConversation,
  openScreen,
  publishScene,
} from "./commcast-radio-scene";

test.use({ video: "off", trace: "off" });
test.describe.configure({ timeout: 120_000 });

/** Chromium only, for the peer-link reason `commcast-radio.spec.ts` records. */
test.describe("commcast thread bar while the vantage stamp blinks @chromium-only", () => {
  test("the thread bar keeps one set of names as the stamp drops out and returns", async ({
    browser,
  }, testInfo) => {
    await publishScene([PORTS.radioStream.ksc, PORTS.radioStream.near]);
    const control = await openScreen(browser, {
      name: "mission-control",
      url: "/?uplinkLoaderIds=",
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir: testInfo.outputPath("videos"),
      clip: { name: "unused", chunks: 1 },
    });

    try {
      await openConversation(control.page, NAMES[NEAR]);
      const back = control.page.getByRole("button", { name: "Inbox" });
      await expect(back).toBeVisible();

      // Every tick re-emits each subscribed topic, so a few frames a phase is a blink every second or so.
      const res = await fetch(
        `http://localhost:${PORTS.radioStream.ksc}/blink-vantage?every=3`,
        { method: "POST" },
      );
      expect(res.ok).toBe(true);

      const seen = await control.page.evaluate(
        (ms) =>
          new Promise<string[]>((resolve) => {
            const bar = [...document.querySelectorAll("button")].find((b) =>
              b.textContent?.includes("Inbox"),
            )?.parentElement;
            const titles = new Set<string>();
            const read = () => titles.add(bar?.textContent ?? "");
            read();
            const timer = setInterval(read, 50);
            setTimeout(() => {
              clearInterval(timer);
              resolve([...titles]);
            }, ms);
          }),
        8_000,
      );

      expect(
        seen,
        "the bar's text changed while the vantage stamp blinked",
      ).toHaveLength(1);
      expect(seen[0]).toContain(NAMES[NEAR]);
    } finally {
      await fetch(
        `http://localhost:${PORTS.radioStream.ksc}/blink-vantage?every=0`,
        { method: "POST" },
      );
      await closeAll([control]);
    }
  });
});
