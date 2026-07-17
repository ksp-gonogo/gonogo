import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

/**
 * Phase A smoke test for the production Uplink client loader (design
 * docs/superpowers/specs/2026-07-17-uplink-hub-and-loader-design.md). Proves,
 * in a REAL browser on all three engines, that:
 *
 *  1. behind `?uplinkLoader=1` the SCANsat client is NOT statically bundled — it
 *     is fetched as a standalone ESM bundle (/uplinks/scansat.client.js) and
 *     import()ed at runtime, its bare imports resolving through the baked import
 *     map to the app's singleton chunks, so its module-load registerComponent
 *     writes into the app's ONE registry (the `scanning` widget appears);
 *  2. the injected SDK host is installed on globalThis;
 *  3. flag OFF, `scanning` is still present via the bundled static import — the
 *     fallback the design forbids removing until the loaded path is triple-engine
 *     green (§6 / R9).
 *
 * Runs against the production `vite preview` webServer (PORTS.preview): the loader
 * mechanism is build-only, so the dev server every other spec uses can't exercise
 * it. import()ing a bare specifier inside page.evaluate uses the document's import
 * map — the same singleton-preservation mechanism the loaded Uplink relies on.
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

test.describe("Uplink loader (Phase A)", () => {
  test("SCANsat loads via the runtime loader into the singleton registry", async ({
    page,
  }) => {
    const bundleFetched = page.waitForResponse(
      (r) => r.url().includes("/uplinks/scansat.client.js") && r.ok(),
      { timeout: 30_000 },
    );

    await page.goto(`${PREVIEW}/?uplinkLoader=1`, { waitUntil: "load" });

    // The standalone bundle was fetched by the loader (not statically imported).
    const resp = await bundleFetched;
    expect(resp.status()).toBe(200);

    // Singleton proof: the loaded bundle's registerComponent wrote into the app's
    // ONE registry — `scanning` is present, resolved through the import map.
    await expect
      .poll(
        async () => (await registeredComponentIds(page)).includes("scanning"),
        {
          timeout: 15_000,
        },
      )
      .toBe(true);

    // The injected SDK host is installed.
    const hostInstalled = await page.evaluate(
      () =>
        "__GONOGO_SDK__" in globalThis &&
        Boolean((globalThis as Record<string, unknown>).__GONOGO_SDK__),
    );
    expect(hostInstalled).toBe(true);
  });

  test("flag OFF keeps SCANsat via the bundled static import (fallback intact)", async ({
    page,
  }) => {
    let loaderBundleRequested = false;
    page.on("request", (r) => {
      if (r.url().includes("/uplinks/scansat.client.js")) {
        loaderBundleRequested = true;
      }
    });

    await page.goto(`${PREVIEW}/`, { waitUntil: "load" });

    // `scanning` is still present — via the bundled static import, not the loader.
    await expect
      .poll(
        async () => (await registeredComponentIds(page)).includes("scanning"),
        {
          timeout: 15_000,
        },
      )
      .toBe(true);

    // The loader path did not run: the standalone bundle was never fetched.
    expect(loaderBundleRequested).toBe(false);
  });
});
