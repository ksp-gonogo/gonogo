/**
 * Stations joining the main screen through the relay's station endpoint: the
 * real relay, the real endpoint binary and the real app, with the main screen's
 * relay socket pointed at that relay.
 */

import { type Browser, expect, test } from "@playwright/test";
import {
  type EndpointRelay,
  keepPeerConnections,
  type PcSpy,
  pointAtRelay,
  startEndpointRelay,
} from "./endpoint-relay-fixture";
import { seedApprovedStation } from "./helpers";

async function mainScreen(browser: Browser, relay: EndpointRelay) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try {
      localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
    } catch {
      /* private mode: the seed just won't apply */
    }
  });
  await seedApprovedStation(context);
  await pointAtRelay(context, relay);
  const page = await context.newPage();
  await page.goto("/?uplinkLoaderIds=");
  const code = (await (
    await page.waitForFunction(
      () => {
        const svc = (
          window as unknown as {
            peerHostService?: {
              peerId?: string | null;
              shareCode?: string;
              endpoint?: { available: boolean };
            };
          }
        ).peerHostService;
        return svc?.peerId && svc.shareCode && svc.endpoint?.available
          ? svc.shareCode
          : null;
      },
      undefined,
      { timeout: 30_000, polling: 200 },
    )
  ).jsonValue()) as string;
  return { context, page, code };
}

async function station(browser: Browser, code: string) {
  const context = await browser.newContext();
  await seedApprovedStation(context);
  await keepPeerConnections(context);
  const page = await context.newPage();
  await page.goto(`/station?host=${code}&uplinkLoaderIds=`);
  return { context, page };
}

/** The transport protocol of the pair the station's endpoint link selected, or null while it has none. */
function selectedProtocol(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    for (const pc of (window as unknown as PcSpy).__pcs) {
      const stats = await pc.getStats();
      let pairId: string | undefined;
      const byId = new Map<string, Record<string, unknown>>();
      stats.forEach((s: Record<string, unknown>) => {
        byId.set(String(s.id), s);
        if (s.type === "transport" && s.selectedCandidatePairId) {
          pairId = String(s.selectedCandidatePairId);
        }
      });
      const pair = pairId ? byId.get(pairId) : undefined;
      const local = pair ? byId.get(String(pair.localCandidateId)) : undefined;
      if (local?.protocol) return String(local.protocol);
    }
    return null;
  });
}

test.describe("stations through the endpoint @chromium-only", () => {
  test("two stations join at once, each on its own path through the one port", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const relay = await startEndpointRelay({
      port: 13010,
      endpointPort: 47181,
    });
    try {
      const main = await mainScreen(browser, relay);
      const [a, b] = await Promise.all([
        station(browser, main.code),
        station(browser, main.code),
      ]);
      for (const s of [a, b]) {
        await expect(
          s.page.getByRole("button", { name: /add widget/i }),
        ).toBeVisible({ timeout: 30_000 });
      }
      await expect
        .poll(
          () =>
            main.page.evaluate(() =>
              (
                window as unknown as {
                  peerHostService: {
                    getStationPaths(): Array<{ path: string | null }>;
                  };
                }
              ).peerHostService
                .getStationPaths()
                .map((p) => p.path),
            ),
          { timeout: 10_000 },
        )
        .toEqual(["lan", "lan"]);
      expect(await selectedProtocol(a.page)).toBe("udp");
      // Neither station holds a PeerJS connection to the main screen: both came through the endpoint.
      expect(
        await main.page.evaluate(
          () =>
            Object.keys(
              (
                window as unknown as {
                  peerHostService: { peer: { connections: object } };
                }
              ).peerHostService.peer.connections,
            ).length,
        ),
      ).toBe(0);
      await a.context.close();
      await b.context.close();
      await main.context.close();
    } finally {
      await relay.stop();
    }
  });

  test("a station on a network that blocks UDP joins over TCP on the same port", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const relay = await startEndpointRelay({
      port: 13012,
      endpointPort: 47182,
      env: { ENDPOINT_OMIT_UDP: "1" },
    });
    try {
      const main = await mainScreen(browser, relay);
      const s = await station(browser, main.code);
      await expect(
        s.page.getByRole("button", { name: /add widget/i }),
      ).toBeVisible({ timeout: 30_000 });
      expect(await selectedProtocol(s.page)).toBe("tcp");
      await s.context.close();
      await main.context.close();
    } finally {
      await relay.stop();
    }
  });
});
