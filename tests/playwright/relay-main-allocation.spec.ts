/**
 * How many relay ports a station that can only reach the main through the
 * relay costs, measured against the real relay running over the counting TURN
 * server (there is no coturn on the machines that run this suite).
 *
 * The station is built relay-only to stand in for a network with no direct
 * path to the main. The main is left as the app builds it: STUN only until a
 * connection fails to open within its escalation window.
 *
 * Chromium hides a page's local addresses behind mDNS names unless the page
 * holds a capture permission, and a relay can only be asked to forward to an
 * address, so a main screen's LAN candidate is unusable through a relay by
 * default. The launch flag below exposes the real address, which is the one
 * case where the relayed pair can reach the main with the main holding no
 * relay allocation of its own.
 */
import { expect, test } from "@playwright/test";
import { seedApprovedStation } from "./helpers";
import {
  type PcSpy,
  RELAY_HTTP,
  spyOnPeerConnections,
  startTurnRelay,
} from "./turn-relay-fixture";

test.use({
  launchOptions: {
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
  },
});

async function openRelayedStation(
  browser: import("@playwright/test").Browser,
  relayEnv: Record<string, string>,
  outDir: string,
) {
  const relay = await startTurnRelay(outDir, relayEnv);
  const mainContext = await browser.newContext();
  const stationContext = await browser.newContext();
  for (const context of [mainContext, stationContext]) {
    await context.addInitScript(() => {
      try {
        localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
      } catch {
        /* private mode: the seed just won't apply */
      }
    });
  }
  await spyOnPeerConnections(mainContext, false);
  await spyOnPeerConnections(stationContext, true);
  await seedApprovedStation(mainContext);
  await seedApprovedStation(stationContext);
  await mainContext.route(
    "http://localhost:13002/ice-config",
    async (route) => {
      const res = await fetch(`${RELAY_HTTP}/ice-config`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: await res.text(),
      });
    },
  );

  const main = await mainContext.newPage();
  await main.goto("/?uplinkLoaderIds=");
  const code = (await (
    await main.waitForFunction(
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
    )
  ).jsonValue()) as string;

  const station = await stationContext.newPage();
  const startedAt = Date.now();
  await station.goto(
    `/station?host=${code}&relay=${encodeURIComponent(RELAY_HTTP)}&uplinkLoaderIds=`,
  );
  return {
    relay,
    main,
    station,
    startedAt,
    connected: () =>
      station.getByRole("button", { name: /add widget/i }).isVisible(),
    mainConnections: () =>
      main.evaluate(() => (window as unknown as PcSpy).__pcs),
    async close() {
      await relay.stop();
      await mainContext.close();
      await stationContext.close();
    },
  };
}

test.describe("relayed station and the main's relay ports @chromium-only", () => {
  test("a relay beside the main lets a relay-only station connect while the main holds no allocation", async ({
    browser,
  }) => {
    const run = await openRelayedStation(
      browser,
      {},
      ".renders/relay-main-allocation/lan-relay",
    );
    await expect(
      run.station.getByRole("button", { name: /add widget/i }),
    ).toBeVisible({ timeout: 20_000 });

    // The main's escalation window is 6 s; connecting inside it means the main never needed the relay.
    expect(Date.now() - run.startedAt).toBeLessThan(6_000);
    const mainConnections = await run.mainConnections();
    expect(
      mainConnections.filter((pc) =>
        pc.candidates.some((c) => c.startsWith("relay")),
      ),
    ).toEqual([]);
    expect(run.relay.allocations()).toBe(1);
    await run.close();
  });

  test("a relay that refuses private peers cannot reach the main's LAN address, so the pair stalls", async ({
    browser,
  }) => {
    const run = await openRelayedStation(
      browser,
      { RELAY_PUBLIC: "1" },
      ".renders/relay-main-allocation/public-relay",
    );
    await expect
      .poll(() => run.relay.denied(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(await run.connected()).toBe(false);
    await run.close();
  });
});
