import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { registerTopicUnits } from "@ksp-gonogo/sitrep-sdk";
import {
  DEAD_READ_SETTLE_MS,
  resetDeadReadWarnings,
  resetGatedReadWarnings,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { installTestHost, StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import { useLegacyTelemetry } from "../test/legacyTelemetry";
import type { DataSource, DataSourceStatus } from "../types";
import { useTelemetry } from "./useTelemetry";

// Minimal in-memory legacy DataSource: same shape as useTelemetry.test.tsx's
// fixture, reused here to drive the "falls back to the legacy path" side of
// the shim.
function makeLegacySource(id = "data") {
  const dataListeners = new Map<string, Set<(v: unknown) => void>>();
  const statusListeners = new Set<(s: DataSourceStatus) => void>();

  const source: DataSource & {
    emit: (key: string, value: unknown) => void;
    setStatus: (s: DataSourceStatus) => void;
  } = {
    id,
    name: id,
    status: "connected" as DataSourceStatus,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    subscribe(key, cb) {
      if (!dataListeners.has(key)) dataListeners.set(key, new Set());
      dataListeners.get(key)?.add(cb);
      return () => dataListeners.get(key)?.delete(cb);
    },
    onStatusChange(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    emit(key, value) {
      dataListeners.get(key)?.forEach((cb) => {
        cb(value);
      });
    },
    setStatus(s) {
      source.status = s;
      statusListeners.forEach((cb) => {
        cb(s);
      });
    },
  };
  return source;
}

/**
 * A field of `dv.currentStageResource`, the derived channel joining `dv.stages`
 * and `vessel.structure`: one of the two production derived channels with two
 * inputs, so one that can show a gate reading EVERY input rather than the
 * first.
 */
const FUEL_KEY = "dv.currentStageResource.LiquidFuel";
const FUEL_INPUTS = ["dv.stages", "vessel.structure"];

/*
 * The channel exposes whatever resources the craft carries, so it declares no
 * field set of its own and the two-arg read has no field to route. Declaring
 * this one, the way an Uplink declares its own channel's fields, is what makes
 * the key a known field path.
 */
registerTopicUnits("dv.currentStageResource", { LiquidFuel: "units" });

function Fuel() {
  const fuel = useLegacyTelemetry("data", FUEL_KEY);
  return <div>fuel:{fuel === undefined ? NULL_DISPLAY : plain(fuel)}</div>;
}

beforeEach(() => clearRegistry());

/**
 * The probe's number, whichever side of the shim it came from.
 *
 * The legacy data-source path yields a bare number; the STREAM path yields a
 * declared quantity, because the decode wraps it. That the two disagree is
 * the shim's nature, not a defect: it exists to make one call site read from
 * either, and it is being retired.
 */
function plain(v: unknown): string {
  return String(
    v !== null && typeof v === "object" && "magnitude" in v
      ? (v as { magnitude: unknown }).magnitude
      : v,
  );
}

describe("useTelemetry shim: mapped key routes to useStream when a TelemetryProvider is mounted", () => {
  it(
    "a DERIVED field key resolves through the real client -> TimelineStore -> hooks pipeline once its " +
      "inputs' wire frames arrive, subscribing those inputs and never the derived name",
    async () => {
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      render(
        // A derived key only routes to the stream once its raw inputs are
        // carried. `StubTransport` declares no `carriedChannels` (it is
        // test-scriptable, not a serving guarantee), so this promotes both
        // inputs explicitly. Without it the key would stay on the legacy path
        // and this test would never exercise the stream. The gate has its own
        // coverage in `useTelemetry gate: carried-channels allowlist` below.
        <TelemetryProvider client={client} carriedChannels={FUEL_INPUTS}>
          <Fuel />
        </TelemetryProvider>,
      );

      // Undefined-while-loading: the same contract widgets already rely on.
      expect(screen.getByText(`fuel:${NULL_DISPLAY}`)).toBeTruthy();

      // Subscribing the DERIVED key subscribes its declared raw INPUTS on the
      // wire, never the derived name itself, which no server channel produces.
      expect(transport.isSubscribed("dv.stages")).toBe(true);
      expect(transport.isSubscribed("vessel.structure")).toBe(true);
      expect(transport.isSubscribed("dv.currentStageResource")).toBe(false);
      expect(transport.isSubscribed(FUEL_KEY)).toBe(false);

      // Feeding the legacy DataSource must NOT surface: the key is routed to
      // the stream, so the old path is bypassed entirely.
      act(() => legacySource.emit(FUEL_KEY, 999));
      expect(screen.getByText(`fuel:${NULL_DISPLAY}`)).toBeTruthy();

      act(() => {
        transport.emit("vessel.structure", { currentStage: 0 });
        transport.emit("dv.stages", [
          { stage: 0, resources: { LiquidFuel: { current: 360, max: 720 } } },
        ]);
      });

      // `TelemetryProvider` coalesces `beginFrame()` to the next animation
      // frame rather than minting one per ingest, so the derived read resolves
      // one frame after the emits, not synchronously.
      await waitFor(() => expect(screen.getByText("fuel:360")).toBeTruthy());
    },
  );
});

describe("useTelemetry shim: unmapped key falls back to the legacy DataSource path even with a provider mounted", () => {
  it("a known-gap key ('career.status.economy.notAField') ignores the TelemetryClient and reads the legacy DataSource", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Funds() {
      const funds = useLegacyTelemetry(
        "data",
        "career.status.economy.notAField",
      );
      return (
        <div>funds:{funds === undefined ? NULL_DISPLAY : String(funds)}</div>
      );
    }

    render(
      <TelemetryProvider client={client}>
        <Funds />
      </TelemetryProvider>,
    );

    expect(screen.getByText(`funds:${NULL_DISPLAY}`)).toBeTruthy();

    // A sample on the new SDK for an unmapped key must have no effect.
    act(() => transport.emit("career.status.economy.notAField", 500));
    expect(screen.getByText(`funds:${NULL_DISPLAY}`)).toBeTruthy();

    // The legacy DataSource is what still drives it.
    act(() => legacySource.emit("career.status.economy.notAField", 289_848));
    expect(screen.getByText("funds:289848")).toBeTruthy();
  });
});

describe("useTelemetry shim: no TelemetryProvider mounted behaves exactly like the pre-shim hook", () => {
  it("a mapped key with no provider in the tree still reads the legacy DataSource (unmigrated screens keep working)", () => {
    const source = makeLegacySource();
    registerDataSource(source);

    // No <TelemetryProvider> wrapper at all: this is every screen today.
    const { result } = renderHook(() =>
      useLegacyTelemetry("data", "vessel.flight.altitudeAsl"),
    );

    expect(result.current).toBeUndefined();
    act(() => source.emit("vessel.flight.altitudeAsl", 80_000));
    expect(result.current).toBe(80_000);
  });

  it("clears to undefined on disconnect: the legacy-path contract is untouched by the shim", () => {
    const source = makeLegacySource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useLegacyTelemetry("data", "vessel.flight.altitudeAsl"),
    );
    act(() => source.emit("vessel.flight.altitudeAsl", 80_000));
    expect(result.current).toBe(80_000);

    act(() => source.setStatus("disconnected"));
    expect(result.current).toBeUndefined();
  });
});

describe("useTelemetry shim: raw-field phantom fallback (M3 whole-branch review #2)", () => {
  it(
    "falls back to legacy when a mapped raw-field's field is missing from an otherwise-whole parent record " +
      "(wire-shape drift / a wrong fieldpath), instead of serving a permanent dead undefined",
    async () => {
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      function Throttle() {
        const throttle = useLegacyTelemetry("data", "vessel.control.throttle");
        return (
          <div>
            throttle:{throttle === undefined ? NULL_DISPLAY : plain(throttle)}
          </div>
        );
      }

      const renderTree = () => (
        // "vessel.control.throttle" maps to the raw-field subtopic
        // "vessel.control.throttle", resolved down to the real wire topic
        // "vessel.control" (see the carried-channels gate test above).
        <TelemetryProvider client={client} carriedChannels={["vessel.control"]}>
          <Throttle />
        </TelemetryProvider>
      );
      const { rerender } = render(renderTree());

      expect(screen.getByText(`throttle:${NULL_DISPLAY}`)).toBeTruthy();

      act(() => legacySource.emit("vessel.control.throttle", 0.4));
      // Still streamed (carried), so the legacy emit must not surface yet,
      // even though the eventual wire record will turn out not to carry the
      // mapped field.
      expect(screen.getByText(`throttle:${NULL_DISPLAY}`)).toBeTruthy();

      // The parent record arrives WHOLE but WITHOUT the mapped field, a
      // drifted/wrong wire shape, or a phantom migration-table entry (the
      // FuelStatus-class bug from the review: `?? 0` would otherwise mask
      // this as an empty gauge instead of falling back).
      act(() => {
        transport.emit("vessel.control", { notThrottle: 1 });
      });

      // The streamed VALUE itself stays `undefined` both before and after
      // this ingest (loading -> genuinely-absent-field are both
      // `undefined`), so `useSyncExternalStore`'s own change-detection never
      // fires a re-render on its own, by design, it only notifies on an
      // actual snapshot change. `rerender` forces React to re-execute the
      // hook regardless, the same way any OTHER prop/state change on a real
      // widget would, `renderTree()` must build a FRESH element each call
      // (not a reused constant): React/RTL treat handing the exact same
      // element object back to `rerender` as a no-op. Retried via `waitFor`
      // to give the provider's coalesced `beginFrame()`
      // (rAF/setTimeout-scheduled) a chance to actually run first.
      //
      // Before the fix: stays NULL_DISPLAY forever even after any number of
      // rerenders: a permanently-dead undefined: even though a perfectly
      // good legacy value exists. After the fix:
      // `TimelineStore.isUnresolvableField`'s raw-field branch fires and the
      // shim falls back to the legacy value.
      await waitFor(() => {
        rerender(renderTree());
        expect(screen.getByText("throttle:0.4")).toBeTruthy();
      });
    },
  );
});

describe("useTelemetry gate: M3 Wave 0 carried-channels allowlist (the big-bang blank-out fix, m3-migration-plan.md §5.1)", () => {
  it(
    "a MAPPED topic NOT in carriedChannels reads the LEGACY value, never a blank, " +
      "RED before the gate (mapped + provider mounted always won, permanently blanking an unserved topic), GREEN after",
    () => {
      const client = new TelemetryClient(new StubTransport());
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      // No `carriedChannels` prop at all: the key is a field of a DERIVED
      // topic whose inputs are not carried.
      render(
        <TelemetryProvider client={client}>
          <Fuel />
        </TelemetryProvider>,
      );

      expect(screen.getByText(`fuel:${NULL_DISPLAY}`)).toBeTruthy();

      // Legacy still drives the read, this is the crux of the fix: before
      // the gate, mapping + a mounted provider always won, so this legacy
      // emit would have had NO effect and the widget would render blank
      // forever even though a perfectly good legacy value exists.
      act(() => legacySource.emit(FUEL_KEY, 80_000));
      expect(screen.getByText("fuel:80000")).toBeTruthy();
    },
  );

  it("a MAPPED topic IN carriedChannels streams (never falls back to legacy)", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Throttle() {
      const throttle = useLegacyTelemetry("data", "vessel.control.throttle");
      return (
        <div>
          throttle:{throttle === undefined ? NULL_DISPLAY : plain(throttle)}
        </div>
      );
    }

    render(
      // Promoting "vessel.control": the REAL raw wire topic ("vessel.control.throttle"
      // maps to the raw-field subtopic "vessel.control.throttle", which
      // TimelineStore.resolveSubscriptionTopics resolves down to its actual
      // wire dependency, "vessel.control": see the M3 pilot's
      // timeline-store-raw-fields.test.ts). The wire never publishes a
      // literal "vessel.control.throttle" topic; only the whole
      // "vessel.control" record does.
      <TelemetryProvider client={client} carriedChannels={["vessel.control"]}>
        <Throttle />
      </TelemetryProvider>,
    );

    expect(screen.getByText(`throttle:${NULL_DISPLAY}`)).toBeTruthy();

    // Legacy emits must NOT surface, the carried topic is routed to the
    // stream, bypassing legacy entirely.
    act(() => legacySource.emit("vessel.control.throttle", 0.4));
    expect(screen.getByText(`throttle:${NULL_DISPLAY}`)).toBeTruthy();

    // Emitting to the real raw topic ("vessel.control", a whole record),
    // never the never-published dotted field string.
    act(() => transport.emit("vessel.control", { throttle: 0.75 }));
    await waitFor(() => expect(screen.getByText("throttle:0.75")).toBeTruthy());
  });

  it("a DERIVED topic is carried only when ALL of its inputs are carried, one carried input is not enough", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    render(
      // Only ONE of the channel's two declared inputs is promoted.
      <TelemetryProvider client={client} carriedChannels={["dv.stages"]}>
        <Fuel />
      </TelemetryProvider>,
    );

    expect(screen.getByText(`fuel:${NULL_DISPLAY}`)).toBeTruthy();

    // Still legacy: the derived channel can never produce a whole record
    // with a missing input, so it must not be treated as carried.
    act(() => legacySource.emit(FUEL_KEY, 12_345));
    expect(screen.getByText("fuel:12345")).toBeTruthy();

    // Feeding the (partially) carried input must not flip it to streamed,
    // the legacy value must keep winning.
    act(() => {
      transport.emit("dv.stages", [
        { stage: 0, resources: { LiquidFuel: { current: 360, max: 720 } } },
      ]);
    });
    expect(screen.getByText("fuel:12345")).toBeTruthy();
  });

  it(
    "MONOTONIC: promoting a topic flips legacy -> stream, and a later render that omits the " +
      "promotion does NOT flip it back to legacy mid-session",
    async () => {
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      const { rerender } = render(
        <TelemetryProvider client={client}>
          <Fuel />
        </TelemetryProvider>,
      );

      // Not yet carried: legacy drives it.
      act(() => legacySource.emit(FUEL_KEY, 1));
      expect(screen.getByText("fuel:1")).toBeTruthy();

      // Promote both inputs.
      rerender(
        <TelemetryProvider client={client} carriedChannels={FUEL_INPUTS}>
          <Fuel />
        </TelemetryProvider>,
      );

      act(() => {
        transport.emit("vessel.structure", { currentStage: 0 });
        transport.emit("dv.stages", [
          { stage: 0, resources: { LiquidFuel: { current: 360, max: 720 } } },
        ]);
      });
      await waitFor(() => expect(screen.getByText("fuel:360")).toBeTruthy());

      // A later render whose `carriedChannels` prop OMITS the promotion
      // entirely must not un-carry it, the allowlist only ever grows for
      // the life of this mounted provider.
      rerender(
        <TelemetryProvider client={client}>
          <Fuel />
        </TelemetryProvider>,
      );
      expect(screen.getByText("fuel:360")).toBeTruthy();

      // And legacy emits still must not surface, proving it's genuinely
      // still on the stream path, not coincidentally matching.
      act(() => legacySource.emit(FUEL_KEY, 999));
      expect(screen.getByText("fuel:360")).toBeTruthy();
    },
  );
});

