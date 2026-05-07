import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleLogger } from "./index.js";
import { LogRingBuffer } from "./ringBuffer.js";
import { tagRegistry } from "./tags.js";
import type { LogEntry, LogTransport } from "./types.js";

describe("ConsoleLogger tag gating", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    tagRegistry.clearOverride();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    tagRegistry.clearOverride();
  });

  it("suppresses tagged debug when the tag is not enabled", () => {
    const logger = new ConsoleLogger({ enabled: true, level: "debug" });
    tagRegistry.setTags([]);
    logger.tag("peer").debug("hello");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("emits tagged debug when the tag is enabled", () => {
    const logger = new ConsoleLogger({ enabled: true, level: "debug" });
    tagRegistry.setTags(["peer"]);
    logger.tag("peer").debug("hello");
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("wildcard '*' enables every tag", () => {
    const logger = new ConsoleLogger({ enabled: true, level: "debug" });
    tagRegistry.setTags("all");
    logger.tag("anything").debug("hello");
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("colon-scoped tags inherit from their base tag", () => {
    const logger = new ConsoleLogger({ enabled: true, level: "debug" });
    tagRegistry.setTags(["peer"]);
    logger.tag("peer:kos").debug("nested");
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("always emits warn/error regardless of tag gating", () => {
    const logger = new ConsoleLogger({ enabled: true, level: "debug" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    tagRegistry.setTags([]);
    logger.tag("peer").warn("wat");
    logger.tag("peer").error("boom");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("buffers tag-gated debug even when the console suppresses it", () => {
    // The export is deliberately richer than the console stream — an
    // operator who downloads logs should see every entry the logger ever
    // emitted, not just the ones that passed the current tag/level filter.
    const logger = new ConsoleLogger({ enabled: true, level: "debug" });
    tagRegistry.setTags([]);
    logger.tag("peer").debug("hidden");
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(logger.getBuffer().length).toBe(1);
    expect(logger.getBuffer()[0].message).toBe("[peer] hidden");
  });

  it("buffers level-floored entries even when the console suppresses them", () => {
    const logger = new ConsoleLogger({ enabled: true, level: "warn" });
    logger.info("below floor");
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(logger.getBuffer().length).toBe(1);
    expect(logger.getBuffer()[0].message).toBe("below floor");
  });

  it("ring buffer retains emitted entries for export", () => {
    const logger = new ConsoleLogger({
      enabled: true,
      level: "debug",
      bufferCapacity: 3,
    });
    logger.info("one");
    logger.info("two");
    logger.info("three");
    logger.info("four");
    const dump = JSON.parse(logger.exportLogs()) as Array<{ message: string }>;
    expect(dump).toHaveLength(3);
    expect(dump[0].message).toBe("two");
    expect(dump[2].message).toBe("four");
  });
});

describe("ConsoleLogger transports and identity", () => {
  function makeTransport() {
    const sent: LogEntry[][] = [];
    const transport: LogTransport = {
      send: (entries) => {
        sent.push(entries.slice());
      },
    };
    return { sent, transport };
  }

  it("fans every emitted entry out to every registered transport", () => {
    const logger = new ConsoleLogger({
      enabled: true,
      level: "debug",
      sessionId: "session-A",
    });
    const a = makeTransport();
    const b = makeTransport();
    logger.addTransport(a.transport);
    logger.addTransport(b.transport);
    logger.info("alpha");
    logger.warn("bravo");
    expect(a.sent).toHaveLength(2);
    expect(b.sent).toHaveLength(2);
    expect(a.sent[0][0].message).toBe("alpha");
    expect(a.sent[1][0].message).toBe("bravo");
  });

  it("transports receive tag-gated entries the console suppresses", () => {
    // Remote sinks see the firehose — that's the value of having one.
    const logger = new ConsoleLogger({
      enabled: true,
      level: "debug",
      sessionId: "session-A",
    });
    const { sent, transport } = makeTransport();
    logger.addTransport(transport);
    tagRegistry.setTags([]);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.tag("peer").debug("hidden from console");
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0][0].message).toBe("[peer] hidden from console");
    consoleSpy.mockRestore();
  });

  it("a throwing transport does not break the logger or the other transports", () => {
    const logger = new ConsoleLogger({
      enabled: true,
      level: "debug",
      sessionId: "s",
    });
    const breaking: LogTransport = {
      send: () => {
        throw new Error("offline");
      },
    };
    const ok = makeTransport();
    logger.addTransport(breaking);
    logger.addTransport(ok.transport);
    expect(() => logger.info("survives")).not.toThrow();
    expect(ok.sent).toHaveLength(1);
  });

  it("attaches the configured sessionId and merged identity to each entry", () => {
    const logger = new ConsoleLogger({
      enabled: true,
      level: "debug",
      sessionId: "session-XYZ",
    });
    const { sent, transport } = makeTransport();
    logger.addTransport(transport);

    logger.setIdentity({ role: "station", id: "station-key-1" });
    logger.info("first");
    logger.setIdentity({ peerId: "station-key-1-abcd1234" });
    logger.info("second");
    logger.setIdentity({ hostPeerId: "XK3F" });
    logger.info("third");

    expect(sent[0][0]).toMatchObject({
      sessionId: "session-XYZ",
      device: { role: "station", id: "station-key-1" },
    });
    // setIdentity must merge, not replace.
    expect(sent[1][0].device).toEqual({
      role: "station",
      id: "station-key-1",
      peerId: "station-key-1-abcd1234",
    });
    expect(sent[2][0].device).toEqual({
      role: "station",
      id: "station-key-1",
      peerId: "station-key-1-abcd1234",
      hostPeerId: "XK3F",
    });
  });

  it("starts with role 'unknown' so pre-identity entries are still tagged", () => {
    const logger = new ConsoleLogger({
      enabled: true,
      level: "debug",
      sessionId: "s",
    });
    const { sent, transport } = makeTransport();
    logger.addTransport(transport);
    logger.info("before identity");
    expect(sent[0][0].device).toEqual({ role: "unknown" });
  });

  it("flushTransports awaits each transport's flush hook", async () => {
    const logger = new ConsoleLogger({
      enabled: true,
      level: "debug",
      sessionId: "s",
    });
    const flushed: string[] = [];
    logger.addTransport({
      send: () => {},
      flush: async () => {
        flushed.push("a");
      },
    });
    logger.addTransport({
      send: () => {},
      flush: async () => {
        flushed.push("b");
      },
    });
    await logger.flushTransports();
    expect(flushed.sort()).toEqual(["a", "b"]);
  });
});

describe("LogRingBuffer persistence", () => {
  function makeStorage(): Storage {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k) => map.get(k) ?? null,
      key: (i) => Array.from(map.keys())[i] ?? null,
      removeItem: (k) => {
        map.delete(k);
      },
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
  }

  it("flushes the buffer to storage and restores on a fresh instance", () => {
    const storage = makeStorage();
    const first = new LogRingBuffer(10, { key: "test", storage });
    first.push({
      level: "info",
      message: "alpha",
      timestamp: "2026-05-07T00:00:00.000Z",
    });
    first.flush();
    expect(storage.getItem("test")).toContain("alpha");

    const restored = new LogRingBuffer(10, { key: "test", storage });
    expect(restored.snapshot()).toHaveLength(1);
    expect(restored.snapshot()[0].message).toBe("alpha");
  });

  it("clear() wipes both memory and storage", () => {
    const storage = makeStorage();
    const buffer = new LogRingBuffer(10, { key: "test", storage });
    buffer.push({
      level: "info",
      message: "alpha",
      timestamp: "2026-05-07T00:00:00.000Z",
    });
    buffer.flush();
    buffer.clear();
    expect(storage.getItem("test")).toBeNull();
    const restored = new LogRingBuffer(10, { key: "test", storage });
    expect(restored.snapshot()).toHaveLength(0);
  });

  it("drops the older half on quota errors and retries once", () => {
    const storage = makeStorage();
    let throwCount = 0;
    const wrapped: Storage = {
      ...storage,
      setItem: (k, v) => {
        throwCount += 1;
        if (throwCount === 1) throw new Error("QuotaExceeded");
        storage.setItem(k, v);
      },
    };
    const buffer = new LogRingBuffer(4, { key: "test", storage: wrapped });
    for (let i = 0; i < 4; i++) {
      buffer.push({
        level: "info",
        message: `m${i}`,
        timestamp: "2026-05-07T00:00:00.000Z",
      });
    }
    buffer.flush();
    expect(buffer.size()).toBe(2);
    expect(JSON.parse(storage.getItem("test") ?? "[]")).toHaveLength(2);
  });

  it("survives a corrupt cache by dropping it", () => {
    const storage = makeStorage();
    storage.setItem("test", "{not json");
    const buffer = new LogRingBuffer(10, { key: "test", storage });
    expect(buffer.snapshot()).toHaveLength(0);
    expect(storage.getItem("test")).toBeNull();
  });
});
