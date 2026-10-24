import { describe, expect, it, vi } from "vitest";
import { AxiomFetchClient } from "./AxiomFetchClient.js";

function respond(status: number): Response {
  return new Response(null, { status });
}

function makeClient(fetchImpl: typeof fetch, maxPending?: number) {
  return new AxiomFetchClient({
    token: "xaat-test",
    orgId: "org-1",
    fetch: fetchImpl,
    maxPending,
  });
}

describe("AxiomFetchClient", () => {
  it("posts the queued events as one JSON array to the dataset's ingest endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respond(200));
    const client = makeClient(fetchImpl);

    client.ingest("gonogo", [{ message: "a" }, { message: "b" }]);
    await client.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.axiom.co/v1/datasets/gonogo/ingest");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer xaat-test",
      "Content-Type": "application/json",
      "X-Axiom-Org-ID": "org-1",
    });
    expect(JSON.parse(String(init?.body))).toEqual([
      { message: "a" },
      { message: "b" },
    ]);
  });

  it("keeps events when the network is down and sends them with the next flush", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(respond(200));
    const client = makeClient(fetchImpl);

    client.ingest("gonogo", [{ message: "a" }]);
    await expect(client.flush()).rejects.toThrow("offline");
    client.ingest("gonogo", [{ message: "b" }]);
    await client.flush();

    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual([
      { message: "a" },
      { message: "b" },
    ]);
  });

  it("keeps events across a server error or a rate limit", async () => {
    for (const status of [500, 503, 429]) {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(respond(status))
        .mockResolvedValue(respond(200));
      const client = makeClient(fetchImpl);

      client.ingest("gonogo", [{ message: "a" }]);
      await expect(client.flush()).rejects.toThrow();
      await client.flush();

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual([
        { message: "a" },
      ]);
    }
  });

  it("drops events the server refuses outright, so a bad batch is not resent forever", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(401))
      .mockResolvedValue(respond(200));
    const client = makeClient(fetchImpl);

    client.ingest("gonogo", [{ message: "a" }]);
    await expect(client.flush()).rejects.toThrow();
    await client.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest events once more than the cap are waiting", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respond(200));
    const client = makeClient(fetchImpl, 3);

    client.ingest(
      "gonogo",
      [1, 2, 3, 4, 5].map((n) => ({ n })),
    );
    await client.flush();

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual([
      { n: 3 },
      { n: 4 },
      { n: 5 },
    ]);
  });

  it("asks the browser to finish the request after the page closes when told to", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respond(200));
    const client = makeClient(fetchImpl);

    client.ingest("gonogo", [{ message: "a" }]);
    await client.flush({ keepalive: true });
    client.ingest("gonogo", [{ message: "b" }]);
    await client.flush();

    expect(fetchImpl.mock.calls[0][1]?.keepalive).toBe(true);
    expect(fetchImpl.mock.calls[1][1]?.keepalive).toBeFalsy();
  });

  it("does nothing when nothing is waiting", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respond(200));
    await makeClient(fetchImpl).flush();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("abandons a request that never answers so later flushes are not held behind it", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("timed out", "TimeoutError")),
              );
            }),
        )
        .mockResolvedValue(respond(200));
      const client = makeClient(fetchImpl);

      client.ingest("gonogo", [{ message: "a" }]);
      const stalled = expect(client.flush()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(30_000);
      await stalled;
      await client.flush();

      expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual([
        { message: "a" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("splits a large backlog into several requests, and a refused one does not drop the rest", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(200))
      .mockResolvedValueOnce(respond(413))
      .mockResolvedValue(respond(200));
    const client = makeClient(fetchImpl);

    client.ingest(
      "gonogo",
      Array.from({ length: 1200 }, (_, n) => ({ n })),
    );
    await expect(client.flush()).rejects.toThrow("413");
    await client.flush();

    const sizes = fetchImpl.mock.calls.map(
      (c) => JSON.parse(String(c[1]?.body)).length,
    );
    expect(sizes).toEqual([500, 500, 200]);
  });
});
