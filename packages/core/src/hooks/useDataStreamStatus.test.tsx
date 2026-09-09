import {
  DEAD_READ_SETTLE_MS,
  resetDeadReadWarnings,
  resetGatedReadWarnings,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { registerTopicUnits } from "@ksp-gonogo/sitrep-sdk";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource, DataSourceStatus } from "../types";
import { useDataStreamStatus } from "./useDataStreamStatus";

function makeLegacySource(id = "data") {
  const statusListeners = new Set<(s: DataSourceStatus) => void>();
  const source: DataSource & { setStatus: (s: DataSourceStatus) => void } = {
    id,
    name: id,
    status: "connected",
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    onStatusChange(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    setStatus(s) {
      source.status = s;
      for (const cb of statusListeners) cb(s);
    },
  };
  return source;
}

beforeEach(() => clearRegistry());

/**
 * `useDataStreamStatus`: the M3 "adopt staleness/certainty" shim
 * (`m3-migration-plan.md` §2 item 3, the "convert cleared-assertions into
 * held-stale-assertions" step): the third leg alongside `useDataValue`
 * (read) / `useExecuteAction` (write). Same dual-path contract: no provider
 * (or an uncarried/unmapped key) reads a legacy-DataSource-status-derived
 * value; a carried, mapped key reads the real `StreamStatusValue` off the
 * `TimelineStore`.
 */
describe("useDataStreamStatus: no TelemetryProvider mounted", () => {
  it("maps the legacy DataSource status onto a StreamStatusValue", () => {
    const source = makeLegacySource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useDataStreamStatus("data", "time.warp.warpRate"),
    );
    expect(result.current).toBe("live");

    act(() => source.setStatus("disconnected"));
    expect(result.current).toBe("disconnected");

    act(() => source.setStatus("reconnecting"));
    expect(result.current).toBe("held-stale");

    act(() => source.setStatus("error"));
    expect(result.current).toBe("disconnected");
  });

  it("defaults to disconnected when the source isn't registered", () => {
    const { result } = renderHook(() =>
      useDataStreamStatus("data", "time.warp.warpRate"),
    );
    expect(result.current).toBe("disconnected");
  });
});

describe("useDataStreamStatus: mapped + carried key reads the real stream status", () => {
  it("resyncing before any data, live once the raw topic arrives", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Status() {
      const status = useDataStreamStatus("data", "time.warp.warpRate");
      return <div>status:{status}</div>;
    }

    render(
      <TelemetryProvider client={client} carriedChannels={["time.warp"]}>
        <Status />
      </TelemetryProvider>,
    );

    expect(screen.getByText("status:resyncing")).toBeTruthy();

    act(() => {
      transport.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() => expect(screen.getByText("status:live")).toBeTruthy());

    // Legacy status changes must not surface once the key is carried.
    act(() => legacySource.setStatus("disconnected"));
    expect(screen.getByText("status:live")).toBeTruthy();
  });
});

/**
 * The third hook with this shape, after `useWidgetStreamStatus` and
 * `useDataSeries`. Each was written to TRANSLATE the old vocabulary, and none
 * was written to accept the new one, so each rejected a modern path and fell
 * back to the legacy `"data"` `DataSource` that nothing registers in
 * production. A widget migrating its key would silently lose its status.
 */
describe("useDataStreamStatus: a MODERN topic reads the real stream status", () => {
  it("reads the same status the legacy key does, for the key it replaces", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Status() {
      const status = useDataStreamStatus("data", "time.warp.warpRate");
      return <div>status:{status}</div>;
    }

    render(
      <TelemetryProvider client={client} carriedChannels={["time.warp"]}>
        <Status />
      </TelemetryProvider>,
    );

    expect(screen.getByText("status:resyncing")).toBeTruthy();

    act(() => {
      transport.emit("time.warp", {
        warpRate: 1,
        warpRateIndex: 0,
        warpMode: 0,
        paused: false,
      });
    });
    await waitFor(() => expect(screen.getByText("status:live")).toBeTruthy());

    act(() => legacySource.setStatus("disconnected"));
    expect(screen.getByText("status:live")).toBeTruthy();
  });
});

describe("useDataStreamStatus: mapped but NOT carried falls back to legacy status", () => {
  it("reads the legacy status when the provider hasn't carried the topic yet", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    const { result } = renderHook(
      () => useDataStreamStatus("data", "time.warp.warpRate"),
      {
        wrapper: ({ children }) => (
          <TelemetryProvider client={client}>{children}</TelemetryProvider>
        ),
      },
    );

    expect(result.current).toBe("live");
    act(() => legacySource.setStatus("disconnected"));
    expect(result.current).toBe("disconnected");
  });
});

