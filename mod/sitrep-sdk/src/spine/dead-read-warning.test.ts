import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry, registerDataSource } from "../api/registry";
import type { DataKey } from "../api/types";
import { installTestHost } from "../testing/install-test-host";
import {
  classifyDeadRead,
  type DeadReadCause,
  deadReadMessage,
  resetDeadReadWarnings,
  warnDeadRead,
} from "./dead-read-warning";

/** Minimal registrable source: only `id`, `name` and `schema` are consulted. */
function source(
  id: string,
  schema: () => DataKey[],
): Parameters<typeof registerDataSource>[0] {
  return {
    id,
    name: id,
    status: "connected",
    connect: async () => {},
    disconnect: () => {},
    schema,
    subscribe: () => () => {},
    onStatusChange: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
  };
}

/** The ordinary case: a source that enumerates the keys it will emit. */
function declaring(id: string, keys: readonly string[]) {
  return source(id, () => keys.map((key) => ({ key })));
}

const NO_SOURCE: DeadReadCause = { kind: "no-topic-no-source" };

beforeEach(() => {
  resetDeadReadWarnings();
  clearRegistry();
});

describe("classifying a read that resolves to nothing", () => {
  it("reports a key the contract does not declare with no source behind the id", () => {
    expect(classifyDeadRead("data", "vessel.control.thruttle", true)).toEqual(
      NO_SOURCE,
    );
  });

  /**
   * The source is live and answering, so the read has somewhere to go; it is
   * the KEY that has nowhere to come from, and the schema is what proves it.
   */
  it("reports a key a registered source's schema does not declare", () => {
    registerDataSource(
      declaring("legacy", ["vessel.control.throttle", "vessel.control.pitch"]),
    );

    expect(
      classifyDeadRead("legacy", "vessel.control.thruttle", false),
    ).toEqual({
      kind: "no-topic-key-not-in-schema",
      sourceName: "legacy",
      schemaKeys: ["vessel.control.throttle", "vessel.control.pitch"],
    });
  });

  /**
   * An empty schema is a source that does not ENUMERATE, not evidence the key
   * is absent from it: several real sources return `[]`. Accusing one would
   * make the warning fire on healthy reads, which is how a diagnostic gets
   * tuned out.
   */
  it("says nothing when the registered source enumerates no schema at all", () => {
    registerDataSource(declaring("legacy", []));

    expect(
      classifyDeadRead("legacy", "vessel.control.thruttle", false),
    ).toBeUndefined();
  });

  /** Declared but not emitted yet resolves itself the moment the source speaks. */
  it("says nothing when the schema declares the key and it has yet to arrive", () => {
    registerDataSource(declaring("legacy", ["vessel.control.throttle"]));

    expect(
      classifyDeadRead("legacy", "vessel.control.throttle", false),
    ).toBeUndefined();
  });

  /**
   * A resolved topic with a stream mounted means the subscribe reached a
   * channel, and `installUnownedTopicWarning` is the instrument that gets to
   * speak about that silence. Two lines for one cause is one line too many.
   */
  it("stands aside for the unowned-topic diagnostic when a stream is mounted", () => {
    expect(
      classifyDeadRead("data", "vessel.control.throttle", true),
    ).toBeUndefined();
  });

  it("reports a resolvable key with no provider mounted and no source to ask", () => {
    expect(classifyDeadRead("data", "vessel.control.throttle", false)).toEqual({
      kind: "no-provider-no-source",
      topic: "vessel.control.throttle",
    });
  });

  it("says nothing when the provider is absent but a source can answer", () => {
    registerDataSource(declaring("data", ["vessel.control.throttle"]));

    expect(
      classifyDeadRead("data", "vessel.control.throttle", false),
    ).toBeUndefined();
  });

  /** A diagnostic must never be the thing that breaks the run it is diagnosing. */
  it("treats a source whose schema throws as one that does not enumerate", () => {
    registerDataSource(
      source("legacy", () => {
        throw new Error("schema exploded");
      }),
    );

    expect(() =>
      classifyDeadRead("legacy", "vessel.control.thruttle", false),
    ).not.toThrow();
    expect(
      classifyDeadRead("legacy", "vessel.control.thruttle", false),
    ).toBeUndefined();
  });
});

/**
 * A status read and a plotted window are keyed by the whole Topic and hand the
 * key through untranslated for `isTopicCarried` to answer, so a bare Topic id
 * reaches a real channel and must not be accused.
 */
