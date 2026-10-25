import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";

/**
 * Smoke test for the relay webServer. Verifies the playwright webServer
 * config booted the real relay package on http/13002 and that its core
 * endpoints answer. Fast, dependency-free: catches the most common
 * breakage (the relay failing to start at all).
 */
test.describe("relay smoke", () => {
  test("relay /health reports ok with no endpoint on the suite's relay", async ({
    request,
  }) => {
    const res = await request.get(`http://localhost:${PORTS.relay}/health`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { status: string; endpoint: unknown };
    expect(body.status).toBe("ok");
    // SKIP_ENDPOINT=1 on the suite's relay, so stations join the main screen directly.
    expect(body.endpoint).toBeNull();
  });
});
