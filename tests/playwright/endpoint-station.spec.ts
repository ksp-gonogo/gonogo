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

/**
 * Makes the station's link through the endpoint unable to connect, as for a
 * station on another network when no port is forwarded: the endpoint's answer
 * reaches it with no address to try.
 */
async function cannotReachEndpoint(
  context: import("@playwright/test").BrowserContext,
) {
  await context.addInitScript(() => {
    /* The endpoint link is the connection that opens a channel named "gonogo"; PeerJS names its own. */
    const endpointLinks = new WeakSet<RTCPeerConnection>();
    const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (
      this: RTCPeerConnection,
      label: string,
      init?: RTCDataChannelInit,
    ) {
      if (label === "gonogo") endpointLinks.add(this);
      return createDataChannel.call(this, label, init);
    };
    const setRemoteDescription =
      RTCPeerConnection.prototype.setRemoteDescription;
    RTCPeerConnection.prototype.setRemoteDescription = function (
      this: RTCPeerConnection,
      description: RTCSessionDescriptionInit,
    ) {
      const sdp =
        endpointLinks.has(this) && description.sdp
          ? description.sdp
              .split("\r\n")
              .filter((line) => !line.startsWith("a=candidate"))
              .join("\r\n")
          : description.sdp;
      return setRemoteDescription.call(this, { type: description.type, sdp });
    } as typeof setRemoteDescription;
  });
}

async function station(
  browser: Browser,
  code: string,
  { endpointReachable = true }: { endpointReachable?: boolean } = {},
) {
  const context = await browser.newContext();
  await seedApprovedStation(context);
  await keepPeerConnections(context);
  if (!endpointReachable) await cannotReachEndpoint(context);
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

/** The stations the main screen is serving, by broker peer id. */
function served(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          peerHostService?: { getConnectedPeerIds(): string[] };
        }
      ).peerHostService?.getConnectedPeerIds() ?? [],
  );
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
      /* Neither station is carried by a PeerJS connection: both came through the endpoint. Their data
         connections carried the offer and are closed once the endpoint link opens. */
      await expect
        .poll(() =>
          main.page.evaluate(
            () =>
              Object.values(
                (
                  window as unknown as {
                    peerHostService: {
                      peer: {
                        connections: Record<string, Array<{ open: boolean }>>;
                      };
                    };
                  }
                ).peerHostService.peer.connections,
              )
                .flat()
                .filter((c) => c.open).length,
          ),
        )
        .toBe(0);
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

  test("a station that cannot reach the endpoint is served on its data connection", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const relay = await startEndpointRelay({
      port: 13015,
      endpointPort: 47185,
    });
    try {
      const main = await mainScreen(browser, relay);
      const s = await station(browser, main.code, { endpointReachable: false });
      await expect(
        s.page.getByRole("button", { name: /add widget/i }),
      ).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => served(main.page)).toHaveLength(1);
      /* Still served once the station's silence window has passed, so it is not
         joining and dropping in a loop. */
      await s.page.waitForTimeout(8_000);
      expect(await served(main.page)).toHaveLength(1);
      await expect(
        s.page.getByRole("button", { name: /add widget/i }),
      ).toBeVisible();
      await s.context.close();
      await main.context.close();
    } finally {
      await relay.stop();
    }
  });

  test("a station rejoins on its own after the main screen is away for 30 seconds", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const relay = await startEndpointRelay({
      port: 13014,
      endpointPort: 47183,
    });
    try {
      const main = await mainScreen(browser, relay);
      const s = await station(browser, main.code);
      await expect(
        s.page.getByRole("button", { name: /add widget/i }),
      ).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => served(main.page)).toHaveLength(1);

      await main.page.close();
      await s.page.waitForTimeout(30_000);
      const back = await main.context.newPage();
      await back.goto("/?uplinkLoaderIds=");

      await expect
        .poll(() => served(back), { timeout: 60_000 })
        .toHaveLength(1);
      await s.context.close();
      await main.context.close();
    } finally {
      await relay.stop();
    }
  });

  test("a station that reloads is served again without pressing Connect", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const relay = await startEndpointRelay({
      port: 13016,
      endpointPort: 47184,
    });
    try {
      const main = await mainScreen(browser, relay);
      const s = await station(browser, main.code);
      await expect(
        s.page.getByRole("button", { name: /add widget/i }),
      ).toBeVisible({ timeout: 30_000 });
      const first = await served(main.page);
      expect(first).toHaveLength(1);

      await s.page.reload();

      await expect
        .poll(
          async () => {
            const now = await served(main.page);
            return now.length === 1 && now[0] !== first[0];
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      await expect(
        s.page.getByRole("button", { name: /add widget/i }),
      ).toBeVisible();
      await s.context.close();
      await main.context.close();
    } finally {
      await relay.stop();
    }
  });
});