describe("classifying against the whole-Topic key vocabulary", () => {
  /** `useDataStreamStatus("data", "science.experimentBreakdown")` ships today. */
  it("resolves a bare Topic id, so the verdict is about the provider", () => {
    expect(
      classifyDeadRead("data", "science.experimentBreakdown", false),
    ).toEqual({
      kind: "no-provider-no-source",
      topic: "science.experimentBreakdown",
    });
  });

  it("stands aside for that Topic entirely once a stream is mounted", () => {
    expect(
      classifyDeadRead("data", "science.experimentBreakdown", true),
    ).toBeUndefined();
  });

  /** Accepting a whole Topic does not make a key that names nothing resolve. */
  it("reports a key that names neither a Topic nor a field of one", () => {
    expect(classifyDeadRead("data", "vessel.orbit.smaa", true)).toEqual(
      NO_SOURCE,
    );
  });

  /** A field path still resolves. */
  it("still resolves a field path when a whole Topic would also be accepted", () => {
    expect(
      classifyDeadRead("data", "vessel.control.throttle", true),
    ).toBeUndefined();
  });
});

describe("the dead-read message", () => {
  it("names the call that was written and says the wait was deliberate", () => {
    const message = deadReadMessage(
      "useDataSeries",
      "data",
      "vessel.control.thruttle",
      NO_SOURCE,
    );

    expect(message).toContain(
      'useDataSeries("data", "vessel.control.thruttle")',
    );
    expect(message).toContain("will never resolve");
    expect(message).toContain("not a slow start");
  });

  /** Each arm has its own fix, and a line carrying the wrong one is worse than none. */
  it("gives the unknown-key arm the field-path check and the Uplink check", () => {
    const message = deadReadMessage(
      "useDataSeries",
      "data",
      "vessel.control.thruttle",
      NO_SOURCE,
    );

    expect(message).toContain("No data source is registered");
    expect(message).toContain("Check the field path");
    expect(message).toContain("system.uplinks");
  });

  it("gives the schema arm the keys the source does declare, nearest first", () => {
    const message = deadReadMessage(
      "useDataSeries",
      "legacy",
      "vessel.control.thruttle",
      {
        kind: "no-topic-key-not-in-schema",
        sourceName: "Legacy Bridge",
        schemaKeys: ["science.experiments", "vessel.control.throttle"],
      },
    );

    expect(message).toContain('The data source "Legacy Bridge" IS registered');
    expect(message).toContain(
      'Nearest keys it does declare: "vessel.control.throttle", "science.experiments"',
    );
  });

  it("gives the no-provider arm the provider to mount, not a spelling check", () => {
    const message = deadReadMessage("useDataSeries", "data", "throttle", {
      kind: "no-provider-no-source",
      topic: "vessel.control.throttle",
    });

    expect(message).toContain("no TelemetryProvider is mounted");
    expect(message).toContain("SitrepTelemetryProvider");
    expect(message).not.toContain("names no field");
  });
});

describe("warnDeadRead", () => {
  const warn = vi.fn();
  let uninstall = () => {};

  beforeEach(() => {
    warn.mockClear();
    uninstall = installTestHost({ logger: { warn } as never });
  });
  afterEach(() => uninstall());

  it("logs the message once, with the read and its cause as structured context", () => {
    warnDeadRead("useDataSeries", "data", "vessel.control.thruttle", NO_SOURCE);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      deadReadMessage(
        "useDataSeries",
        "data",
        "vessel.control.thruttle",
        NO_SOURCE,
      ),
      {
        hook: "useDataSeries",
        dataSourceId: "data",
        key: "vessel.control.thruttle",
        cause: "no-topic-no-source",
      },
    );
  });

  /**
   * The read is re-evaluated on every render of every widget holding it, so an
   * ungated line would print thousands of times a minute and bury itself.
   */
  it("fires once per distinct read, not once per render", () => {
    warnDeadRead("useDataSeries", "data", "vessel.control.thruttle", NO_SOURCE);
    warnDeadRead("useDataSeries", "data", "vessel.control.thruttle", NO_SOURCE);
    warnDeadRead("useDataSeries", "data", "vessel.control.thruttle", NO_SOURCE);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still reports a second, different bad key on the same source", () => {
    warnDeadRead("useDataSeries", "data", "vessel.control.thruttle", NO_SOURCE);
    warnDeadRead("useDataSeries", "data", "vessel.control.pitchh", NO_SOURCE);

    expect(warn).toHaveBeenCalledTimes(2);
  });
});

/**
 * A diagnostic must never be the thing that breaks the run it is diagnosing.
 * The SDK's logger is a Proxy that throws when no host is installed, which is
 * the ordinary state of a unit test.
 */
describe("warnDeadRead with no host installed", () => {
  it("does not throw", () => {
    expect(() =>
      warnDeadRead(
        "useDataSeries",
        "data",
        "vessel.control.thruttle",
        NO_SOURCE,
      ),
    ).not.toThrow();
  });
});
