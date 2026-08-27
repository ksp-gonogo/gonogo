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
 * that ALL THREE first-party Uplinks (scansat + kos + kerbcast):
 *
 *  1. named through `?uplinkLoaderIds=`, are NOT statically bundled, each is
 *     fetched as a standalone ESM bundle (/uplinks/<id>.client.js) and
 *     import()ed at runtime, its bare imports resolving through the baked
 *     import map to the app's singleton chunks, so its module-load
 *     registerComponent writes into the app's ONE registry (`scanning` +
 *     `kos-terminal` + `camera-feed` all appear);
 *  2. the injected SDK host is installed on globalThis;
 *  3. a widget from a LOADED (not statically-bundled) Uplink actually RENDERS on
 *     the dashboard: not merely registers. The dashboard is seeded (same
 *     `dashboardWithWidget` mechanism `tests/playwright/helpers.ts`'s
 *     `bootstrapPair` uses for every widget-DOM-mirror spec) with the scansat
 *     `scanning` widget before navigation; because `main.tsx` only calls
 *     `renderApp()` AFTER `loadEnabledUplinks` resolves (bootUplinksAndRender
 *     awaits the whole load sequence before the first render), by the time React
 *     mounts the widget's `registerComponent` has already run, so waiting for the
 *     widget's own panel title is a genuine post-load-and-mount render proof, not a
 *     race against the import();
 *  4. the loader's outcome store (`loaderState.ts`'s `getUplinkOutcomes`/
 *     `subscribeUplinkOutcomes`) reports each id as `loaded`: asserted through the
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
 * restricting the boot set to just `scansat` fetches only the scansat bundle
 * and leaves kos/kerbcast unloaded. Since queue item 19 (2026-08-27) that
 * override is the only way to name ids with no mod talking, so both tests here
 * pass it and the pair now differ only in the ids.
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
 *  - a dashboard containing the scansat `scanning` widget (same
 *    `dashboardWithWidget` shape `tests/playwright/helpers.ts`'s
 *    `bootstrapPair` seeds for every widget-DOM-mirror spec), so the widget
 *    is on the grid the instant the app renders;
 *  - the analytics-consent answer, so the blocking boot modal doesn't sit
 *    over the dashboard and intercept the Settings FAB click (the same seed
 *    every FAB-driving spec, `uplink-hub-wizard.spec.ts`,
 *    `data-source-status.spec.ts`, uses);
 *  - the Hub wizard first-run flag, so its own auto-open doesn't race the
 *    manual Settings-FAB open this spec drives (same reason
 *    `uplink-hub-wizard.spec.ts` sets it).
 */
