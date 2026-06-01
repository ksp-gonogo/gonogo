/**
 * Multi-screen integration test — boots the real app in two browser
 * contexts (main + station), waits for the PeerJS handshake against the
 * local broker, asserts the station picks up the main's schema.
 *
 * This is the minimum-viable plumbing test: it proves the broker config
 * override works, both screens boot, and they can find each other. The
 * fixture-driven telemetry assertions (recorded-flight replay, station
 * mirrors widget values) layer on top of this once we have a way to
 * inject a test data source per page — TODO in a follow-up.
 */
import { expect, type Page, test } from "@playwright/test";

const MAIN_URL = "/";
const STATION_URL = "/station";

/**
 * Read the host's derived broker peer id (`gonogo-host-<code>`) off the
 * global peerHostService once it has opened. Used only to assert it differs
 * from the share code; the station never connects with this directly.
 *
 * Polls because the broker `open` event is async (~hundreds of ms on a
 * cold local broker; many seconds on the public broker).
 */
async function getMainPeerId(page: Page): Promise<string> {
  // Playwright's waitForFunction is `(fn, arg, options)` — passing the
  // options object as the second arg makes it `arg` and silently
  // inherits the default 10s actionTimeout.
  return await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          peerHostService?: { peerId?: string | null };
        };
        const id = w.peerHostService?.peerId;
        return typeof id === "string" && /^gonogo-host-[A-Z0-9]{4,}$/.test(id)
          ? id
          : null;
      },
      undefined,
      { timeout: 30_000 },
    )
    .then((handle) => handle.jsonValue() as Promise<string>);
}

/**
 * Wait for the host peer to open, then return its stable share code — the
 * token the station uses to derive the host's id and connect directly.
 */
async function getHostShareCode(page: Page): Promise<string> {
  return await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          peerHostService?: { peerId?: string | null; shareCode?: string };
        };
        const svc = w.peerHostService;
        if (!svc || typeof svc.peerId !== "string" || svc.peerId.length === 0) {
          return null;
        }
        const code = svc.shareCode;
        return typeof code === "string" && code.length > 0 ? code : null;
      },
      undefined,
      { timeout: 30_000, polling: 200 },
    )
    .then((handle) => handle.jsonValue() as Promise<string>);
}

test.describe("station connects directly via the share code", () => {
  // Stable-host-id model: the station is handed ONLY the operator's 4-char
  // share code (not the host's broker peer id). It derives `gonogo-host-<code>`
  // and connects to that on the broker directly — no resolve hop. The share
  // code and the derived peer id are distinct (asserted below), so a passing
  // handshake proves the derive-and-connect path end to end.
  test("connects when handed only the share-code", async ({ browser }) => {
    const mainContext = await browser.newContext();
    const stationContext = await browser.newContext();

    const main = await mainContext.newPage();
    await main.goto(MAIN_URL);
    await expect(
      main.getByRole("button", { name: /add component/i }),
    ).toBeVisible({ timeout: 30_000 });

    const peerId = await getMainPeerId(main);
    const shareCode = await getHostShareCode(main);
    // The 4-char share code is NOT the host's broker peer id — the station
    // derives the id from the code, it isn't handed it.
    expect(shareCode).not.toBe(peerId);

    const station = await stationContext.newPage();
    await station.goto(`${STATION_URL}?host=${shareCode}`);

    // Reaching the dashboard means the station derived the host's id from the
    // share code, connected over the broker, and completed the data handshake.
    await expect(
      station.getByRole("button", { name: /add component/i }),
    ).toBeVisible({ timeout: 30_000 });

    await main.close();
    await station.close();
    await mainContext.close();
    await stationContext.close();
  });
});

test.describe("main + station co-resident", () => {
  test("station handshakes with main over the local broker", async ({
    browser,
  }) => {
    const mainContext = await browser.newContext();
    const stationContext = await browser.newContext();

    const main = await mainContext.newPage();
    await main.goto(MAIN_URL);

    // Main eventually opens its PeerJS connection — the dashboard renders
    // first (so the assertion isn't gated on widgets that might take time
    // to mount), then the StationLink FAB is reachable.
    await expect(
      main.getByRole("button", { name: /add component/i }),
    ).toBeVisible({
      timeout: 30_000,
    });

    const shareCode = await getHostShareCode(main);

    // Station opens with the main's share code in the URL. Skips the
    // "Connect" form — the host param triggers auto-connect (the station
    // derives `gonogo-host-<code>` and connects directly).
    const station = await stationContext.newPage();
    await station.goto(`${STATION_URL}?host=${shareCode}`);

    // The schema-arrival flip is the cleanest "we're connected" signal.
    // Until the host's schema lands, the station sits on the connection
    // screen. Once it lands, the dashboard mounts and the FAB cluster
    // appears.
    await expect(
      station.getByRole("button", { name: /add component/i }),
    ).toBeVisible({ timeout: 30_000 });

    await main.close();
    await station.close();
    await mainContext.close();
    await stationContext.close();
  });
});
