/**
 * Data sources are host-only. The main screen owns the KSP data sources and
 * surfaces them through the Settings FAB's "Data Sources" tab (the standalone
 * Data Sources FAB and dashboard widget were both retired when settings was
 * folded into one tabbed modal). Stations (which only consume the host's data
 * over PeerJS) have no data-source panel of their own.
 *
 * This boots the main screen, opens Settings → Data Sources, and asserts the
 * `sitrep` row (`SitrepStreamDataSource`, named "Telemetry stream" — a thin
 * status/config front over the live `WebSocketTransport`
 * `SitrepTelemetryProvider` owns, see `packages/app/src/dataSources/sitrep.ts`)
 * reports "connected" — exercising the host's Sitrep stream path end to end
 * against the replay server. The old `data`/"Buffered Telemachus Reborn" row
 * this test used to check no longer exists — that `DataSource` was deleted in
 * `806e7fe2` once the Sitrep stream became the app's only telemetry source.
 */
import { expect, test } from "@playwright/test";
import { PORTS } from "../../../playwright.config";

const MAIN_URL = "/";

const SITREP_CONFIG = JSON.stringify({
  host: "localhost",
  port: PORTS.sitrepReplay,
});

test.describe("Settings — Data Sources tab — main screen", () => {
  test("data source row shows connected in the Data Sources tab", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript((sitrepCfg: string) => {
      try {
        localStorage.setItem("gonogo.datasource.sitrep", sitrepCfg);
        // Pre-answer analytics consent so the blocking boot modal doesn't
        // sit over the screen and intercept the FAB click.
        localStorage.setItem("gonogo.analytics.consent", "disabled");
      } catch {
        /* private mode / quota — ignore; the seed just won't apply */
      }
    }, SITREP_CONFIG);

    const page = await context.newPage();
    await page.goto(MAIN_URL);

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

    // Data-source management now lives behind the "Data Sources" tab in the
    // Settings modal. The tab auto-opens when a source is offline, but select
    // it explicitly so the test is deterministic regardless of env state.
    await page.getByRole("tab", { name: "Data Sources" }).click();

    // The panel (`DataSourcesPanel` in SettingsModal.tsx) leads with the
    // single Gonogo/Sitrep connection row (`SitrepConnection`, a styled
    // `<div>` — not an `<li>`; the per-Uplink health list below it is the
    // only `<li>`-based list now) followed by per-Uplink health rows. Scope
    // to the tabpanel so a visible "Telemetry stream" name is proof the tab
    // opened and the row rendered. "connected" (exact) only ever labels the
    // Sitrep row here — Uplink rows report health states (healthy/degraded/
    // unavailable), never "connected" — so asserting it within the panel is
    // an unambiguous stand-in for "that row's status".
    const dataSourcesPanel = page.getByRole("tabpanel");
    await expect(
      dataSourcesPanel.getByText("Telemetry stream", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      dataSourcesPanel.getByText("connected", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    await page.close();
    await context.close();
  });
});
