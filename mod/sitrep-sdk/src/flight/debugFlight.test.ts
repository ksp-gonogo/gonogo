import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger, TaggedLogger } from "../api/logger-contract";
import { installTestHost, resetTestHost } from "../testing";
import { debugFlight } from "./debugFlight";

describe("debugFlight", () => {
  afterEach(() => {
    resetTestHost();
  });

  it("logs on the host logger's flight tag, so LOG_TAGS is the one switch", () => {
    const tagged: TaggedLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const host: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      tag: vi.fn().mockReturnValue(tagged),
    };
    installTestHost({ logger: host });

    debugFlight("resume", { flightId: "f1" });

    expect(host.tag).toHaveBeenCalledWith("flight");
    expect(tagged.debug).toHaveBeenCalledWith("resume", { flightId: "f1" });
    expect(host.debug).not.toHaveBeenCalled();
  });

  it("is silent without a host rather than throwing on a hot path", () => {
    resetTestHost();
    expect(() =>
      debugFlight("drop-pre-flight", { key: "v.altitude" }),
    ).not.toThrow();
  });
});