/**
 * The gate's precondition, which nothing above it tests.
 *
 * Every case up there registers a legacy `DataSource` before rendering, so
 * "not carried" always has a status to fall back to. Nothing in the app
 * registers a source under `"data"`, which this hook's own `topic` comment
 * already says about the mapping half ("no status, forever, with nothing
 * failing"), and is equally true of the gate half beside it. The unregistered
 * fallback is `"disconnected"`, so the failure here is not silence but a
 * confidently wrong answer: a disconnected badge printed beside a value the
 * same widget is reading live off the stream.
 */
describe("useDataStreamStatus gate: it prefers the legacy status, it does not exclude the stream", () => {
  it("reads the real stream status for an uncarried topic when NO legacy DataSource is registered", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    // Deliberately no registerDataSource: this is what the app looks like.

    function Probe() {
      const status = useDataStreamStatus("data", "vessel.control");
      return <div>status:{status}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Probe />
      </TelemetryProvider>,
    );

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));

    // RED before the fix: "disconnected" for ever, because the gate handed the
    // read to a source that was never registered.
    await waitFor(() => expect(screen.getByText("status:live")).toBeTruthy());
  });

  it("still prefers the LEGACY status for an uncarried topic when a source is registered", () => {
    const client = new TelemetryClient(new StubTransport());
    const source = makeLegacySource();
    source.status = "reconnecting";
    registerDataSource(source);

    function Probe() {
      const status = useDataStreamStatus("data", "vessel.control");
      return <div>status:{status}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Probe />
      </TelemetryProvider>,
    );

    // The gate's whole point, unchanged: an uncarried topic reports the legacy
    // source's own status, which is a real fact about a real source.
    expect(screen.getByText("status:held-stale")).toBeTruthy();
  });
});

/**
 * `ScienceData` is the one production caller, and a status badge is chrome: no
 * one notices a wrong one the way they notice a blank value. So the rescue has
 * to report itself, or the allowlist gap behind it never gets closed.
 */