/**
 * The gate's precondition, which nothing in the block above tests.
 *
 * Every case up there registers a legacy `DataSource` before rendering, so
 * "not carried" always has somewhere to land. Production registers no source
 * with id `"data"` at all: the flat-key source the gate was written to protect
 * is deleted. So on the two-arg surface the gate was choosing between the
 * stream and silence, and the canonical one-arg read of the same topic was
 * unaffected because it skips the gate.
 */
describe("useTelemetry gate: it prefers the legacy read, it does not exclude the stream", () => {
  it("serves the streamed value for an uncarried topic when NO legacy DataSource is registered, matching what the canonical read of the same topic sees", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    // Deliberately no registerDataSource: this is what the app looks like.

    function Probe() {
      const legacy = useLegacyTelemetry("data", "vessel.control.throttle");
      const canonical = useTelemetry("vessel.control");
      const streamed =
        canonical.state === "observed" ? canonical.value.throttle : undefined;
      return (
        <div>
          <div>
            legacy:{legacy === undefined ? NULL_DISPLAY : plain(legacy)}
          </div>
          <div>
            canonical:
            {streamed === undefined ? NULL_DISPLAY : plain(streamed)}
          </div>
        </div>
      );
    }

    // "vessel.control" is deliberately absent from the allowlist: a topic the
    // wire genuinely delivers can be missing from it, because the list is
    // seeded from declarations and a promotion list, not from what arrives.
    render(
      <TelemetryProvider client={client}>
        <Probe />
      </TelemetryProvider>,
    );

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));

    await waitFor(() =>
      expect(screen.getByText("canonical:0.75")).toBeTruthy(),
    );
    // RED before the fix: the gate short-circuited the subscription, so this
    // rendered the null display for ever while the canonical read beside it,
    // on the same topic in the same component, showed the value.
    expect(screen.getByText("legacy:0.75")).toBeTruthy();
  });

  it("still prefers the LEGACY value for an uncarried topic when the legacy source has one, even though the stream also does", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeLegacySource();
    registerDataSource(legacySource);

    function Throttle() {
      const throttle = useLegacyTelemetry("data", "vessel.control.throttle");
      return (
        <div>
          throttle:{throttle === undefined ? NULL_DISPLAY : plain(throttle)}
        </div>
      );
    }

    render(
      <TelemetryProvider client={client}>
        <Throttle />
      </TelemetryProvider>,
    );

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));
    act(() => legacySource.emit("vessel.control.throttle", 0.4));

    // The gate's whole point, unchanged: an uncarried topic reads the working
    // legacy value. The streamed one is the tie-break for when there is none,
    // never a replacement for one that exists.
    await waitFor(() => expect(screen.getByText("throttle:0.4")).toBeTruthy());
  });

  /**
   * Why the silence was undetectable, and why it now is not.
   *
   * `installUnownedTopicWarning` is the diagnostic built for a read that will
   * never resolve, and it is mounted on every `TelemetryProvider`. It hears
   * only about topics something subscribed to, so a gate that returned before
   * `client.subscribe` made its own failure mode invisible to the one
   * instrument that would have named it.
   */
  it("subscribes an uncarried two-arg read, so the unowned-topic diagnostic can see it", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    function Throttle() {
      useLegacyTelemetry("data", "vessel.control.throttle");
      return <div>probe</div>;
    }

    render(
      <TelemetryProvider client={client}>
        <Throttle />
      </TelemetryProvider>,
    );

    expect(transport.isSubscribed("vessel.control")).toBe(true);
  });
});

