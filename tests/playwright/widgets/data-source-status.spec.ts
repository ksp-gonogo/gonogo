/**
 * Data sources are host-only. The main screen owns the KSP data sources and
 * surfaces them through the Data Sources FAB; the dashboard widget was
 * retired in favour of the FAB, and stations (which only consume the host's
 * data over PeerJS) have no data-source panel of their own.
 *
 * This boots the main screen, opens the Data Sources panel from the FAB, and
 * asserts the `data` row (the BufferedDataSource, named "Buffered Telemachus
 * Reborn") reports "connected" — exercising the host's Telemachus path end
 * to end against the replay server.
 */
import { expect, test } from "@playwright/test";
import { PORTS } from "../../../playwright.config";

const MAIN_URL = "/";

const TELEMACHUS_CONFIG = JSON.stringify({
  host: "localhost",
  port: PORTS.telemachusReplay,
});

test.describe("Data Sources FAB — main screen", () => {
  test("data source row shows connected in the Data Sources panel", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript((teleCfg: string) => {
      try {
        localStorage.setItem("gonogo.datasource.telemachus", teleCfg);
        // Pre-answer analytics consent so the blocking boot modal doesn't
        // sit over the screen and intercept the FAB click.
        localStorage.setItem("gonogo.analytics.consent", "disabled");
      } catch {
        /* private mode / quota — ignore; the seed just won't apply */
      }
    }, TELEMACHUS_CONFIG);

    const page = await context.newPage();
    await page.goto(MAIN_URL);

    // Open the Data Sources panel from the FAB. Secondary FABs are hidden
    // (pointer-events:none) until the cluster is active; focusing the button
    // fires the cluster's onFocus to reveal it, then the click opens the
    // modal. The aria-label gains a " (a source is offline)" suffix when a
    // source (kOS proxy, stream relays) is legitimately down in this env, so
    // match on the stable prefix.
    const fab = page.getByRole("button", { name: /^Manage data sources/ });
    await expect(fab).toBeAttached({ timeout: 30_000 });
    await fab.focus();
    await fab.click();

    // The source rows render only inside the FAB panel now (the dashboard
    // widget was retired), so a visible `data` row is itself proof the panel
    // opened. Scope to the row that owns the `data` source name so we don't
    // match another source's status label.
    const dataRow = page
      .locator("li")
      .filter({ hasText: "Buffered Telemachus Reborn" });
    await expect(dataRow).toBeVisible({ timeout: 30_000 });
    await expect(dataRow.getByText("connected", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.close();
    await context.close();
  });
});
