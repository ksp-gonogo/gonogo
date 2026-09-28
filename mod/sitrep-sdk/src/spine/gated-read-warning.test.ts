import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestHost } from "../testing/install-test-host";
import {
  gatedReadMessage,
  resetGatedReadWarnings,
  warnGatedRead,
} from "./gated-read-warning";

const THROTTLE = [
  "useDataStreamStatus",
  "data",
  "vessel.control.throttle",
  "vessel.control.throttle",
  ["vessel.control"],
] as const;

beforeEach(() => resetGatedReadWarnings());

describe("the gated-read warning message", () => {
  it("names the call that was written and the wire topic answering it", () => {
    const message = gatedReadMessage(...THROTTLE);
    expect(message).toContain(
      'useDataStreamStatus("data", "vessel.control.throttle")',
    );
    expect(message).toContain('"vessel.control"');
  });

  /** The line has to be actionable by someone who does not know the shim exists. */
  it("gives the carried-channels allowlist as the remedy", () => {
    const message = gatedReadMessage(
      "useDataSeries",
      "data",
      "vessel.orbit.sma",
      "vessel.orbit.sma",
      ["vessel.orbit"],
    );
    expect(message).toContain('useDataSeries("data", "vessel.orbit.sma")');
    expect(message).toContain("DEFAULT_SITREP_CARRIED_TOPICS");
  });
});

describe("warnGatedRead", () => {
  const warn = vi.fn();
  let uninstall = () => {};

  beforeEach(() => {
    warn.mockClear();
    uninstall = installTestHost({ logger: { warn } as never });
  });
  afterEach(() => uninstall());

  it("logs the message once, with the read as structured context", () => {
    warnGatedRead(...THROTTLE);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(gatedReadMessage(...THROTTLE), {
      hook: "useDataStreamStatus",
      dataSourceId: "data",
      key: "vessel.control.throttle",
      topic: "vessel.control.throttle",
      inputTopics: ["vessel.control"],
    });
  });

  /**
   * The read is evaluated on every render of every widget holding it, so an
   * ungated warning would print thousands of times a minute and bury itself.
   */
  it("fires once per read, not once per render", () => {
    warnGatedRead(...THROTTLE);
    warnGatedRead(...THROTTLE);
    warnGatedRead(...THROTTLE);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still reports a second, different key on the same source", () => {
    warnGatedRead(...THROTTLE);
    warnGatedRead(
      "useDataStreamStatus",
      "data",
      "vessel.control.pitch",
      "vessel.control.pitch",
      ["vessel.control"],
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  /** Two shims read the same key through the same source, and the message names the hook, so the once-gate is per hook as well. */
  it("still reports the same key read through the other hook", () => {
    warnGatedRead(...THROTTLE);
    warnGatedRead(
      "useDataSeries",
      "data",
      "vessel.control.throttle",
      "vessel.control.throttle",
      ["vessel.control"],
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

/**
 * A diagnostic must never be the thing that breaks the run it is diagnosing.
 * The SDK's logger is a Proxy that throws when no host is installed, which is
 * the ordinary state of a unit test, so the warning has to check first.
 */
describe("warnGatedRead with no host installed", () => {
  it("does not throw", () => {
    expect(() => warnGatedRead(...THROTTLE)).not.toThrow();
  });
});