async function seedRenderAndSettingsState(
  page: import("@playwright/test").Page,
) {
  const dashboard = dashboardWithWidget("scanning");
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
  test("scansat + kos + kerbcast load via the runtime loader by default (no flag)", async ({
    page,
  }) => {
    // Establish the origin, then seed consent + the dashboard/Settings-UI
    // extras so the reload reaches import() and the follow-on render +
    // Settings assertions have what they need.
    await page.goto(`${PREVIEW}/`, { waitUntil: "load" });
    await seedConsent(page);
    await seedRenderAndSettingsState(page);

    const scansatFetched = page.waitForResponse(
      (r) => r.url().includes("/uplinks/scansat.client.js") && r.ok(),
      { timeout: 30_000 },
    );
    const kosFetched = page.waitForResponse(
      (r) => r.url().includes("/uplinks/kos.client.js") && r.ok(),
      { timeout: 30_000 },
    );
    const kerbcastFetched = page.waitForResponse(
      (r) => r.url().includes("/uplinks/kerbcast.client.js") && r.ok(),
      { timeout: 30_000 },
    );

    // The ids come in through `?uplinkLoaderIds=` because there is no mod
    // talking here and, since queue item 19 deleted the shipped first-party
    // default, nothing else can name them. That is what dev and e2e boots do
    // now; a real boot gets its ids from the live roster.
    await page.goto(`${PREVIEW}/?uplinkLoaderIds=scansat,kos,kerbcast`, {
      waitUntil: "load",
    });

    // All three standalone bundles were fetched by the loader (not statically
    // imported).
    expect((await scansatFetched).status()).toBe(200);
    expect((await kosFetched).status()).toBe(200);
    expect((await kerbcastFetched).status()).toBe(200);

    // Singleton proof: each loaded bundle's registerComponent wrote into the app's
    // ONE registry: a scansat widget (`scanning`), a kos widget
    // (`kos-terminal`), and a kerbcast widget (`camera-feed`) are all present,
    // resolved through the import map.
    await expect
      .poll(
        async () => {
          const ids = await registeredComponentIds(page);
          return (
            ids.includes("scanning") &&
            ids.includes("kos-terminal") &&
            ids.includes("camera-feed")
          );
        },
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

    // RENDER proof, not just registration: the scansat `scanning` widget was
    // seeded onto the dashboard (`seedRenderAndSettingsState`, above) before
    // the navigation. `main.tsx`'s `bootUplinksAndRender` only
    // calls `renderApp()` after `loadEnabledUplinks` resolves, so if the
    // widget's own panel title becomes visible, React mounted the dashboard
    // AFTER the loaded bundle's `registerComponent` already ran, this is a
    // loaded (not statically-bundled) Uplink's widget actually rendering.
    await expect(page.getByText("Scanning", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Loaded-outcomes proof: open Settings -> Data Sources and read the
    // "Loaded clients" panel (`SettingsModal.tsx`'s `UplinkLoaderSection`),
    // the one UI surface backed by `loaderState.ts`'s `getUplinkOutcomes`/
    // `subscribeUplinkOutcomes`: not reachable via a bare page.evaluate
    // import (see the module doc comment above for why). Every first-party id
    // must show `loaded`, never `quarantined`.
    const settingsFab = page.getByRole("button", { name: /^Settings/ });
    await expect(settingsFab).toBeAttached({ timeout: 15_000 });
    await settingsFab.focus();
    await settingsFab.click();
    await page.getByRole("tab", { name: "Data Sources" }).click();

    const dataSourcesPanel = page.getByRole("tabpanel");
    await expect(
      dataSourcesPanel.getByText("Loaded clients", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    for (const name of ["SCANsat", "kOS", "Kerbcast"]) {
      await expect(
        dataSourcesPanel.getByText(name, { exact: true }),
      ).toBeVisible();
    }
    await expect(
      dataSourcesPanel.getByText("loaded", { exact: true }),
    ).toHaveCount(3);
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

    let kosRequested = false;
    let kerbcastRequested = false;
    page.on("request", (r) => {
      if (r.url().includes("/uplinks/kos.client.js")) kosRequested = true;
      if (r.url().includes("/uplinks/kerbcast.client.js")) {
        kerbcastRequested = true;
      }
    });
    const scansatFetched = page.waitForResponse(
      (r) => r.url().includes("/uplinks/scansat.client.js") && r.ok(),
      { timeout: 30_000 },
    );

    // Restrict the boot-time enabled set to just scansat, where the test
    // above names all three: proof the param is read rather than ignored.
    await page.goto(`${PREVIEW}/?uplinkLoaderIds=scansat`, {
      waitUntil: "load",
    });

    expect((await scansatFetched).status()).toBe(200);

    await expect
      .poll(
        async () => (await registeredComponentIds(page)).includes("scanning"),
        { timeout: 15_000 },
      )
      .toBe(true);

    const ids = await registeredComponentIds(page);
    expect(ids).not.toContain("kos-terminal");
    expect(ids).not.toContain("camera-feed");
    expect(kosRequested).toBe(false);
    expect(kerbcastRequested).toBe(false);
  });
});
