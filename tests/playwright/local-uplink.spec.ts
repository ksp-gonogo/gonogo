import { expect, test } from "@playwright/test";
import { LOCAL_UPLINK_URL } from "../../playwright.config";
import { dashboardWithWidget } from "./helpers";

/**
 * A client built with `uplink-tools bundle` and named with `--uplink` renders
 * under `vite dev`.
 *
 * The widget is on the dashboard grid, which can only happen if the bundle's
 * `registerComponent` wrote into the app's own registry: a bundle linked to a
 * second copy of the sdk would register into a registry nothing reads. That is
 * the one thing the dev import map has to get right, and nothing else in the
 * dev server's setup can show it.
 *
 * No consent is seeded and no `?uplinkLoaderIds=` is passed: a local build
 * loads on being named, with no mod reporting it.
 */
test("a local Uplink's widget renders under the dev server", async ({
  page,
}) => {
  await page.goto(`${LOCAL_UPLINK_URL}/`, { waitUntil: "load" });
  await page.evaluate(
    (dashboardJson) => {
      localStorage.setItem("gonogo:dashboard:main", dashboardJson);
      localStorage.setItem("gonogo.analytics.consent", "disabled");
      localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
    },
    JSON.stringify(dashboardWithWidget("local-fixture-widget")),
  );

  await page.goto(`${LOCAL_UPLINK_URL}/`, { waitUntil: "load" });

  await expect(
    page.getByText("The local fixture widget rendered from a bundle"),
  ).toBeVisible({ timeout: 30_000 });
});
