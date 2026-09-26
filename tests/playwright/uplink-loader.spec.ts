import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import { dashboardWithWidget } from "./helpers";

/**
 * Smoke test for the production Uplink client loader (design
 * docs/superpowers/specs/2026-07-17-uplink-hub-and-loader-design.md), updated
 * for D4 step 2 (2026-07-25): the runtime loader is the only path for a
 * first-party client, there is no static-bundled fallback left and no flag
 * gating it (main.tsx always runs the loader; see that file's
 * `bootUplinksAndRender`). Proves, in a REAL browser on all three engines,
 * that a loaded Uplink client works end to end. It names one id
 * (`breakingGround`) rather than sweeping `packages/app/uplink-bundle-targets.ts`:
 * the mechanism is per-Uplink identical, so one widget id is all this looks
 * for. Widget
 * COVERAGE across every Uplink is `scripts/minsize-gate.ts`'s and the visual
 * gate's job. What is proved here is the LOADER, on all three engines:
 *
 *  1. named through `?uplinkLoaderIds=`, it is not statically bundled
 *     (`main.tsx` has no static import path), it is fetched as a standalone ESM bundle (/uplinks/<id>.client.js) and
 *     import()ed at runtime, its bare imports resolving through the baked
 *     import map to the app's singleton chunks, so its module-load
 *     registerComponent writes into the app's ONE registry (`robotics-console`
 *     appears);
 *  2. the injected SDK host is installed on globalThis;
 *  3. a widget from a LOADED (not statically-bundled) Uplink actually RENDERS on
 *     the dashboard: not merely registers. The dashboard is seeded (same
 *     `dashboardWithWidget` mechanism `tests/playwright/helpers.ts`'s
 *     `bootstrapPair` uses for every widget-DOM-mirror spec) with breakingGround's
 *     `robotics-console` widget before navigation (it declares no `channels`,
 *     so `RequiresGuard` never gates it behind the "No telemetry host"
 *     placeholder this preview build's disconnected Sitrep source would
 *     otherwise force); because
 *     `main.tsx` only calls `renderApp()` AFTER `loadEnabledUplinks` resolves
 *     (bootUplinksAndRender awaits the whole load sequence before the first
 *     render), by the time React mounts the widget's `registerComponent` has
 *     already run, so waiting for the widget's own panel title is a genuine
 *     post-load-and-mount render proof, not a race against the import();
 *  4. the loader's outcome store (`loaderState.ts`'s `getUplinkOutcomes`/
 *     `subscribeUplinkOutcomes`) reports the id as `loaded`: asserted through the
 *     real Settings -> Data Sources "Loaded clients" panel
 *     (`SettingsModal.tsx`'s `UplinkLoaderSection`, the one UI surface that reads
 *     that store via `useSyncExternalStore`). The store itself isn't reachable from
 *     a bare `page.evaluate` import the way `@ksp-gonogo/core` is: `loaderState.ts`
 *     is an app-internal module, not one of the externalised bare specifiers baked
 *     into the import map (`vite.config.ts`'s `UPLINK_EXTERNALS`), so there is no
 *     `import("@ksp-gonogo/app")` (or similar) seam to reach it directly, going
 *     through the real UI is the faithful proof here, not a workaround.
 *
 * A second test proves the `?uplinkLoaderIds=` override (`flag.ts`'s
 * `loaderBootIdsOverride`) actually narrows which ids the boot call attempts:
 * an empty override boots the same build without requesting the breakingGround
 * bundle the first test loads. That override is the only way to name ids with
 * no mod talking, so both tests here pass it and the pair differ only in the
 * ids.
 *
 * Consent: the loader gates each first load at a new id@version behind operator
 * consent (design §3.5). Both tests seed a remembered grant in localStorage so
 * the load reaches import() without a manual modal click.
 *
 * Runs against the production `vite preview` webServer (PORTS.preview): the loader
 * mechanism is build-only, so the dev server every other spec uses can't exercise
 * it. import()ing a bare specifier inside page.evaluate uses the document's import
 * map: the same singleton-preservation mechanism the loaded Uplink relies on.
 */
const PREVIEW = `http://localhost:${PORTS.preview}`;

async function registeredComponentIds(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const core = (await import("@ksp-gonogo/core")) as {
      getComponents: () => { id: string }[];
    };
    return core.getComponents().map((c) => c.id);
  });
}

/** Seed a remembered consent grant for every id@version in the built registry. */
async function seedConsent(page: import("@playwright/test").Page) {
  const keys = await page.evaluate(async () => {
    const res = await fetch("/uplinks/registry.local.json");
    const index = (await res.json()) as {
      uplinks: { id: string; versions: { version: string }[] }[];
    };
    return index.uplinks.map((u) => `${u.id}@${u.versions[0].version}`);
  });
  await page.evaluate((granted) => {
    localStorage.setItem("gonogo.uplinkConsent", JSON.stringify(granted));
  }, keys);
}

/**
 * Seed the extras the render + Settings-UI proof needs, on top of
 * `seedConsent`:
 *
 *  - a dashboard containing breakingGround's `robotics-console` widget (same
 *    `dashboardWithWidget` shape `tests/playwright/helpers.ts`'s
 *    `bootstrapPair` seeds for every widget-DOM-mirror spec), so the widget
 *    is on the grid the instant the app renders;
 *  - the analytics-consent answer, so the blocking boot modal doesn't sit
 *    over the dashboard and intercept the Settings FAB click (the same seed
 *    every FAB-driving spec, e.g. `data-source-status.spec.ts`, uses);
 *  - the first-run setup flag, so its own auto-open doesn't race the manual
 *    Settings-FAB open this spec drives.
 */
