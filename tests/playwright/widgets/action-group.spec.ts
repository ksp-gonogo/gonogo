/**
 * Widget DOM mirror — ActionGroup. Asserts the label + state indicator
 * on the host.
 *
 * The fixture's `vessel.control.sas` is `false`, so configuring the
 * widget for action group "SAS" produces a deterministic OFF readout:
 *   - Group label: "SAS"
 *   - State indicator: "OFF"
 *
 * Station-side assertion scope: only the "SAS" label (static, config-driven)
 * is checked on the station — the "OFF" state comes from live Sitrep stream
 * data, and only the MAIN screen mounts `SitrepTelemetryProvider` today
 * (station stream forwarding over PeerJS is a documented pending gap, see
 * that provider's own doc comment). Checking "OFF" on the station would
 * fail for that reason, not a widget or harness bug.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — ActionGroup", () => {
  test("SAS label renders on host and station; OFF state on host", async ({
    browser,
  }) => {
    const pair = await bootstrapPair(browser, "action-group", {
      widget: { config: { actionGroupId: "SAS" } },
      waitForMain: async (page) => {
        await expect(page.getByText("SAS", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(page.getByText("SAS", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    }
    await expect(pair.main.getByText("OFF", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await teardownPair(pair);
  });
});
