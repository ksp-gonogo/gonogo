import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

/**
 * Dogfood e2e for the Uplink Hub setup wizard (design
 * docs/superpowers/specs/2026-07-18-uplink-hub-wizard-design.md §6 Phase W1
 * point 5 — Task D's "smallest dogfood milestone"). Boots the runtime loader
 * with scansat deliberately left OUT of the boot-time load call
 * (`?uplinkLoaderIds=` — `uplinks/flag.ts`'s `loaderBootIdsOverride`, added
 * by this task; the shipped `LOADER_UPLINK_IDS` constant stays untouched),
 * opens the wizard from the persistent Settings entry point (Task C), and
 * drives Results -> Load -> consent -> loaded, asserting the widget's
 * component id lands in the app's live registry with NO navigation event —
 * the specific guarantee a page-reload-based design couldn't give.
 *
 * Runs against the production `vite preview` webServer (PORTS.preview), same
 * as `uplink-loader.spec.ts` and for the same reason: the loader mechanism
 * (external-entry chunks + the baked import map) is build-only, absent from
 * the dev server.
 *
 * STUBBED: nothing at the network boundary for the load flow itself — the
 * registry fetch, bundle fetch, sha256 verify, and `import()` all run for
 * real against the actual preview build, exactly like `uplink-loader.spec.ts`
 * already proves for scansat + kos. The only stand-in is the mod itself:
 * `system.uplinks` (reporting scansat installed/available/healthy) comes
 * from `tests/playwright/sitrep-stream-server.mjs` — a real WebSocket
 * server, not a live KSP + mod — the same shared fixture every other
 * Sitrep-stream Playwright spec already uses to avoid needing a live game.
 * Consent is driven through the real modal (not pre-seeded in localStorage)
 * so this spec also proves the wizard-triggered consent path, which
 * `uplink-loader.spec.ts`'s boot-only coverage doesn't touch.
 */
const PREVIEW = `http://localhost:${PORTS.preview}`;
const SITREP_PORT = PORTS.sitrepReplay;

async function seedBrowserState(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ port }: { port: number }) => {
      try {
        // Point the app's Sitrep connection at the shared replay server
        // (localStorage-first, same keys `sitrepRuntime.ts`/`SettingsModal`
        // read — see tests/playwright/helpers.ts's SITREP_CONFIG for the
        // same pattern used by every other multi-screen spec).
        localStorage.setItem(
          "gonogo.settings",
          JSON.stringify({ version: 1, values: { gameHost: "localhost" } }),
        );
        localStorage.setItem(
          "gonogo.datasource.sitrep",
          JSON.stringify({ port }),
        );
        // Skip the analytics boot modal so it doesn't sit over the dashboard
        // and intercept clicks (same seed uplink-loader.spec.ts's sibling
        // multi-screen specs use).
        localStorage.setItem("gonogo.analytics.consent", "disabled");
        // The first-run Hub-wizard auto-open is a separate feature with its
        // own unit/component coverage (UplinkHubWizardHost.test.tsx) — mark
        // it already-seen so it doesn't race the manual Settings-FAB open
        // this spec drives.
        localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
        // The default demo dashboard (demoConfig.ts) packs in enough
        // widgets (a kOS terminal, resizable grid tiles, …) to visually
        // overlap the Settings FAB in a real browser viewport — an empty
        // dashboard keeps this spec's clicks unambiguous, same reason
        // tests/playwright/helpers.ts's bootstrapPair seeds a minimal
        // single-widget dashboard rather than using the demo default.
        localStorage.setItem(
          "gonogo:dashboard:main",
          JSON.stringify({
            items: [],
            layouts: { lg: [], md: [], sm: [], xs: [], xxs: [] },
          }),
        );
      } catch {
        /* private mode / quota — ignore; the seed just won't apply */
      }
    },
    { port: SITREP_PORT },
  );
}

test.describe("Uplink Hub wizard — dogfood (scansat gap -> load)", () => {
  test("surfaces scansat as an installed-but-unloaded gap and loads it live through the Hub", async ({
    page,
  }) => {
    await seedBrowserState(page);

    // Boot with the runtime loader ON but scansat excluded from the
    // boot-time load call — installed (mod roster) + available, but NOT
    // loaded, so the wizard has an actionable gap to find.
    const bootUrl = `${PREVIEW}/?uplinkLoader=1&uplinkLoaderIds=`;
    await page.goto(bootUrl, { waitUntil: "load" });

    // The Settings FAB lives in the same speed-dial cluster as the "Add
    // component" FAB (`@ksp-gonogo/ui`'s `FabClusterProvider`/`Fab`):
    // secondaries render `pointer-events: none` + `opacity: 0` until the
    // cluster is hovered/focused, so a real click needs to reveal them
    // first — same gesture a real operator's cursor makes on its way to
    // any secondary FAB.
    await page.getByRole("button", { name: "Add component" }).hover();

    // Open Settings -> Uplink Hub (the persistent entry point, Task C).
    await page.getByRole("button", { name: /settings/i }).click();
    await page.getByRole("tab", { name: "Uplink Hub" }).click();
    await page.getByRole("button", { name: /next: check uplinks/i }).click();

    // scansat resolves to "load-from-hub": installed + available (mod
    // roster) + a Hub descriptor exists (registry.local.json) + not loaded
    // (boot skipped it via ?uplinkLoaderIds=).
    const loadButton = page.getByRole("button", {
      name: "Load SCANsat",
      exact: true,
    });
    await expect(loadButton).toBeVisible({ timeout: 20_000 });
    await loadButton.click();

    // The real consent modal fires — nothing pre-seeded in
    // gonogo.uplinkConsent, so this is a genuine first load of this
    // id@version, same modal the boot path uses.
    const consentDialog = page.getByRole("dialog");
    await expect(consentDialog).toBeVisible();
    await expect(
      consentDialog.getByText(/load uplink .scansat./i),
    ).toBeVisible();
    await consentDialog
      .getByRole("button", { name: "Load", exact: true })
      .click();

    // The row re-derives to "Loaded" via loaderState's live subscription —
    // ResultsStep never mutates local state on success, useUplinkGap's
    // useSyncExternalStore does the work.
    await expect(page.getByText("Loaded", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // No navigation happened — the widget appeared live, not via reload.
    expect(page.url()).toBe(bootUrl);

    // Singleton proof: the loaded bundle's registerComponent(...) actually
    // wrote into the app's ONE registry — same check uplink-loader.spec.ts
    // uses for the boot path.
    await expect
      .poll(
        async () => {
          const ids = await page.evaluate(async () => {
            const core = (await import("@ksp-gonogo/core")) as {
              getComponents: () => { id: string }[];
            };
            return core.getComponents().map((c) => c.id);
          });
          return ids.includes("scanning");
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
