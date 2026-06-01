import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

/**
 * Smoke test for the relay webServer. Verifies the playwright webServer
 * config booted the real relay package on http/13002 and that its core
 * endpoints answer. Fast, dependency-free — catches the most common
 * breakage (the relay failing to start at all).
 */
test.describe("relay smoke", () => {
  test("relay /health reports ok with TURN skipped", async ({ request }) => {
    const res = await request.get(`http://localhost:${PORTS.relay}/health`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { status: string; turn: unknown };
    expect(body.status).toBe("ok");
    // SKIP_COTURN=1 means /ice-config is 503 and /health.turn is null.
    expect(body.turn).toBeNull();
  });

  test("relay /ice-config reports 503 when coturn is skipped", async ({
    request,
  }) => {
    const res = await request.get(`http://localhost:${PORTS.relay}/ice-config`);
    expect(res.status()).toBe(503);
  });
});
