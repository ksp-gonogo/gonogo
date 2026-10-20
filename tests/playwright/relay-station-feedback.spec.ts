/**
 * What a relay-only station's connect screen says while its first connection
 * falls back to the relay. The main is left as the app builds it with
 * Chromium's default mDNS address hiding, so the direct attempt cannot work
 * and the station only connects after its own first attempt fails and retries.
 */
import { expect, test } from "@playwright/test";
import { seedApprovedStation } from "./helpers";
import {
  RELAY_HTTP,
  spyOnPeerConnections,
  startTurnRelay,
} from "./turn-relay-fixture";

const SHOT_TIMES_S = [0, 6, 15, 18];
const OUT = ".renders/relay-feedback";

test.describe("relayed station connect feedback @chromium-only", () => {
  test("the station says it is trying direct and then switching to the relay before it connects", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const relay = await startTurnRelay(`${OUT}/relay`, {});
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

    const seen: string[] = [];
    const shots = new Set<number>();
    let connectedAt: number | null = null;
    while (Date.now() - startedAt < 60_000 && connectedAt === null) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const lines = await station
        .locator(
          "main[aria-label='Connect to mission control'] p, main[aria-label='Connect to mission control'] [role='status']",
        )
        .allTextContents()
        .catch(() => []);
      for (const line of lines) if (!seen.includes(line)) seen.push(line);
      for (const t of SHOT_TIMES_S) {
        if (elapsed >= t && !shots.has(t)) {
          shots.add(t);
          await station.screenshot({
            path: `${OUT}/${process.env.RENDER_TAG ?? "run"}-${t}s.png`,
          });
        }
      }
      if (
        await station.getByRole("button", { name: /add widget/i }).isVisible()
      ) {
        connectedAt = elapsed;
      }
      await station.waitForTimeout(250);
    }
    expect(connectedAt).not.toBeNull();
    expect(seen.join("\n")).toMatch(/Trying a direct connection/);
    expect(seen.join("\n")).toMatch(/switching to the relay/);
    expect(seen.join("\n")).not.toMatch(/host channel|ICE|candidate/i);
    await relay.stop();
    await mainContext.close();
    await stationContext.close();
  });
});