describe("useDataStreamStatus gate: a rescued status reports itself", () => {
  const warn = vi.fn();
  let uninstall = () => {};

  beforeEach(() => {
    warn.mockClear();
    resetGatedReadWarnings();
    uninstall = installTestHost({ logger: { warn } as never });
  });
  afterEach(() => uninstall());

  it("names the call, the topic that served it, and the promotion that would make it deliberate", async () => {
    const client = new TelemetryClient(new StubTransport());

    function Probe() {
      const status = useDataStreamStatus("data", "vessel.control");
      return <div>status:{status}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Probe />
      </TelemetryProvider>,
    );

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('useDataStreamStatus("data", "vessel.control")');
    expect(message).toContain("DEFAULT_SITREP_CARRIED_TOPICS");
  });

  /**
   * The registration signal this hook rescues on is only known once
   * `useDataSourceSubscription`'s subscribe has run, so on the very first
   * render it reads `undefined` whether or not a source exists. If the report
   * escaped in that window it would be permanent, because it fires once per
   * read: an uncarried topic with a perfectly good legacy source would be
   * accused for the rest of the session.
   */
  it("says nothing when the legacy source is registered, however early the first render reads", async () => {
    const client = new TelemetryClient(new StubTransport());
    registerDataSource(makeLegacySource());

    function Probe() {
      const status = useDataStreamStatus("data", "vessel.control");
      return <div>status:{status}</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Probe />
      </TelemetryProvider>,
    );

    await waitFor(() => expect(screen.getByText("status:live")).toBeTruthy());
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * The silence the gate's own report cannot see.
 *
 * `warnGatedRead` above needs both candidate reads in hand, so the read it can
 * never speak about is the one that resolves to NOTHING: no channel to grade
 * and no source to ask. On this hook that is the worse of the two silences,
 * because it does not go blank. It returns the unregistered floor,
 * `"disconnected"`, so a perfectly connected screen wears a link-down badge
 * for the rest of the session and nothing anywhere fails.
 *
 * Both directions are pinned, and the last one matters most: the verdict is
 * deferred by `DEAD_READ_SETTLE_MS` and re-derived at the moment it fires, so
 * an Uplink that registers its Topics after the dashboard has rendered cancels
 * the report rather than being accused by it.
 */
describe("useDataStreamStatus: a status read that resolves to nothing says so", () => {
  const warn = vi.fn();
  let uninstall = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    warn.mockClear();
    resetDeadReadWarnings();
    uninstall = installTestHost({ logger: { warn } as never });
  });
  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  function Probe({ dataKey }: { dataKey: string }) {
    const status = useDataStreamStatus("data", dataKey);
    return <div>status:{status}</div>;
  }

  function settle() {
    act(() => {
      vi.advanceTimersByTime(DEAD_READ_SETTLE_MS + 1);
    });
  }

  /**
   * Scoped to this diagnostic rather than `warn` as a whole: a status the
   * stream rescues raises the GATED-read line, which is correct and is that
   * diagnostic's business.
   */
  function deadReadLines(): string[] {
    return warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.startsWith("[dead read]"));
  }

  it("names the call, the reason it can never resolve, and what to write instead", () => {
    const client = new TelemetryClient(new StubTransport());

    render(
      <TelemetryProvider client={client}>
        <Probe dataKey="vessel.control.thruttle" />
      </TelemetryProvider>,
    );

    expect(deadReadLines()).toEqual([]);
    settle();

    expect(deadReadLines()).toHaveLength(1);
    const message = deadReadLines()[0] ?? "";
    expect(message).toContain(
      'useDataStreamStatus("data", "vessel.control.thruttle")',
    );
    expect(message).toContain("will never resolve");
    expect(message).toContain("No data source is registered");
  });

  /** A carried channel is grading this status, so there is nothing to report. */
  it("says nothing about a status the stream resolves", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    render(
      <TelemetryProvider client={client}>
        <Probe dataKey="vessel.control" />
      </TelemetryProvider>,
    );

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));
    settle();

    expect(deadReadLines()).toEqual([]);
  });

  /**
   * A registered source is a source that could still answer, and its status is
   * a real status rather than the floor.
   */
  it("says nothing when a registered source could still answer", () => {
    const client = new TelemetryClient(new StubTransport());
    registerDataSource(makeLegacySource());

    render(
      <TelemetryProvider client={client}>
        <Probe dataKey="vessel.control.thruttle" />
      </TelemetryProvider>,
    );

    settle();

    expect(deadReadLines()).toEqual([]);
  });

  /**
   * The startup race, and the reason the report is deferred at all. An Uplink
   * registers its Topics when its BUNDLE loads, which is after the app has
   * rendered, so this read is genuinely dead on the first frame and healthy a
   * moment later.
   */
  it("says nothing when an Uplink registers the Topic after the read first ran", () => {
    const client = new TelemetryClient(new StubTransport());

    render(
      <TelemetryProvider client={client}>
        <Probe dataKey="latestatus.reactor.coreTempK" />
      </TelemetryProvider>,
    );

    // Half the window in, still dead, and nothing said yet.
    act(() => {
      vi.advanceTimersByTime(DEAD_READ_SETTLE_MS / 2);
    });
    expect(deadReadLines()).toEqual([]);

    act(() => registerTopicUnits("latestatus.reactor", { coreTempK: "K" }));

    settle();

    expect(deadReadLines()).toEqual([]);
  });

  /**
   * A status is keyed by a WHOLE Topic as readily as by a field path within
   * one, and `science.experimentBreakdown` (the one such call the app ships)
   * is a bare Topic id. Resolved against the field-path vocabulary alone it
   * names nothing, so the diagnostic would reach for the wrong arm and tell
   * the author their Topic declares no such field. The screen's actual defect
   * is that nothing is streaming, and that is what has to be said.
   */
  it("names the missing provider, not a missing field, for a key that IS a whole Topic", () => {
    render(<Probe dataKey="science.experimentBreakdown" />);

    settle();

    expect(deadReadLines()).toHaveLength(1);
    const message = deadReadLines()[0] ?? "";
    expect(message).toContain("no TelemetryProvider is mounted");
    expect(message).toContain('"science.experimentBreakdown"');
    expect(message).not.toContain("names no field");
  });

  /** Once per distinct read: two widgets holding the same bad call is one line. */
  it("reports a given bad read once however many widgets hold it", () => {
    const client = new TelemetryClient(new StubTransport());

    render(
      <TelemetryProvider client={client}>
        <Probe dataKey="vessel.control.thruttle" />
        <Probe dataKey="vessel.control.thruttle" />
      </TelemetryProvider>,
    );

    settle();

    expect(deadReadLines()).toHaveLength(1);
  });
});
