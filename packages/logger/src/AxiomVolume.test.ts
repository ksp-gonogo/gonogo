import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxiomFetchClient } from "./AxiomFetchClient.js";
import { AxiomTransport } from "./AxiomTransport.js";
import type { LogEntry } from "./types.js";

type Sent = { message: string; level: string; tag?: string };

function isSentList(value: unknown): value is Sent[] {
  return Array.isArray(value);
}

function parseSent(body: string): Sent[] {
  const parsed: unknown = JSON.parse(body);
  if (!isSentList(parsed)) throw new Error("ingest body was not an array");
  return parsed;
}

function makeNetwork(
  respond: (events: Sent[]) => Response = (events) =>
    Response.json({ ingested: events.length, failed: 0 }),
) {
  const requests: Sent[][] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const events = parseSent(String(init?.body));
    requests.push(events);
    return respond(events);
  });
  const lines = () => requests.flat();
  return { fetchImpl, requests, lines };
}

function makeTransport(
  fetchImpl: typeof fetch,
  onError?: (e: unknown) => void,
) {
  return new AxiomTransport({
    dataset: "gonogo",
    client: new AxiomFetchClient({ token: "t", fetch: fetchImpl }),
    flushOnPageHide: false,
    onError,
  });
}

function entry(
  level: LogEntry["level"],
  message: string,
  tag?: string,
): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(tag ? { tag } : {}),
  };
}

describe("AxiomTransport volume budget", () => {
  let transport: AxiomTransport;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    transport?.dispose();
    vi.useRealTimers();
  });

  it("costs a bounded number of lines for a runaway loop of identical errors", async () => {
    const net = makeNetwork();
    transport = makeTransport(net.fetchImpl);
    for (let i = 0; i < 100_000; i++) {
      transport.send([entry("error", "socket exploded")]);
    }
    await vi.advanceTimersByTimeAsync(61_000);
    await transport.flush();

    const sent = net.lines();
    expect(sent.length).toBeLessThanOrEqual(3);
    expect(sent[0].message).toBe("socket exploded");
    expect(sent.some((l) => l.message.startsWith("repeated 99999 times"))).toBe(
      true,
    );
  });

  it("still delivers a feedback entry sent in the middle of that loop", async () => {
    const net = makeNetwork();
    transport = makeTransport(net.fetchImpl);
    for (let i = 0; i < 50_000; i++) {
      transport.send([entry("error", "socket exploded")]);
    }
    transport.send([entry("info", "[feedback] more gauges", "feedback")]);
    for (let i = 0; i < 50_000; i++) {
      transport.send([entry("error", "socket exploded")]);
    }
    await transport.flush();

    expect(net.lines().map((l) => l.message)).toContain(
      "[feedback] more gauges",
    );
  });

  it("bounds a loop whose message changes every time, and says what it dropped", async () => {
    const net = makeNetwork();
    transport = makeTransport(net.fetchImpl);
    for (let i = 0; i < 20_000; i++) {
      transport.send([entry("error", `failed on ${i}`)]);
      transport.send([entry("debug", `tick ${i}`)]);
    }
    await vi.advanceTimersByTimeAsync(61_000);
    await transport.flush();

    const sent = net.lines();
    expect(sent.length).toBeLessThanOrEqual(30 + 40 + 2);
    const dropped = sent.filter((l) => l.message.startsWith("dropped "));
    expect(dropped).toHaveLength(1);
    expect(dropped[0].message).toMatch(/debug 19960, error 19970/);
  });

  it("lets nothing but reports through once a page load reaches the ceiling", async () => {
    const net = makeNetwork();
    transport = new AxiomTransport({
      dataset: "gonogo",
      client: new AxiomFetchClient({ token: "t", fetch: net.fetchImpl }),
      flushOnPageHide: false,
      budget: {
        windowMs: 60_000,
        debugPerWindow: 10,
        linesPerWindow: 10,
        errorsPerWindow: 10,
        ceiling: 5,
        maxDistinct: 10,
      },
    });
    for (let i = 0; i < 20; i++) transport.send([entry("info", `l${i}`)]);
    transport.send([entry("error", "[bug-report] stuck", "bug-report")]);
    await transport.flush();

    const messages = net.lines().map((l) => l.message);
    expect(messages.filter((m) => /^l\d+$/.test(m))).toHaveLength(5);
    expect(messages).toContain("[bug-report] stuck");
  });
});

describe("AxiomFetchClient ingest response", () => {
  it("treats a 200 that reports failed events as a failure", async () => {
    const net = makeNetwork((events) =>
      Response.json({
        ingested: 0,
        failed: events.length,
        failures: [{ error: "too many fields" }],
      }),
    );
    const onError = vi.fn();
    const transport = makeTransport(net.fetchImpl, onError);
    transport.send([entry("error", "[bug-report] x", "bug-report")]);
    await transport.flush();
    transport.dispose();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toMatch(
      /rejected 1 events: too many fields/,
    );
  });

  it("sends a report in a request of its own, so a refused batch cannot take it down", async () => {
    const net = makeNetwork((events) =>
      events.some((e) => e.message === "poison")
        ? new Response("bad", { status: 400 })
        : Response.json({ ingested: events.length, failed: 0 }),
    );
    const client = new AxiomFetchClient({ token: "t", fetch: net.fetchImpl });
    client.ingest("gonogo", [
      { message: "poison", level: "info" },
      { message: "[feedback] hi", level: "info", tag: "feedback" },
    ]);
    await expect(client.flush()).rejects.toThrow();

    expect(net.requests[0].map((e) => e.message)).toEqual(["[feedback] hi"]);
  });

  it("keeps a report when the pending cap forces older events out", async () => {
    const net = makeNetwork();
    const client = new AxiomFetchClient({
      token: "t",
      fetch: net.fetchImpl,
      maxPending: 2,
    });
    client.ingest("gonogo", [
      { message: "[bug-report] x", level: "error", tag: "bug-report" },
      { message: "a", level: "info" },
      { message: "b", level: "info" },
    ]);
    await client.flush();

    expect(net.lines().map((l) => l.message)).toEqual(["[bug-report] x", "b"]);
  });
});
