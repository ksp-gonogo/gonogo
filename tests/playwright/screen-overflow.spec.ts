/**
 * The main screen and the station page fit the viewport and put no loose text
 * on the page.
 *
 * A stray text node between providers (a JSX comma after a provider) renders
 * as literal text under the app root, below the dashboard, and makes the
 * document scroll. Neither shows in a unit test of the screen, so this reads
 * the real page in every engine.
 */
import { type Page, test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "./helpers";

/** Text directly under the app root, the body, or the page's landmark containers rather than inside an element. */
const strayText = (page: Page) =>
  page.evaluate(() => {
    const hosts = [
      document.getElementById("root"),
      document.body,
      ...document.querySelectorAll("main"),
    ];
    const found: string[] = [];
    for (const host of hosts) {
      for (const node of host?.childNodes ?? []) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
          found.push(node.textContent.trim());
        }
      }
    }
    return found;
  });

const overflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.documentElement;
    return {
      horizontal: d.scrollWidth - d.clientWidth,
      vertical: d.scrollHeight - d.clientHeight,
    };
  });

test.describe("screens fit the viewport", () => {
  test("the main screen and the station page neither scroll nor show loose text", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "comm-signal", {
      waitForMain: async (page) => {
        await expect(page.getByText("COMMNET", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const [name, page] of [
      ["main screen", pair.main],
      ["station page", pair.station],
    ] as const) {
      // Tiles settle their sizes after they first draw.
      await expect
        .poll(async () => await overflow(page), {
          message: `${name} overflows the viewport`,
          timeout: 10_000,
        })
        .toEqual({ horizontal: 0, vertical: 0 });
      expect(await strayText(page), `${name} has loose text`).toEqual([]);
    }

    await teardownPair(pair);
  });
});
