import { describe, expect, it } from "vitest";
import { discoverPublicIp } from "../discoverPublicIp.js";

function fakeFetch(
  responses: Record<string, { status: number; body: string; delayMs?: number }>,
): typeof fetch {
  return ((url: RequestInfo | URL) => {
    const u = String(url);
    const r = responses[u];
    if (!r) return Promise.reject(new Error(`unmocked ${u}`));
    return new Promise((resolve) => {
      const fire = () => {
        if (r.status >= 200 && r.status < 300) {
          resolve(
            new Response(r.body, {
              status: r.status,
              headers: { "content-type": "text/plain" },
            }),
          );
        } else {
          resolve(new Response(r.body, { status: r.status }));
        }
      };
      if (r.delayMs) setTimeout(fire, r.delayMs);
      else fire();
    });
  }) as typeof fetch;
}

describe("discoverPublicIp", () => {
  it("returns the override when set, no lookups", async () => {
    let called = false;
    const fetchImpl = (() => {
      called = true;
      return Promise.reject(new Error("should not fetch"));
    }) as unknown as typeof fetch;
    expect(await discoverPublicIp({ override: "203.0.113.7", fetchImpl })).toBe(
      "203.0.113.7",
    );
    expect(called).toBe(false);
  });

  it("trims whitespace from the override", async () => {
    const fetchImpl = (() =>
      Promise.reject(new Error("should not fetch"))) as unknown as typeof fetch;
    expect(
      await discoverPublicIp({ override: "  203.0.113.7\n", fetchImpl }),
    ).toBe("203.0.113.7");
  });

  it("races multiple lookup URLs and returns the first valid IP", async () => {
    const urls = ["https://a", "https://b", "https://c"];
    const fetchImpl = fakeFetch({
      "https://a": { status: 200, body: "203.0.113.7", delayMs: 30 },
      "https://b": { status: 500, body: "" },
      "https://c": { status: 200, body: "198.51.100.4", delayMs: 100 },
    });
    expect(await discoverPublicIp({ urls, fetchImpl, timeoutMs: 500 })).toBe(
      "203.0.113.7",
    );
  });

  it("filters out non-IP responses (e.g. HTML error pages)", async () => {
    const urls = ["https://html", "https://ok"];
    const fetchImpl = fakeFetch({
      "https://html": {
        status: 200,
        body: "<html>error</html>",
      },
      "https://ok": {
        status: 200,
        body: "203.0.113.7",
        delayMs: 20,
      },
    });
    expect(await discoverPublicIp({ urls, fetchImpl, timeoutMs: 500 })).toBe(
      "203.0.113.7",
    );
  });

  it("rejects when every lookup fails", async () => {
    const urls = ["https://a", "https://b"];
    const fetchImpl = fakeFetch({
      "https://a": { status: 500, body: "" },
      "https://b": { status: 500, body: "" },
    });
    await expect(
      discoverPublicIp({ urls, fetchImpl, timeoutMs: 500 }),
    ).rejects.toThrow();
  });
});
