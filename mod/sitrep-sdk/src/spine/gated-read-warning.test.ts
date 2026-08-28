import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestHost } from "../testing/install-test-host";
import {
  gatedReadMessage,
  resetGatedReadWarnings,
  warnGatedRead,
} from "./gated-read-warning";

const THROTTLE = [
  "useTelemetry",
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
      'useTelemetry("data", "vessel.control.throttle")',
    );
    expect(message).toContain('"vessel.control"');
  });

  /**
   * The line has to be actionable by someone who does not know the shim exists:
   * what to write instead, and the one way the replacement behaves differently.
   */
  it("gives useTelemetry the canonical call to write instead, and the payload difference", () => {
    const message = gatedReadMessage(...THROTTLE);
    expect(message).toContain('useTelemetry("vessel.control")');
    expect(message).toContain("Reading");
    expect(message).toContain("Values");
  });

  /**
   * `useDataSeries` has no canonical twin, so the same remedy would be advice
   * a reader cannot act on.
   */
  it("gives useDataSeries the allowlist instead, because it has no canonical twin", () => {
    const message = gatedReadMessage(
      "useDataSeries",
      "data",
      "vessel.orbit.sma",
      "vessel.orbit.sma",
      ["vessel.orbit"],
    );
    expect(message).toContain('useDataSeries("data", "vessel.orbit.sma")');
    expect(message).toContain("DEFAULT_SITREP_CARRIED_TOPICS");
    expect(message).not.toContain("useTelemetry(");
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
      hook: "useTelemetry",
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
      "useTelemetry",
      "data",
      "vessel.control.pitch",
      "vessel.control.pitch",
      ["vessel.control"],
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  /**
   * Two shims read the same key through the same source, and each has its own
   * remedy, so the once-gate is per hook as well.
   */
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
