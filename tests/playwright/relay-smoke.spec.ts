import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

/**
 * Smoke test for the relay + fake-OCISLY chain. Verifies that the
 * playwright webServer config booted both:
 *   - the fake OCISLY gRPC server on tcp/5078 (Playwright already
 *     waited on that port before this test ran);
 *   - the real relay package on http/3002, advertising a peer id and
 *     pointing at the fake OCISLY.
 *
 * Doesn't exercise WebRTC yet — that's the follow-up spec. This is
 * here to catch the most common breakages (relay fails to start,
 * proto path wrong, fake OCISLY port collision) with a fast,
 * dependency-free check rather than a full multi-screen flow.
 */
test.describe("relay + fake OCISLY", () => {
  test("relay /health reports the fake OCISLY target and a peer id", async ({
    request,
  }) => {
    const res = await request.get(
      `http://localhost:${PORTS.relay}/health`,
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      status: string;
      ocislyTarget: string;
      peerId: string;
      turn: unknown;
    };
    expect(body.status).toBe("ok");
    expect(body.ocislyTarget).toBe(`localhost:${PORTS.fakeOcisly}`);
    expect(typeof body.peerId).toBe("string");
    expect(body.peerId.length).toBeGreaterThan(0);
    // SKIP_COTURN=1 means /ice-config is 503 and /health.turn is null.
    expect(body.turn).toBeNull();
  });

  test("relay /ice-config reports 503 when coturn is skipped", async ({
    request,
  }) => {
    const res = await request.get(
      `http://localhost:${PORTS.relay}/ice-config`,
    );
    expect(res.status()).toBe(503);
  });
});
