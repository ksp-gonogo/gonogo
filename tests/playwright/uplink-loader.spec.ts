import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

/**
 * Dual-path smoke test for the production Uplink client loader (design
 * docs/superpowers/specs/2026-07-17-uplink-hub-and-loader-design.md). Proves, in a
 * REAL browser on all three engines, that BOTH first-party Uplinks (scansat + kos):
 *
 *  1. behind `?uplinkLoader=1` are NOT statically bundled — each is fetched as a
 *     standalone ESM bundle (/uplinks/<id>.client.js) and import()ed at runtime,
 *     its bare imports resolving through the baked import map to the app's
 *     singleton chunks, so its module-load registerComponent writes into the app's
 *     ONE registry (`scanning` + `kos-processors` both appear);
 *  2. the injected SDK host is installed on globalThis;
 *  3. flag OFF, both widgets are still present via the bundled static imports — the
 *     fallback the design forbids removing until the loaded path is triple-engine
 *     green (§6 / R9) — and NEITHER loader bundle is requested.
 *
 * Consent: the loader gates each first load at a new id@version behind operator
 * consent (design §3.5). The loaded-path test seeds a remembered grant in
 * localStorage so the load reaches import() without a manual modal click.
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

test.describe("Uplink loader (dual-path)", () => {
  test("scansat + kos load via the runtime loader into the singleton registry", async ({
    page,
  }) => {
    // Establish the origin, then seed consent so the flagged reload reaches import().
    await page.goto(`${PREVIEW}/`, { waitUntil: "load" });
    await seedConsent(page);

    const scansatFetched = page.waitForResponse(
      (r) => r.url().includes("/uplinks/scansat.client.js") && r.ok(),
      { timeout: 30_000 },
    );
    const kosFetched = page.waitForResponse(
      (r) => r.url().includes("/uplinks/kos.client.js") && r.ok(),
      { timeout: 30_000 },
    );

    await page.goto(`${PREVIEW}/?uplinkLoader=1`, { waitUntil: "load" });

    // Both standalone bundles were fetched by the loader (not statically imported).
    expect((await scansatFetched).status()).toBe(200);
    expect((await kosFetched).status()).toBe(200);

    // Singleton proof: each loaded bundle's registerComponent wrote into the app's
    // ONE registry — a scansat widget (`scanning`) and a kos widget
    // (`kos-processors`) are both present, resolved through the import map.
    await expect
      .poll(
        async () => {
          const ids = await registeredComponentIds(page);
          return ids.includes("scanning") && ids.includes("kos-processors");
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
  });

  test("flag OFF keeps scansat + kos via the bundled static imports (fallback intact)", async ({
    page,
  }) => {
    let loaderBundleRequested = false;
    page.on("request", (r) => {
      if (
        r.url().includes("/uplinks/scansat.client.js") ||
        r.url().includes("/uplinks/kos.client.js")
      ) {
        loaderBundleRequested = true;
      }
    });

    await page.goto(`${PREVIEW}/`, { waitUntil: "load" });

    // Both widgets are still present — via the bundled static imports, not the loader.
    await expect
      .poll(
        async () => {
          const ids = await registeredComponentIds(page);
          return ids.includes("scanning") && ids.includes("kos-processors");
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // The loader path did not run: neither standalone bundle was fetched.
    expect(loaderBundleRequested).toBe(false);
  });
});