/**
 * The rescue is not meant to be a place a call site quietly lives. The one
 * moment it is observable is the one where both candidate values are in hand,
 * so the report is raised from the read itself, and this is the wiring test
 * that says the read raises it. `gated-read-warning.test.ts` covers the
 * message and the once-per-key gate.
 */
describe("useTelemetry gate: a rescued read reports itself", () => {
  const warn = vi.fn();
  let uninstall = () => {};

  beforeEach(() => {
    warn.mockClear();
    resetGatedReadWarnings();
    uninstall = installTestHost({ logger: { warn } as never });
  });
  afterEach(() => uninstall());

  it("logs the call site, the topic that served it, and the canonical form to move to", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    function Throttle() {
      const throttle = useLegacyTelemetry("data", "vessel.control.throttle");
      return (
        <div>
          throttle:{throttle === undefined ? NULL_DISPLAY : plain(throttle)}
        </div>
      );
    }

    render(
      <TelemetryProvider client={client}>
        <Throttle />
      </TelemetryProvider>,
    );

    expect(warn).not.toHaveBeenCalled();

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'useTelemetry("data", "vessel.control.throttle")',
    );
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'useTelemetry("vessel.control")',
    );
  });

  /**
   * A registered source that has not emitted yet is rescued too, and must not
   * be accused: the report fires once per read for the whole session, so a
   * line raised for a transient would outlive its own cause.
   */
  it("says nothing when a legacy source is registered but has yet to emit", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    registerDataSource(makeLegacySource());

    function Throttle() {
      const throttle = useLegacyTelemetry("data", "vessel.control.throttle");
      return (
        <div>
          throttle:{throttle === undefined ? NULL_DISPLAY : plain(throttle)}
        </div>
      );
    }

    render(
      <TelemetryProvider client={client}>
        <Throttle />
      </TelemetryProvider>,
    );

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));

    await waitFor(() => expect(screen.getByText("throttle:0.75")).toBeTruthy());
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * The silence the gate's own report cannot see.
 *
 * `warnGatedRead` above needs a streamed value in hand, so the one read it can
 * never speak about is the one that resolves to NOTHING: no topic to subscribe
 * and no source to ask. That read ships silent and leaves a widget blank for
 * ever, which is the failure worth being loud about.
 *
 * Both directions are pinned here, and the second matters more: the verdict is
 * deferred by `DEAD_READ_SETTLE_MS` and re-derived from the registries at the
 * moment it fires, precisely so an Uplink that registers its Topics after the
 * dashboard has rendered cancels the report instead of being accused by it.
 */
