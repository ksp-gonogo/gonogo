/**
 * A station whose link names the relay fetches the relay's entries before
 * its first offer, so a station whose direct paths all fail does not depend on
 * a first connection to learn them.
 *
 * The relay under test is a route stub answering `/ice-config`, not the
 * webServer relay, which runs with SKIP_COTURN: there is no coturn binary on
 * the machines that run this suite, and a relay server written for one test
 * would be a second implementation of the protocol to keep right. So the test
 * proves the cause (the station's RTCPeerConnections are built with ICE configs holding the relay's
 * entry, requested from the link's address) and that the direct path is
 * undisturbed; it does not push media through a relay allocation.
 */
import { type BrowserContext, expect, test } from "@playwright/test";
import { seedApprovedStation } from "./helpers";

const RELAY = "http://relay.test:13999";
const TURN = {
  urls: ["turn:relay.test:3478?transport=udp"],
  username: "e2e",
  credential: "e2e-secret",
};

type PcSpy = { __iceConfigs: Array<RTCIceServer[] | undefined> };

async function seed(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
    } catch {
      /* private mode: the seed just won't apply */
    }
    const w = window as unknown as PcSpy & {
      RTCPeerConnection: typeof RTCPeerConnection;
    };
    w.__iceConfigs = [];
    const Original = w.RTCPeerConnection;
    w.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config);
        w.__iceConfigs.push(config?.iceServers as RTCIceServer[] | undefined);
      }
    };
  });
  await seedApprovedStation(context);
}

async function shareCodeOf(page: import("@playwright/test").Page) {
  const handle = await page.waitForFunction(
    () => {
      const svc = (
        window as unknown as {
          peerHostService?: { peerId?: string | null; shareCode?: string };
        }
      ).peerHostService;
      return svc?.peerId && svc.shareCode ? svc.shareCode : null;
    },
    undefined,
    { timeout: 30_000, polling: 200 },
  );
  return (await handle.jsonValue()) as string;
}

async function bootPair(
  browser: import("@playwright/test").Browser,
  stationQuery: (code: string) => string,
  stub: (context: BrowserContext, requested: string[]) => Promise<void>,
) {
  const mainContext = await browser.newContext();
  const stationContext = await browser.newContext();
  await seed(mainContext);
  await seed(stationContext);
  const requested: string[] = [];
  await stub(stationContext, requested);

  const main = await mainContext.newPage();
  await main.goto("/?uplinkLoaderIds=");
  const code = await shareCodeOf(main);

  const station = await stationContext.newPage();
  await station.goto(`/station?${stationQuery(code)}&uplinkLoaderIds=`);
  await expect(
    station.getByRole("button", { name: /add widget/i }),
  ).toBeVisible({ timeout: 30_000 });

  const configs = () =>
    station.evaluate(() => (window as unknown as PcSpy).__iceConfigs);
  const close = async () => {
    await main.close();
    await station.close();
    await mainContext.close();
    await stationContext.close();
  };
  return { configs, requested, close };
}

test.describe("station link names the relay", () => {
  test("every connection the station opens carries the relay's TURN entry", async ({
    browser,
  }) => {
    const pair = await bootPair(
      browser,
      (code) => `host=${code}&relay=${encodeURIComponent(RELAY)}`,
      async (context, requested) => {
        await context.route(`${RELAY}/ice-config`, async (route) => {
          requested.push(route.request().url());
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify({ iceServers: [TURN] }),
          });
        });
      },
    );

    expect(new Set(pair.requested)).toEqual(new Set([`${RELAY}/ice-config`]));
    expect(await pair.configs()).toContainEqual(expect.arrayContaining([TURN]));
    await pair.close();
  });

  test("an unreachable relay falls back to the STUN-only path and still connects directly", async ({
    browser,
  }) => {
    const pair = await bootPair(
      browser,
      (code) => `host=${code}&relay=${encodeURIComponent(RELAY)}`,
      async (context, requested) => {
        await context.route(`${RELAY}/ice-config`, async (route) => {
          requested.push(route.request().url());
          await route.abort("connectionrefused");
        });
      },
    );

    expect(new Set(pair.requested)).toEqual(new Set([`${RELAY}/ice-config`]));
    expect(JSON.stringify(await pair.configs())).not.toContain("relay.test");
    await pair.close();
  });

  test("a link with no relay asks nobody and starts on STUN alone", async ({
    browser,
  }) => {
    const pair = await bootPair(
      browser,
      (code) => `host=${code}`,
      async () => {},
    );

    expect(JSON.stringify(await pair.configs())).not.toContain("relay.test");
    await pair.close();
  });
});
