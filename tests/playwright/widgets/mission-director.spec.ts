/**
 * Widget DOM mirror — MissionDirector. Asserts the panel chrome matches
 * on host and station.
 *
 * The recorded fixture has no `contracts.active` key (or any other
 * `contracts.*` / `career.mode` / `kc.scene` keys), so:
 *   - `useGameContext` falls back to careerMode "Unknown" + scene
 *     "Unknown", giving hasGameSignal === false. RequiresGuard
 *     therefore renders its children unchanged (the "no signal yet,
 *     don't dim" early-out), not the "Career or science save required"
 *     placeholder.
 *   - Inside the widget, `parseContracts(undefined)` returns null, so
 *     the early-return branch renders:
 *         <PanelTitle>MISSION DIRECTOR</PanelTitle>
 *         <PanelSubtitle>Awaiting contract telemetry</PanelSubtitle>
 *     (The subtitle shows because the seeded layout uses h = 6 ≥ 4.)
 *
 * Both pages should see the same chrome — PBDS mirrors the (absent)
 * upstream values identically.
 */
import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

test.describe("widget DOM mirror — MissionDirector", () => {
  test("panel chrome mirrors across host and station", async ({ browser }) => {
    const pair = await bootstrapPair(browser, "mission-director", {
      waitForMain: async (page) => {
        await expect(
          page.getByText("MISSION DIRECTOR", { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
      },
    });

    for (const page of [pair.main, pair.station]) {
      await expect(
        page.getByText("MISSION DIRECTOR", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText("Awaiting contract telemetry", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await teardownPair(pair);
  });
});