describe("useTelemetry: a read that resolves to nothing says so", () => {
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
    const value = useLegacyTelemetry("data", dataKey);
    return <div>read:{value === undefined ? NULL_DISPLAY : plain(value)}</div>;
  }

  function settle() {
    act(() => {
      vi.advanceTimersByTime(DEAD_READ_SETTLE_MS + 1);
    });
  }

  /**
   * Scoped to this diagnostic rather than `warn` as a whole: a read the stream
   * rescues raises the GATED-read line, which is correct and is that
   * diagnostic's business. Asserting on every warning would make these tests
   * fail on a sibling's success.
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
      'useTelemetry("data", "vessel.control.thruttle")',
    );
    expect(message).toContain("will never resolve");
    expect(message).toContain("No data source is registered");
  });

  /** A read that is answering is not a read to complain about. */
  it("says nothing about a read the stream resolves", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    render(
      <TelemetryProvider client={client}>
        <Probe dataKey="vessel.control.throttle" />
      </TelemetryProvider>,
    );

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));
    settle();

    expect(deadReadLines()).toEqual([]);
  });

  /**
   * A registered source that has not emitted yet is the ordinary state of a
   * screen that has just connected, and it is not evidence of anything.
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
   * The startup race, and the reason the report is deferred at all.
   *
   * An Uplink registers its Topics when its BUNDLE loads, which is after the app
   * has rendered, so this read is genuinely dead on the first frame and
   * perfectly healthy a moment later. Firing on the spot would accuse every
   * startup, and a warning that fires on healthy startups is one nobody reads.
   */
  it("says nothing when an Uplink registers the Topic after the read first ran", () => {
    const client = new TelemetryClient(new StubTransport());

    render(
      <TelemetryProvider client={client}>
        <Probe dataKey="lateuplink.reactor.coreTempK" />
      </TelemetryProvider>,
    );

    // Half the window in, still dead, and nothing said yet.
    act(() => {
      vi.advanceTimersByTime(DEAD_READ_SETTLE_MS / 2);
    });
    expect(deadReadLines()).toEqual([]);

    /*
     * The bundle lands, mid-window. `registerTopicUnits` notifies the runtime
     * topic registry, which the provider watches, so this re-renders the tree
     * and has to be inside `act` for that reason alone.
     */
    act(() => registerTopicUnits("lateuplink.reactor", { coreTempK: "K" }));

    settle();

    expect(deadReadLines()).toEqual([]);
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
