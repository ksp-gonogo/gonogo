import { describe, expect, it, vi } from "vitest";
import { AxiomConsentController } from "./AxiomConsentController.js";
import { ConsoleLogger } from "./index.js";
import type { LogEntry, LogTransport } from "./types.js";

function makeTransport(): LogTransport & { sent: LogEntry[][] } {
  const sent: LogEntry[][] = [];
  return {
    sent,
    send: (entries) => {
      sent.push(entries.slice());
    },
    flush: vi.fn(async () => {}),
  };
}

describe("AxiomConsentController", () => {
  it("installs the transport only when consent is enabled", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const transport = makeTransport();
    const controller = new AxiomConsentController({
      logger,
      makeTransport: () => transport,
    });

    expect(controller.isInstalled()).toBe(false);
    expect(logger.transportCount()).toBe(0);

    controller.apply(true);
    expect(controller.isInstalled()).toBe(true);
    expect(logger.transportCount()).toBe(1);

    logger.info("after consent");
    expect(transport.sent).toHaveLength(1);
  });

  it("removes the transport when consent is revoked and flushes it", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const transport = makeTransport();
    const controller = new AxiomConsentController({
      logger,
      makeTransport: () => transport,
    });

    controller.apply(true);
    controller.apply(false);

    expect(controller.isInstalled()).toBe(false);
    expect(logger.transportCount()).toBe(0);
    expect(transport.flush).toHaveBeenCalled();

    logger.info("after revoke");
    expect(transport.sent).toHaveLength(0);
  });

  it("is idempotent, repeated apply(true) installs at most one transport", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const make = vi.fn(makeTransport);
    const controller = new AxiomConsentController({
      logger,
      makeTransport: make,
    });

    controller.apply(true);
    controller.apply(true);
    controller.apply(true);

    expect(make).toHaveBeenCalledTimes(1);
    expect(logger.transportCount()).toBe(1);
  });

  it("toggling consent off then on reuses install/remove cleanly", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const controller = new AxiomConsentController({
      logger,
      makeTransport: makeTransport,
    });

    controller.apply(true);
    expect(logger.transportCount()).toBe(1);
    controller.apply(false);
    expect(logger.transportCount()).toBe(0);
    controller.apply(true);
    expect(logger.transportCount()).toBe(1);
  });

  it("never installs anything when no token is configured (factory returns null)", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const controller = new AxiomConsentController({
      logger,
      makeTransport: () => null,
    });

    controller.apply(true);
    expect(controller.isInstalled()).toBe(false);
    expect(logger.transportCount()).toBe(0);
  });

  it("backfills the pre-consent ring buffer to the transport on first install", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const transport = makeTransport();
    const controller = new AxiomConsentController({
      logger,
      makeTransport: () => transport,
    });

    // Pre-consent history accumulates in the ring buffer only.
    logger.info("before consent A");
    logger.info("before consent B");
    expect(transport.sent).toHaveLength(0);

    controller.apply(true);

    // One backfill send carrying the buffered history, at original timestamps.
    expect(transport.sent).toHaveLength(1);
    const backfilled = transport.sent[0];
    expect(backfilled.map((e) => e.message)).toEqual([
      "before consent A",
      "before consent B",
    ]);

    // Live entries after install flow through normally and are NOT part of the backfill batch (snapshot taken before addTransport).
    logger.info("after consent");
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1].map((e) => e.message)).toEqual(["after consent"]);
  });

  it("does NOT re-ship the buffer on a revoke → re-grant cycle", () => {
    const logger = new ConsoleLogger({ enabled: true });
    // A fresh transport each install so the second grant gets a clean sink.
    const transports: (LogTransport & { sent: LogEntry[][] })[] = [];
    const controller = new AxiomConsentController({
      logger,
      makeTransport: () => {
        const t = makeTransport();
        transports.push(t);
        return t;
      },
    });

    logger.info("history 1");
    controller.apply(true);
    expect(transports[0].sent).toHaveLength(1); // backfill shipped once

    controller.apply(false);
    logger.info("history 2");
    controller.apply(true);

    // Second transport installs but the buffer is NOT re-backfilled.
    expect(transports).toHaveLength(2);
    expect(transports[1].sent).toHaveLength(0);

    // Live entries after the re-grant still flow.
    logger.info("live after re-grant");
    expect(transports[1].sent).toHaveLength(1);
    expect(transports[1].sent[0].map((e) => e.message)).toEqual([
      "live after re-grant",
    ]);
  });

  it("apply(false) before any install is a no-op", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const transport = makeTransport();
    const controller = new AxiomConsentController({
      logger,
      makeTransport: () => transport,
    });

    controller.apply(false);
    expect(logger.transportCount()).toBe(0);
    expect(transport.flush).not.toHaveBeenCalled();
  });
});

