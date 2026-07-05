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
import { expect, type Page, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

const MAIN_URL = "/";
const STATION_URL = "/station";

const TELEMACHUS_CONFIG = JSON.stringify({
  host: "localhost",
  port: PORTS.telemachusReplay,
});

/**
 * Keys we expect to mirror host→station, with the predicate that proves
 * the value has arrived (and isn't an "undefined / null / NaN" placeholder
 * the lookup helper sometimes returns mid-warmup). Each is sampled from
 * the recorded fixture's final state so the assertion is concrete.
 *
 * Keep this small — one key per shape (string, number, object, boolean).
 * The point is to exercise PBDS's wire format, not to re-test
 * Telemachus's key surface.
 */
const MIRRORED_KEYS: ReadonlyArray<{
  key: string;
  shape: "string" | "number" | "boolean";
}> = [
  { key: "v.body", shape: "string" }, // string identity
  { key: "v.name", shape: "string" }, // string identity
  { key: "o.ApA", shape: "number" }, // number, drifts across ticks
  { key: "r.resource[ElectricCharge]", shape: "number" }, // indexed key
  { key: "comm.connected", shape: "boolean" }, // boolean, exercises the signal-loss gate path
];

/**
 * Run before any module on the page evaluates so the TelemachusDataSource
 * picks up the test endpoint instead of the localhost:8085 default.
 * Storage key matches LocalStorageStore's keying in the data source.
 */
const initScript = (config: string) => `
  try {
    localStorage.setItem("gonogo.datasource.telemachus", ${JSON.stringify(config)});
    // Pre-answer analytics consent so the blocking boot modal doesn't sit
    // over the dashboard — without this it stays open for the whole test
    // (see helpers.ts's seedContext, which every other multi-screen spec
    // routes through).
    localStorage.setItem("gonogo.analytics.consent", "disabled");
  } catch (e) {
    // localStorage might be locked in early init — addInitScript runs in
    // every fresh document, so swallowing is safe; the assignment retries
    // on the next page load.
  }
`;

/**
 * Wait until `__gonogo_get_value__(key)` returns a value matching `shape`,
 * then return it.
 *
 * Polls from the Node side via plain `page.evaluate` calls rather than a
 * single `page.waitForFunction` whose page-side predicate returns a
 * `new Promise(...)`. That nested-promise-inside-waitForFunction pattern
 * turned out to be unreliable on the Firefox driver specifically: under the
 * load of a long test run, Firefox's polling would occasionally accept an
 * unsettled/falsy intermediate resolution as "done", short-circuiting to
 * `null` well before the 60s timeout instead of retrying (reproduced by
 * running this spec after ~30 preceding tests in the same firefox project —
 * it never reproduced in isolation). A plain per-attempt `evaluate` +
 * Node-side delay sidesteps the driver's promise-polling code path
 * entirely and behaves identically across engines.
 */
async function waitForValue(
  page: Page,
  key: string,
  shape: "string" | "number" | "boolean",
): Promise<unknown> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const value = await page.evaluate((key: string) => {
      const w = window as unknown as {
        __gonogo_get_value__?: (key: string) => Promise<unknown>;
      };
      const lookup = w.__gonogo_get_value__;
      return lookup ? lookup(key) : null;
    }, key);
    const matches =
      shape === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : typeof value === shape;
    if (matches) return value;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForValue: "${key}" never resolved to shape "${shape}" within 60s (last value: ${JSON.stringify(value)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.describe("recorded launch — main + station mirror", () => {
  test("station mirrors a representative slice of host telemetry", async ({
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

    // Wait for the host's PeerJS open event AND for the id to be stable.
    // The local broker can hold a stale id from a prior test run for
    // ~30-60s; the host detects the conflict and auto-rotates, which
    // would race with the test if we grabbed the first id we saw. Poll
    // until the id hasn't changed for 500ms, then take that as final.
    //
    // NOTE: Playwright's waitForFunction signature is
    // (pageFunction, arg, options) — the third positional is options.
    // Passing `{ timeout: ... }` as the second arg makes it the `arg`
    // and silently inherits the default 10s actionTimeout.
    // Wait for the host peer to open, then take its share code — the station
    // derives `gonogo-host-<code>` and connects directly (stable-host-id model).
    const peerId = (await main
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
      .then((handle) => handle.jsonValue())) as string;

    // Wait for the host's view to settle: every key in MIRRORED_KEYS
    // resolves to a value of the expected shape. The fake server emits
    // its snapshot frame on subscribe and then every 250ms — matches
    // Telemachus Reborn's `rate` behaviour and makes
    // BufferedDataSource's async-IDB-hydrate-then-subscribe race safe
    // (the next tick re-delivers values to the late subscriber).
    const mainValues: Record<string, unknown> = {};
    for (const { key, shape } of MIRRORED_KEYS) {
      mainValues[key] = await waitForValue(main, key, shape);
    }
    for (const { key, shape } of MIRRORED_KEYS) {
      if (shape === "number") {
        expect(Number.isFinite(mainValues[key])).toBe(true);
      } else {
        expect(typeof mainValues[key]).toBe(shape);
      }
    }

    // Now boot the station, point at the host, wait for schema arrival.
    const station = await stationContext.newPage();
    await station.goto(`${STATION_URL}?host=${peerId}`);
    await expect(
      station.getByRole("button", { name: /add component/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Mirror assertions: each key's station value matches the host's.
    // The station does NOT connect to the fake Telemachus server
    // directly; values flow over PeerJS from the host's PBDS.
    //
    // Numeric keys (e.g. o.ApA) drift between host-read and station-read
    // because the replay server re-emits every 250ms — so we accept any
    // finite number on the station side rather than strict equality. The
    // shape match is what proves PBDS handled the wire format; exact
    // value equality is asserted only for stable identity keys (string,
    // boolean).
    for (const { key, shape } of MIRRORED_KEYS) {
      const stationValue = await waitForValue(station, key, shape);
      if (shape === "number") {
        expect(Number.isFinite(stationValue)).toBe(true);
      } else {
        expect(stationValue).toBe(mainValues[key]);
      }
    }

    await main.close();
    await station.close();
    await mainContext.close();
    await stationContext.close();
  });
});
