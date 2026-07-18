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
});
