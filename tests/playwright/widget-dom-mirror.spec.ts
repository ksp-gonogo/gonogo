/**
 * Widget-level mirror test. Boots both screens with a CurrentOrbit
 * widget pre-placed on the dashboard and asserts the rendered Ap value
 * matches on host and station — the data-flow tests only prove values
 * reach the data source layer; this one proves they reach the DOM.
 *
 * The fixture's o.ApA is 247904.88 m; formatDistance renders that as
 * "247.9 km". The test asserts that string is visible on both screens
 * (loose match — formatDistance is exercised in unit tests; we only
 * need to confirm the same value flowed through both render paths).
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

const MAIN_URL = "/";
const STATION_URL = "/station";
const TELEMACHUS_CONFIG = JSON.stringify({
  host: "localhost",
  port: PORTS.telemachusReplay,
});

const dashboardWithOrbit = () => ({
  items: [{ i: "orbit", componentId: "current-orbit" }],
  layouts: {
    lg: [{ i: "orbit", x: 0, y: 0, w: 4, h: 6, moved: false, static: false }],
    md: [{ i: "orbit", x: 0, y: 0, w: 4, h: 6, moved: false, static: false }],
    sm: [{ i: "orbit", x: 0, y: 0, w: 4, h: 6, moved: false, static: false }],
    xs: [{ i: "orbit", x: 0, y: 0, w: 4, h: 6, moved: false, static: false }],
    xxs: [{ i: "orbit", x: 0, y: 0, w: 2, h: 6, moved: false, static: false }],
  },
});

async function seedContext(
  context: BrowserContext,
  dashboardKey: "gonogo:dashboard:main" | "gonogo:dashboard:station",
): Promise<void> {
  const dashboard = JSON.stringify(dashboardWithOrbit());
  await context.addInitScript(
    ({
      teleCfg,
      dashboardKey,
      dashboard,
    }: {
      teleCfg: string;
      dashboardKey: string;
      dashboard: string;
    }) => {
      try {
        localStorage.setItem("gonogo.datasource.telemachus", teleCfg);
        localStorage.setItem(dashboardKey, dashboard);
      } catch {
        /* ignore */
      }
    },
    {
      teleCfg: TELEMACHUS_CONFIG,
      dashboardKey,
      dashboard,
    },
  );
}

async function getHostPeerId(page: Page): Promise<string> {
  return await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          peerHostService?: {
            peerId?: string | null;
            __lastIdSeen?: string | null;
            __lastIdSeenAt?: number;
          };
        };
        const svc = w.peerHostService;
        if (!svc) return null;
        const id = svc.peerId;
        if (typeof id !== "string" || !/^[A-Z0-9]{4,}$/.test(id)) {
          svc.__lastIdSeen = null;
          return null;
        }
        if (svc.__lastIdSeen !== id) {
          svc.__lastIdSeen = id;
          svc.__lastIdSeenAt = Date.now();
          return null;
        }
        if (Date.now() - (svc.__lastIdSeenAt ?? 0) >= 500) return id;
        return null;
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    )
    .then((handle) => handle.jsonValue() as Promise<string>);
}

/**
 * Read the rendered "Ap" value from the ORBIT panel. The panel doesn't
 * have a structural test-id, so locate by the panel title text and walk
 * to the first value cell after the "Ap" label. waitForFunction polls
 * until the value parses as `<digits>.<digits> km` (matches
 * formatDistance's km-range output for the fixture's apoapsis).
 */
async function readOrbitAp(page: Page): Promise<string> {
  const handle = await page.waitForFunction(
    () => {
      // Find the ORBIT panel by its title text, then walk up to the
      // panel container. The panel renders Label/Value rows in DOM
      // order: Ap label, Ap value, Pe label, Pe value, …
      const titles = Array.from(document.querySelectorAll("*")).filter(
        (el) => el.textContent?.trim() === "ORBIT",
      );
      for (const title of titles) {
        const panel = title.parentElement;
        if (!panel) continue;
        const labels = Array.from(panel.querySelectorAll("*")).filter(
          (el) => el.textContent?.trim() === "Ap",
        );
        if (labels.length === 0) continue;
        const apLabel = labels[0];
        // The matching value is the next sibling in the grid — walk to
        // the next element on the same level whose text matches the
        // km/Mm/Gm pattern that formatDistance emits in the relevant
        // range.
        let cursor: Element | null = apLabel.nextElementSibling;
        while (cursor) {
          const txt = cursor.textContent?.trim() ?? "";
          if (/^[-\d]+(\.\d+)?\s*(km|Mm|Gm|Tm|m)$/.test(txt)) return txt;
          cursor = cursor.nextElementSibling;
        }
      }
      return null;
    },
    undefined,
    { timeout: 30_000, polling: 250 },
  );
  return await handle.jsonValue();
}

test.describe("widget DOM mirror", () => {
  test("CurrentOrbit renders the same Ap on host and station", async ({
    browser,
  }) => {
    const mainContext = await browser.newContext();
    await seedContext(mainContext, "gonogo:dashboard:main");
    const stationContext = await browser.newContext();
    await seedContext(stationContext, "gonogo:dashboard:station");

    const main = await mainContext.newPage();
    await main.goto(MAIN_URL);
    await expect(main.getByText("ORBIT", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const peerId = await getHostPeerId(main);

    const station = await stationContext.newPage();
    await station.goto(`${STATION_URL}?host=${peerId}`);
    await expect(station.getByText("ORBIT", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const mainAp = await readOrbitAp(main);
    const stationAp = await readOrbitAp(station);

    // Both should land on the canonical snapshot value (247.9 km in the
    // recorded fixture). Strict equality — formatDistance is
    // deterministic, the underlying o.ApA is the snapshot's frozen last
    // value, and the periodic 250ms re-emit doesn't mutate it.
    expect(mainAp).toBe("247.9 km");
    expect(stationAp).toBe(mainAp);

    await main.close();
    await station.close();
    await mainContext.close();
    await stationContext.close();
  });
});