describe("ConsoleLogger.removeTransport", () => {
  it("disposes a transport it removes, and only then", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const dispose = vi.fn();
    const transport = { ...makeTransport(), dispose };
    logger.addTransport(transport);
    expect(dispose).not.toHaveBeenCalled();
    logger.removeTransport(transport);
    logger.removeTransport(transport);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("stops fanning entries to a removed transport", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const transport = makeTransport();
    logger.addTransport(transport);
    logger.info("one");
    logger.removeTransport(transport);
    logger.info("two");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0][0].message).toBe("one");
  });

  it("removing an unregistered transport is a no-op", () => {
    const logger = new ConsoleLogger({ enabled: true });
    const transport = makeTransport();
    expect(() => logger.removeTransport(transport)).not.toThrow();
    expect(transport.flush).not.toHaveBeenCalled();
  });
});

describe("AxiomConsentController backfill of delivered entries", () => {
  it("skips an entry already sent by another route and still ships the rest", () => {
    const logger = new ConsoleLogger({ enabled: true, persist: null });
    logger.info("buffered before");
    logger.tag("feedback").info("feedback text");
    const feedback = logger.getBuffer().at(-1) as LogEntry;
    logger.markDelivered(feedback);
    logger.info("buffered after");

    const transport = makeTransport();
    new AxiomConsentController({
      logger,
      makeTransport: () => transport,
    }).apply(true);

    const messages = transport.sent.flat().map((e) => e.message);
    expect(messages).toEqual(["buffered before", "buffered after"]);
  });

  it("still skips it after the buffer is restored from storage on a reload", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
      removeItem: (k: string) => void values.delete(k),
    } as Storage;
    const persist = { key: "delivered-test", storage };
    const before = new ConsoleLogger({ enabled: true, persist });
    before.tag("feedback").info("feedback text");
    before.markDelivered(before.getBuffer().at(-1) as LogEntry);

    const after = new ConsoleLogger({ enabled: true, persist });
    after.info("written after the reload");
    const transport = makeTransport();
    new AxiomConsentController({
      logger: after,
      makeTransport: () => transport,
    }).apply(true);

    const messages = transport.sent.flat().map((e) => e.message);
    expect(messages).toEqual(["written after the reload"]);
  });

  it("stamps the run onto backfilled entries logged before the run began", () => {
    const logger = new ConsoleLogger({ enabled: true, persist: null });
    const transport = makeTransport();
    const controller = new AxiomConsentController({
      logger,
      makeTransport: () => transport,
    });

    logger.info("before the run");
    logger.setRunId("run-a");
    controller.apply(true);
    logger.info("during the run");

    expect(transport.sent.flat().map((e) => [e.message, e.runId])).toEqual([
      ["before the run", "run-a"],
      ["during the run", "run-a"],
    ]);
  });
});

describe("AxiomConsentController backfill across reloads and roles", () => {
  it("does not ship entries restored from an earlier page load", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
      removeItem: (k: string) => void values.delete(k),
    } as Storage;
    const persist = { key: "reload-test", storage };
    values.set(
      "reload-test",
      JSON.stringify([
        {
          level: "info",
          message: "from the earlier load",
          timestamp: "2026-10-18T00:00:00.000Z",
          sessionId: "an-earlier-load",
        },
      ]),
    );
    const after = new ConsoleLogger({ enabled: true, persist });
    after.info("from this load");
    const transport = makeTransport();
    new AxiomConsentController({
      logger: after,
      makeTransport: () => transport,
    }).apply(true);

    expect(transport.sent.flat().map((e) => e.message)).toEqual([
      "from this load",
    ]);
    expect(after.getBuffer().map((e) => e.message)).toEqual([
      "from the earlier load",
      "from this load",
    ]);
  });

  it("stamps the role onto backfilled entries logged before it was known", () => {
    const logger = new ConsoleLogger({ enabled: true, persist: null });
    const transport = makeTransport();
    const controller = new AxiomConsentController({
      logger,
      makeTransport: () => transport,
    });

    logger.info("before the role");
    logger.setIdentity({ role: "host", id: "ABCD" });
    logger.info("after the role");
    controller.apply(true);

    expect(
      transport.sent.flat().map((e) => [e.message, e.device?.role]),
    ).toEqual([
      ["before the role", "host"],
      ["after the role", "host"],
    ]);
  });
});