async function seedRenderAndSettingsState(
  page: import("@playwright/test").Page,
) {
  const dashboard = dashboardWithWidget("robotics-console");
  await page.evaluate(
    ({ dashboardJson }: { dashboardJson: string }) => {
      localStorage.setItem("gonogo:dashboard:main", dashboardJson);
      localStorage.setItem("gonogo.analytics.consent", "disabled");
      localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
    },
    { dashboardJson: JSON.stringify(dashboard) },
  );
}

test.describe("Uplink loader (default path)", () => {
  test("breakingGround loads via the runtime loader by default (no flag)", async ({
    page,
  }) => {
    // Establish the origin, then seed consent + the dashboard/Settings-UI
    // extras so the reload reaches import() and the follow-on render +
    // Settings assertions have what they need.
    await page.goto(`${PREVIEW}/`, { waitUntil: "load" });
    await seedConsent(page);
    await seedRenderAndSettingsState(page);

    const breakingGroundFetched = page.waitForResponse(
      (r) => r.url().includes("/uplinks/breakingGround.client.js") && r.ok(),
      { timeout: 30_000 },
    );

    // The ids come in through `?uplinkLoaderIds=` because there is no mod
    // talking here and no shipped default to name them, which is how dev and
    // e2e boot; a real boot gets its ids from the live roster.
    await page.goto(`${PREVIEW}/?uplinkLoaderIds=breakingGround`, {
      waitUntil: "load",
    });

    // The standalone bundle was fetched by the loader (not statically
    // imported).
    expect((await breakingGroundFetched).status()).toBe(200);

    // Singleton proof: the loaded bundle's registerComponent wrote into the
    // app's ONE registry, resolved through the import map.
    await expect
      .poll(
        async () =>
          (await registeredComponentIds(page)).includes("robotics-console"),
        { timeout: 15_000 },
      )
      .toBe(true);

    // The injected SDK host is installed.
    const hostInstalled = await page.evaluate(
      () =>
        "__GONOGO_SDK__" in globalThis &&
        Boolean((globalThis as Record<string, unknown>).__GONOGO_SDK__),
    );
    expect(hostInstalled).toBe(true);

    // RENDER proof, not just registration: breakingGround's `robotics-console`
    // widget was seeded onto the dashboard (`seedRenderAndSettingsState`,
    // above) before the navigation. `main.tsx`'s `bootUplinksAndRender` only
    // calls `renderApp()` after `loadEnabledUplinks` resolves, so if the
    // widget's own panel title becomes visible, React mounted the dashboard
    // AFTER the loaded bundle's `registerComponent` already ran, this is a
    // loaded (not statically-bundled) Uplink's widget actually rendering.
    await expect(page.getByText("ROBOTICS", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Loaded-outcomes proof: open Settings -> Data Sources and read the
    // "Loaded clients" panel (`SettingsModal.tsx`'s `UplinkLoaderSection`),
    // the one UI surface backed by `loaderState.ts`'s `getUplinkOutcomes`/
    // `subscribeUplinkOutcomes`: not reachable via a bare page.evaluate
    // import (see the module doc comment above for why). The id must show
    // `loaded`, never `quarantined`.
    const settingsFab = page.getByRole("button", { name: /^Settings/ });
    await expect(settingsFab).toBeAttached({ timeout: 15_000 });
    await settingsFab.focus();
    await settingsFab.click();
    await page.getByRole("tab", { name: "Data Sources" }).click();

    const dataSourcesPanel = page.getByRole("tabpanel");
    await expect(
      dataSourcesPanel.getByText("Loaded clients", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      dataSourcesPanel.getByText("Breaking Ground", { exact: true }),
    ).toBeVisible();
    await expect(
      dataSourcesPanel.getByText("loaded", { exact: true }),
    ).toHaveCount(1);
    await expect(
      dataSourcesPanel.getByText("quarantined", { exact: true }),
    ).toHaveCount(0);
  });

  test("?uplinkLoaderIds= overrides which ids the boot call attempts", async ({
    page,
  }) => {
    // Establish the origin first so localStorage seeding (consent) has an
    // origin to write against, same as the default-path test above.
    await page.goto(`${PREVIEW}/`, { waitUntil: "load" });
    await seedConsent(page);

    let breakingGroundRequested = false;
    page.on("request", (r) => {
      if (r.url().includes("/uplinks/breakingGround.client.js")) {
        breakingGroundRequested = true;
      }
    });
    // An empty boot-time enabled set, where the test above names
    // breakingGround: proof the param is read rather than ignored.
    await page.goto(`${PREVIEW}/?uplinkLoaderIds=`, { waitUntil: "load" });

    // The app rendered, which happens only once the loader's boot call has
    // resolved, so the absence below is the override's doing rather than a
    // page that never got as far as the loader. Nothing is seeded here, so the
    // first thing it renders is the analytics consent prompt.
    await expect(
      page.getByRole("dialog", { name: "Help improve gonogo?" }),
    ).toBeVisible({ timeout: 15_000 });

    const ids = await registeredComponentIds(page);
    expect(ids).not.toContain("robotics-console");
    expect(breakingGroundRequested).toBe(false);
  });
});
