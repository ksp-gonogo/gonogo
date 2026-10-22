/**
 * A main screen and a station replaying a recording whose roster lists an
 * installed Uplink: the main screen asks before loading it, and the station
 * loads it with a notice and nothing to skip. The replay server serves
 * RealAntennas's client from `tests/fixtures/uplink-bundles/realantennas`,
 * with a sidecar that says the contract the app speaks and a roster hash that
 * is that bundle's own, so this stands in for a release of RealAntennas built
 * against the current contract. The published release names an older contract
 * and a station would refuse it.
 *
 * The Uplink loader exists only in a production build, so this runs against
 * the `vite preview` server, with no `?uplinkLoaderIds=` override: the ids
 * come from the roster, as in a real boot.
 */
import { expect, type Page, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import { getHostPeerId } from "./helpers";
import { dashboardOf, postReplay, seedScreen } from "./mission-control";

const PREVIEW = `http://localhost:${PORTS.preview}`;
const PAD = "tests/fixtures/wire/pad-idle.jsonl";

async function expectLoaded(page: Page) {
  await page.getByRole("button", { name: "Dashboard controls" }).click();
  await page.getByRole("button", { name: /^Settings(?: \(.*\))?$/ }).click();
  await page.getByRole("tab", { name: "Uplinks", exact: true }).click();
  await page.getByRole("tab", { name: "RealAntennas", exact: true }).click();
  const uplinkPage = page.getByRole("tabpanel", { name: "RealAntennas" });
  await expect(uplinkPage.getByText("loaded", { exact: true })).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(
    uplinkPage.getByText("quarantined", { exact: true }),
  ).toHaveCount(0);
}

test("a station replaying a recording loads the roster's Uplink with its notice and no Skip", async ({
  browser,
}) => {
  await postReplay("/replay/load", { fixture: PAD });
  await postReplay("/replay/advance", { toMs: 100 });
  const dashboard = dashboardOf([{ componentId: "semi-major-axis" }]);

  const mainContext = await browser.newContext();
  await seedScreen(mainContext, "main", dashboard);
  const main = await mainContext.newPage();
  await main.goto(`${PREVIEW}/`);

  // The main screen is asked, once, and answers Load.
  const ask = main.getByRole("group", { name: "Load RealAntennas Uplink?" });
  await ask.getByRole("button", { name: "Load" }).click();
  await main.getByRole("button", { name: "Continue" }).click();
  await expectLoaded(main);
  await main.keyboard.press("Escape");
  const shareCode = await getHostPeerId(main);

  const stationContext = await browser.newContext();
  await seedScreen(stationContext, "station", dashboard);
  const station = await stationContext.newPage();
  await station.goto(`${PREVIEW}/station?host=${shareCode}`);

  // The station is told, with nothing to answer: no Skip, no Load, only Continue.
  await expect(
    station.getByRole("heading", { name: "Uplinks from the main screen" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(station.getByText("RealAntennas Uplink")).toBeVisible();
  await expect(station.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await expect(station.getByRole("button", { name: "Load" })).toHaveCount(0);
  await station.getByRole("button", { name: "Continue" }).click();
  await expectLoaded(station);

  await mainContext.close();
  await stationContext.close();
});
