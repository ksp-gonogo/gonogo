/**
 * Widget DOM mirror — DataSourceStatus. Asserts the `data` row (the
 * BufferedDataSource on the host, mirrored as a PeerClientDataSource on
 * the station) reports "connected" on both sides.
 *
 * Host and station have DIFFERENT source listings — the host registers
 * `telemachus` + `kos` + `data` (plus stream sources), while the station
 * registers a PCDS for each id the host broadcasts over its schema
 * message. We deliberately don't assert the lists mirror; some host
 * sources (kOS proxy, OCISLY relay) legitimately stay disconnected in
 * this test environment.
 *
 * The mirror we DO assert: the `data` source name — defaulted to
 * "Buffered Telemachus Reborn" by `BufferedDataSource` and propagated
 * verbatim to the station via the PeerHost schema message — appears on
 * both pages and shows status "connected". That single row exercises
 * the full host → broker → station data path, which is the point.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — DataSourceStatus", () => {
  test("data source row shows connected on host and station", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "data-source-status", {
      waitForMain: async (page) => {
        await expect(
          page.getByText("Data Sources", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(
        page.getByText("Data Sources", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      // Scope to the row that owns the `data` source name so we don't
      // accidentally match another source's status label.
      const dataRow = page
        .locator("li")
        .filter({ hasText: "Buffered Telemachus Reborn" });
      await expect(dataRow).toBeVisible({ timeout: 30_000 });
      await expect(
        dataRow.getByText("connected", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
    }

    await teardownPair(pair);
  });
});
