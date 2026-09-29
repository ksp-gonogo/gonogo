/**
 * The game connection is host-only. The main screen owns the Sitrep stream and
 * surfaces it through the Settings FAB's "Connection" tab; stations, which
 * only consume the host's data over PeerJS, have no connection of their own.
 *
 * This boots the main screen, opens Settings → Connection, and asserts the
 * `sitrep` row (`SitrepStreamDataSource`, named "Telemetry stream": a thin
 * status/config front over the live `WebSocketTransport`
 * `SitrepTelemetryProvider` owns, see `packages/app/src/dataSources/sitrep.ts`)
 * reports "connected": exercising the host's Sitrep stream path end to end
 * against the replay server.
 */
import { expect, test } from "@playwright/test";
import { PORTS } from "../../../playwright.config";

const MAIN_URL = "/";

const SITREP_CONFIG = JSON.stringify({
  port: PORTS.sitrepReplay,
});

test.describe("Settings: Connection tab: main screen", () => {
  test("the stream row shows connected in the Connection tab", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript((sitrepCfg: string) => {
      try {
        localStorage.setItem("gonogo.datasource.sitrep", sitrepCfg);
        // Pre-answer analytics consent so the blocking boot modal doesn't sit over the screen and intercept the FAB click.
        localStorage.setItem("gonogo.analytics.consent", "disabled");
        // The first-run setup host auto-opens the Settings modal on a fresh
        // browser (own component coverage in FirstRunSetupHost.test.tsx):
        // mark it already-seen so it doesn't
        // race the manual Settings-FAB open this spec drives below.
        localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
      } catch {
        /* private mode / quota: ignore; the seed just won't apply */
      }
    }, SITREP_CONFIG);

    const page = await context.newPage();
    // Empty `?uplinkLoaderIds=` → loader loads nothing, no consent modal.
    await page.goto(`${MAIN_URL}?uplinkLoaderIds=`);

    // Open Settings from the FAB. Secondary FABs are hidden
    // (pointer-events:none) until the cluster is active; focusing the button
    // fires the cluster's onFocus to reveal it, then the click opens the
    // modal. The aria-label gains a " (something needs attention)" suffix when
    // a source (kOS proxy, stream relays) is legitimately down in this env, so
    // match on the stable "Settings" prefix.
    const fab = page.getByRole("button", { name: /^Settings/ });
    await expect(fab).toBeAttached({ timeout: 30_000 });
    await fab.focus();
    await fab.click();

    /*
     * The tab auto-opens when the stream is offline, but select it explicitly
     * so the test is deterministic regardless of env state.
     */
    await page.getByRole("tab", { name: "Connection" }).click();

    /*
     * The panel holds only the game host row (`SitrepConnection`), so a visible
     * "Telemetry stream" name inside it is proof the tab opened and the row
     * rendered, and "connected" (exact) can only be that row's status.
     */
    const connectionPanel = page.getByRole("tabpanel");
    await expect(
      connectionPanel.getByText("Telemetry stream", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      connectionPanel.getByText("connected", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    await page.close();
    await context.close();
  });
});
