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
 * Read the host's public peer id directly off the global peerHostService.
 * Skips the FAB-click path because the dashboard grid layer intercepts
 * pointer events at the FAB's screen position — the share code is also
 * surfaced as a data-testid for UI-clicking tests, but for plumbing
 * verification the in-page service is the source of truth.
 *
 * Polls because the broker `open` event is async (~hundreds of ms on a
 * cold local broker; many seconds on the public broker). 20s timeout
 * matches the longest realistic local-broker handshake.
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
        return typeof id === "string" && /^[A-Z0-9]{4,}$/.test(id) ? id : null;
      },
      undefined,
      { timeout: 30_000 },
    )
    .then((handle) => handle.jsonValue() as Promise<string>);
}

/**
 * Read the host's stable share-code + confirm it has registered with the
 * relay (so the relay's directory peer for that code is up on the broker).
 * `relayRegistered` flips true once `POST /host` returns 2xx, which is the
 * same event that fires the relay's `onRegister` → `directoryPeers.ensure`.
 * We then wait an extra beat for the directory peer's own broker `open`.
 */
async function getRegisteredShareCode(page: Page): Promise<string> {
  return await page
    .waitForFunction(
      () => {
        const w = window as unknown as {
          peerHostService?: {
            shareCode?: string;
            relayRegistered?: boolean;
          };
        };
        const svc = w.peerHostService;
        if (!svc?.relayRegistered) return null;
        const code = svc.shareCode;
        return typeof code === "string" && code.length > 0 ? code : null;
      },
      undefined,
      { timeout: 30_000, polling: 200 },
    )
    .then((handle) => handle.jsonValue() as Promise<string>);
}

test.describe("station resolves a share-code via the relay directory peer", () => {
  // The cross-machine path: the station is given ONLY the host's stable
  // share-code (not its ephemeral peer id). The only way it reaches the
  // host is by resolving that code over the broker via the relay's
  // `gonogo-dir-<code>` directory peer. A passing handshake here is genuine
  // end-to-end coverage of the directory resolve — the 4s direct-connect
  // fallback can't be what carries it, because the share-code is not a
  // valid host peer id (asserted below).
  test("connects when handed only the share-code", async ({ browser }) => {
    const mainContext = await browser.newContext();
    const stationContext = await browser.newContext();

    const main = await mainContext.newPage();
    await main.goto(MAIN_URL);
    await expect(
      main.getByRole("button", { name: /add component/i }),
    ).toBeVisible({ timeout: 30_000 });

    const peerId = await getMainPeerId(main);
    const shareCode = await getRegisteredShareCode(main);
    // The share-code and the ephemeral peer id are independent identities —
    // if they ever coincided, a "connected" station wouldn't prove the
    // directory resolved anything (the fallback would reach the host
    // directly).
    expect(shareCode).not.toBe(peerId);

    const station = await stationContext.newPage();
    await station.goto(`${STATION_URL}?host=${shareCode}`);

    // Reaching the dashboard means the station resolved the share-code to
    // the host's peer id over the broker and completed the data handshake.
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

    const peerId = await getMainPeerId(main);

    // Station opens with the main's share code in the URL. Skips the
    // "Connect" form — the host param triggers auto-connect.
    const station = await stationContext.newPage();
    await station.goto(`${STATION_URL}?host=${peerId}`);

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
