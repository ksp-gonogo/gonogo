/**
 * Notes widget round-trip. Both main and station are seeded with a
 * dashboard config that places a Notes widget on the grid before the
 * page boots — sidesteps the FAB/modal click chain that's brittle to
 * pixel-level z-index inside RGL.
 *
 * Asserts:
 *   1. A note typed on main appears on station within a few seconds.
 *   2. A subsequent note typed on station appears on main, alongside
 *      the original.
 *
 * Both directions matter because the wire is asymmetric — the host
 * owns NotesHostService and broadcasts the canonical snapshot; the
 * station mutates via NotesClientService which sends action messages
 * the host applies and re-broadcasts.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

const MAIN_URL = "/";
const STATION_URL = "/station";

const SITREP_CONFIG = JSON.stringify({
  host: "localhost",
  port: PORTS.sitrepReplay,
});

const NOTES_INPUT_LABEL = "New note body (use {{ to insert a variable)";

interface DashboardItem {
  i: string;
  componentId: string;
}

// Pre-populated dashboard with a single Notes widget. `i` and the
// matching layout entry must agree; RGL drops items whose `i` isn't
// present in the layout.
const dashboardWithNotes = (i = "notes-1") => ({
  items: [{ i, componentId: "notes" }] satisfies DashboardItem[],
  layouts: {
    lg: [{ i, x: 0, y: 0, w: 8, h: 6, moved: false, static: false }],
    md: [{ i, x: 0, y: 0, w: 8, h: 6, moved: false, static: false }],
    sm: [{ i, x: 0, y: 0, w: 6, h: 6, moved: false, static: false }],
    xs: [{ i, x: 0, y: 0, w: 4, h: 6, moved: false, static: false }],
    xxs: [{ i, x: 0, y: 0, w: 2, h: 6, moved: false, static: false }],
  },
});

async function seedContext(
  context: BrowserContext,
  dashboardKey: "gonogo:dashboard:main" | "gonogo:dashboard:station",
): Promise<void> {
  const dashboard = JSON.stringify(dashboardWithNotes());
  await context.addInitScript(
    ({
      sitrepCfg,
      dashboardKey,
      dashboard,
    }: {
      sitrepCfg: string;
      dashboardKey: string;
      dashboard: string;
    }) => {
      try {
        localStorage.setItem("gonogo.datasource.sitrep", sitrepCfg);
        localStorage.setItem(dashboardKey, dashboard);
        // Pre-answer analytics consent so the blocking boot modal doesn't
        // sit over the dashboard and swallow the note-input click.
        localStorage.setItem("gonogo.analytics.consent", "disabled");
        // The first-run Uplink Hub wizard auto-opens the Settings modal on a
        // fresh browser (own unit/component coverage in
        // UplinkHubWizardHost.test.tsx; e2e coverage in
        // uplink-hub-wizard.spec.ts) — mark it already-seen so it doesn't
        // sit over the dashboard and swallow the note-input click too.
        localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
      } catch {
        /* private mode / quota — ignore */
      }
    },
    { sitrepCfg: SITREP_CONFIG, dashboardKey, dashboard },
  );
}

// Wait for the host peer to open, then return its share code — the station
// derives `gonogo-host-<code>` and connects directly (stable-host-id model).
async function getHostPeerId(page: Page): Promise<string> {
  return await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          peerHostService?: { peerId?: string | null; shareCode?: string };
        };
        const svc = w.peerHostService;
        if (!svc) return null;
        if (typeof svc.peerId !== "string" || svc.peerId.length === 0) {
          return null;
        }
        const code = svc.shareCode;
        return typeof code === "string" && /^[A-Z0-9]{4,}$/.test(code)
          ? code
          : null;
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    )
    .then((handle) => handle.jsonValue() as Promise<string>);
}

async function addNote(page: Page, body: string): Promise<void> {
  const input = page.getByLabel(NOTES_INPUT_LABEL);
  await input.click();
  await input.fill(body);
  // Enter submits (no Shift held). Matches the production keybinding.
  await input.press("Enter");
  // Input is cleared on submit — wait for that to confirm the action
  // landed locally before asserting the cross-screen propagation.
  await expect(input).toHaveValue("");
}

test.describe("notes widget round-trip", () => {
  test("notes typed on either screen propagate to the other", async ({
    browser,
  }) => {
    const mainContext = await browser.newContext();
    await seedContext(mainContext, "gonogo:dashboard:main");
    const stationContext = await browser.newContext();
    await seedContext(stationContext, "gonogo:dashboard:station");

    const main = await mainContext.newPage();
    await main.goto(MAIN_URL);
    await expect(main.getByLabel(NOTES_INPUT_LABEL)).toBeVisible({
      timeout: 30_000,
    });
    const peerId = await getHostPeerId(main);

    const station = await stationContext.newPage();
    await station.goto(`${STATION_URL}?host=${peerId}`);
    await expect(station.getByLabel(NOTES_INPUT_LABEL)).toBeVisible({
      timeout: 30_000,
    });

    // Main → station.
    const mainNote = `Burn at MET+05:00 — note from main ${Date.now()}`;
    await addNote(main, mainNote);
    await expect(station.getByText(mainNote, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Station → main, with the previous note still present.
    const stationNote = `Confirmed burn — note from station ${Date.now()}`;
    await addNote(station, stationNote);
    await expect(main.getByText(stationNote, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // The original main note is still rendered on both — neither
    // mutation should have clobbered the prior snapshot.
    await expect(main.getByText(mainNote, { exact: true })).toBeVisible();
    await expect(station.getByText(mainNote, { exact: true })).toBeVisible();

    await main.close();
    await station.close();
    await mainContext.close();
    await stationContext.close();
  });
});
