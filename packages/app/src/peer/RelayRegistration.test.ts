import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayRegistration } from "./RelayRegistration";

describe("RelayRegistration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the host in every post and collapses a burst into two requests", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        await Promise.resolve();
        return new Response("{}", { status: 200 });
      }),
    );
    const reg = new RelayRegistration({
      getHostId: () => "XK3F",
      getConsent: () => true,
      getRunId: () => "run-1",
    });
    await Promise.all(
      Array.from({ length: 12 }, () => reg.postAnalyticsConfig()),
    );
    await vi.waitFor(() => expect(bodies.length).toBe(2));
    expect(bodies[0]).toEqual({
      hostId: "XK3F",
      enabled: true,
      runId: "run-1",
    });
  });
});
