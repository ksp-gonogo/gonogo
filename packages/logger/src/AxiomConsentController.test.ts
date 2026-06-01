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

  it("is idempotent — repeated apply(true) installs at most one transport", () => {
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
