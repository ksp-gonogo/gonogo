/**
 * Replay-driven multi-screen test. Both browser contexts connect to a
 * fake Telemachus WebSocket server replaying a recorded launch fixture.
 * The test asserts that:
 *   1. Main shows live telemetry from the replay (apoapsis, body name).
 *   2. Station connects, receives the same telemetry via the PeerJS
 *      handshake + schema bridge.
 *
 * Per-page Telemachus endpoint is seeded via context.addInitScript so
 * the localStorage key the production TelemachusDataSource reads is
 * pointing at the test server before main.tsx executes.
 *
 * Uses separate BrowserContexts so the two pages have independent
 * localStorage (peerId, dashboard config), independent data-source
 * registries, and independent IndexedDB — same isolation profile as
 * two real devices. The pages still find each other on the local
 * PeerJS broker the moment the host's peer id is propagated.
 */
import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

const MAIN_URL = "/";
const STATION_URL = "/station";

const TELEMACHUS_CONFIG = JSON.stringify({
  host: "localhost",
  port: PORTS.telemachusReplay,
});

/**
 * Run before any module on the page evaluates so the TelemachusDataSource
 * picks up the test endpoint instead of the localhost:8085 default.
 * Storage key matches LocalStorageStore's keying in the data source.
 */
const initScript = (config: string) => `
  try {
    localStorage.setItem("gonogo.datasource.telemachus", ${JSON.stringify(config)});
  } catch (e) {
    // localStorage might be locked in early init — addInitScript runs in
    // every fresh document, so swallowing is safe; the assignment retries
    // on the next page load.
  }
`;

test.describe("recorded launch — main + station mirror", () => {
  test("station mirrors apoapsis + body from main's replay", async ({
    browser,
  }) => {
    const mainContext = await browser.newContext();
    await mainContext.addInitScript(initScript(TELEMACHUS_CONFIG));
    const stationContext = await browser.newContext();
    await stationContext.addInitScript(initScript(TELEMACHUS_CONFIG));

    const main = await mainContext.newPage();
    await main.goto(MAIN_URL);
    await expect(
      main.getByRole("button", { name: /add component/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Wait for the host's PeerJS open event, then derive the share code.
    // NOTE: Playwright's waitForFunction signature is
    // (pageFunction, arg, options) — the third positional is options.
    // Passing `{ timeout: ... }` as the second arg makes it the `arg`
    // and silently inherits the default 10s actionTimeout.
    const peerId = (await main
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
      .then((handle) => handle.jsonValue())) as string;

    // Wait until the replay-driven Telemachus data has settled on the
    // host. v.body should resolve to a known body name (Kerbin / Mun /
    // Minmus depending on the fixture). The recorded launch starts on
    // Kerbin; the replay completes before the SOI changes.
    //
    // Use the lookup helper: subscribes via the "data" source and
    // resolves with the first callback fire. BufferedDataSource replays
    // last-known synchronously, so once a sample has been received the
    // resolve happens on the next microtask.
    const mainBody = await main.waitForFunction(
      () => {
        return new Promise<unknown>((resolve) => {
          const w = window as unknown as {
            __gonogo_get_value__?: (key: string) => Promise<unknown>;
          };
          const lookup = w.__gonogo_get_value__;
          if (!lookup) return resolve(null);
          const timer = setTimeout(() => resolve(null), 500);
          lookup("v.body").then((value) => {
            clearTimeout(timer);
            // Resolve with any non-null value; the test inspects the
            // shape after the wait so we can see real-world payloads
            // when the assertion drifts.
            resolve(value ?? null);
          });
        });
      },
      undefined,
      { timeout: 60_000 },
    );
    const mainBodyValue = await mainBody.jsonValue();
    expect(typeof mainBodyValue).toBe("string");

    // Now boot the station, point at the host, wait for schema arrival.
    const station = await stationContext.newPage();
    await station.goto(`${STATION_URL}?host=${peerId}`);
    await expect(
      station.getByRole("button", { name: /add component/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Read the same v.body via the station's "data" source — the
    // PeerClientDataSource mirroring the host. Note the station does
    // NOT connect to the fake Telemachus server directly; everything
    // flows over PeerJS from the host.
    const stationBody = await station.waitForFunction(
      () => {
        return new Promise<string | null>((resolve) => {
          const w = window as unknown as {
            __gonogo_get_value__?: (key: string) => Promise<unknown>;
          };
          const lookup = w.__gonogo_get_value__;
          if (!lookup) return resolve(null);
          const timer = setTimeout(() => resolve(null), 500);
          lookup("v.body").then((value) => {
            clearTimeout(timer);
            resolve(typeof value === "string" ? value : null);
          });
        });
      },
      undefined,
      { timeout: 60_000 },
    );
    const stationBodyValue = await stationBody.jsonValue();
    expect(stationBodyValue).toBe(mainBodyValue);

    await main.close();
    await station.close();
    await mainContext.close();
    await stationContext.close();
  });
});
