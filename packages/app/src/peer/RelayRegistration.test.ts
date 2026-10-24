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

  it("stops heartbeating while another host owns the consent, and asks again once it could have lapsed", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => new Response("{}", { status: 409 }));
      vi.stubGlobal("fetch", fetchMock);
      const reg = new RelayRegistration({
        getHostId: () => "XK3F",
        getConsent: () => true,
        getRunId: () => undefined,
      });
      reg.startHeartbeat();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // A change of consent still goes out at once.
      await reg.postAnalyticsConfig();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      reg.stopHeartbeat();
    } finally {
      vi.useRealTimers();
    }
  });
});
