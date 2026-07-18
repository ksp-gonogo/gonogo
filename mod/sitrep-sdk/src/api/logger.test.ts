import { ConsoleLogger } from "@ksp-gonogo/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestHost, resetTestHost } from "../testing";
import type { Logger, TaggedLogger } from "./index";
import { logger } from "./index";

/**
 * The `logger` facade shim (design: logger is a stateful singleton — a
 * bundled copy would be a dead logger, console-only, never fanned to Axiom
 * or the shared ring buffer). Same injected-host contract as every other
 * stateful member: delegate to the host, fail loud when absent.
 */
describe("sitrep-sdk author-facing barrel — logger shim", () => {
  afterEach(() => {
    resetTestHost();
  });

  it("fails LOUD when no host is installed", () => {
    resetTestHost();
    expect(() => logger.info("x")).toThrow(
      /@ksp-gonogo\/sitrep-sdk: the gonogo host has not been installed/,
    );
  });

  it("delegates plain + tagged calls to the injected host's logger", () => {
    const info = vi.fn();
    const taggedInfo = vi.fn();
    const fakeTagged: TaggedLogger = {
      debug: vi.fn(),
      info: taggedInfo,
      warn: vi.fn(),
      error: vi.fn(),
    };
    const fakeLogger: Logger = {
      debug: vi.fn(),
      info,
      warn: vi.fn(),
      error: vi.fn(),
      tag: vi.fn().mockReturnValue(fakeTagged),
    };
    installTestHost({ logger: fakeLogger });

    logger.info("x");
    expect(info).toHaveBeenCalledWith("x");

    logger.tag("t").info("y");
    expect(fakeLogger.tag).toHaveBeenCalledWith("t");
    expect(taggedInfo).toHaveBeenCalledWith("y");
  });

  // A fake host with vi.fn() members can't catch an unbound-`this` bug in
  // the shim, because the fakes don't have any internal state to lose.
  // These two use the REAL ConsoleLogger so a method that reads or writes
  // `this` inside its own implementation proves the shim binds correctly.

  it("lands real plain + tagged calls in the injected ConsoleLogger's own buffer", () => {
    const real = new ConsoleLogger({ enabled: true });
    installTestHost({ logger: real });

    logger.info("plain-message");
    logger.tag("t").info("tagged-message");

    const messages = real.getBuffer().map((entry) => entry.message);
    expect(messages).toContain("plain-message");
    expect(messages).toContain("[t] tagged-message");
  });

  it("binds shim methods to the real instance, so internal WRITES to `this` land too", () => {
    const real = new ConsoleLogger({ enabled: true });
    installTestHost({ logger: real });

    // setEnabled/isEnabled aren't on the published Logger type (only
    // ConsoleLogger has them), but they're exactly the shape of method that
    // an unbound `this` would silently no-op: the write lands on the
    // proxy's dead `{}` target instead of `real`.
    const unsafeLogger = logger as unknown as {
      setEnabled(value: boolean): void;
    };

    expect(real.isEnabled()).toBe(true);
    unsafeLogger.setEnabled(false);
    expect(real.isEnabled()).toBe(false);
  });
});
