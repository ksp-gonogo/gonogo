import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  type VesselFlightPayload,
  type VesselOrbitPayload,
  type WireOf,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { resetGatedReadWarnings } from "@ksp-gonogo/sitrep-sdk/spine";
import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
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

// Minimal in-memory legacy DataSource: same shape as useTelemetry.test.ts's
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

const ORBIT: WireOf<VesselOrbitPayload> = {
  referenceBodyIndex: 1,
  sma: 700_000,
  ecc: 0,
  inc: 0,
  lan: null,
  argPe: null,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.5316e12,
};

const FLIGHT: WireOf<VesselFlightPayload> = {
  latitude: -0.05,
  longitude: 42.3,
  altitudeAsl: 71_234,
  altitudeTerrain: 71_234,
  verticalSpeed: 12.5,
  surfaceSpeed: 1780.2,
  orbitalSpeed: 1790.9,
  gForce: 1.1,
  dynamicPressureKPa: 3.2,
  mach: 5.1,
  atmDensity: 0.01,
};

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
    "the M2 bridge's key end-to-end proof: 'vessel.state.altitudeAsl' (-> vessel.state.altitudeAsl, a DERIVED " +
      "channel) resolves through the real client -> TimelineStore -> hooks pipeline once real " +
      "vessel.orbit/vessel.flight wire frames arrive: RED before the bridge (permanently dead " +
      "undefined, since nothing fed a TimelineStore in production), GREEN after it",
    async () => {
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      function Alt() {
        const alt = useLegacyTelemetry("data", "vessel.state.altitudeAsl");
        return <div>alt:{alt === undefined ? NULL_DISPLAY : String(alt)}</div>;
      }

      render(
        // M3 Wave 0 carried-channels gate (`m3-migration-plan.md` §5.1): a
        // mapped topic only routes to the stream once its raw inputs are
        // actually carried. `StubTransport` doesn't declare
        // `carriedChannels` (it's test-scriptable, not a real serving
        // guarantee), so this test explicitly promotes the four raw inputs
        // `vessel.state.altitudeAsl` resolves to (vessel-state-extend, M3:
        // `vesselStateChannel.inputs` grew to include `vessel.identity`/
        // `system.bodies` for `met`/apoapsides: the carried-channels gate
        // is parent-channel-scoped, so EVERY `vessel.state.*` field,
        // including this one, now needs all four carried, not just the two
        // it happens to read), the "dev-first per-topic opt-in" half of the
        // gate. Without this, the mapped topic would stay on the legacy path
        // and the rest of this test (which proves the DERIVED-channel
        // wiring) would never even exercise the stream. See `useTelemetry
        // gate: carried-channels allowlist` below for the gate's own
        // dedicated coverage.
        <TelemetryProvider
          client={client}
          carriedChannels={[
            "vessel.orbit",
            "vessel.flight",
            "vessel.identity",
            "system.bodies",
            "vessel.control",
            "vessel.target",
            "vessel.comms",
            "vessel.propulsion",
          ]}
        >
          <Alt />
        </TelemetryProvider>,
      );

      // Undefined-while-loading: the same contract widgets already rely on.
      expect(screen.getByText(`alt:${NULL_DISPLAY}`)).toBeTruthy();

      // Derived-input ref-counting (Fix 1 item 3): subscribing the mapped
      // DERIVED topic must have subscribed its declared raw INPUTS on the
      // wire: never the derived topic name itself, which no server channel
      // ever produces.
      expect(transport.isSubscribed("vessel.orbit")).toBe(true);
      expect(transport.isSubscribed("vessel.flight")).toBe(true);
      expect(transport.isSubscribed("vessel.identity")).toBe(true);
      expect(transport.isSubscribed("system.bodies")).toBe(true);
      expect(transport.isSubscribed("vessel.state.altitudeAsl")).toBe(false);

      // Feeding the legacy DataSource must NOT surface, the mapped key is
      // routed to the stream, so the old path is bypassed entirely.
      act(() => legacySource.emit("vessel.state.altitudeAsl", 999));
      expect(screen.getByText(`alt:${NULL_DISPLAY}`)).toBeTruthy();

      // Feed REAL wire frames for the channel's actual inputs, orbit at
      // Loaded quality (so altitudeAsl comes off the measured vessel.flight
      // basis) plus the flight measurement itself. This is what the derived
      // vessel.state channel actually propagates from.
      act(() => {
        transport.emit("vessel.orbit", ORBIT, {
          quality: Quality.Loaded,
          source: "vessel:1",
        });
        transport.emit("vessel.flight", FLIGHT, {
          quality: Quality.Loaded,
          source: "vessel:1",
        });
      });

      // `TelemetryProvider` coalesces `beginFrame()` to the next animation
      // frame (sitrep-client M2 finalization Fix 1) rather than minting one
      // per ingest, so the derived read resolves one frame after the emits,
      // not synchronously.
      await waitFor(() => expect(screen.getByText("alt:71234")).toBeTruthy());
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
      useLegacyTelemetry("data", "vessel.state.altitudeAsl"),
    );

    expect(result.current).toBeUndefined();
    act(() => source.emit("vessel.state.altitudeAsl", 80_000));
    expect(result.current).toBe(80_000);
  });

  it("clears to undefined on disconnect: the legacy-path contract is untouched by the shim", () => {
    const source = makeLegacySource();
    registerDataSource(source);

    const { result } = renderHook(() =>
      useLegacyTelemetry("data", "vessel.state.altitudeAsl"),
    );
    act(() => source.emit("vessel.state.altitudeAsl", 80_000));
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

      function Alt() {
        const alt = useLegacyTelemetry("data", "vessel.state.altitudeAsl");
        return <div>alt:{alt === undefined ? NULL_DISPLAY : String(alt)}</div>;
      }

      // No `carriedChannels` prop at all: 'vessel.state.altitudeAsl' maps to a DERIVED
      // topic (`vessel.state.altitudeAsl`) whose inputs are not carried.
      render(
        <TelemetryProvider client={client}>
          <Alt />
        </TelemetryProvider>,
      );

      expect(screen.getByText(`alt:${NULL_DISPLAY}`)).toBeTruthy();

      // Legacy still drives the read, this is the crux of the fix: before
      // the gate, mapping + a mounted provider always won, so this legacy
      // emit would have had NO effect and the widget would render blank
      // forever even though a perfectly good legacy value exists.
      act(() => legacySource.emit("vessel.state.altitudeAsl", 80_000));
      expect(screen.getByText("alt:80000")).toBeTruthy();
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

    function Alt() {
      const alt = useLegacyTelemetry("data", "vessel.state.altitudeAsl");
      return <div>alt:{alt === undefined ? NULL_DISPLAY : String(alt)}</div>;
    }

    render(
      // Only ONE of vessel.state.altitudeAsl's two declared inputs
      // (vessel.orbit, vessel.flight) is promoted.
      <TelemetryProvider client={client} carriedChannels={["vessel.orbit"]}>
        <Alt />
      </TelemetryProvider>,
    );

    expect(screen.getByText(`alt:${NULL_DISPLAY}`)).toBeTruthy();

    // Still legacy: the derived channel can never produce a whole record
    // with a missing input, so it must not be treated as carried.
    act(() => legacySource.emit("vessel.state.altitudeAsl", 12_345));
    expect(screen.getByText("alt:12345")).toBeTruthy();

    // Feeding the (partially) carried input must not flip it to streamed,
    // the legacy value must keep winning.
    act(() => {
      transport.emit("vessel.orbit", ORBIT, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
    });
    expect(screen.getByText("alt:12345")).toBeTruthy();
  });

  it(
    "MONOTONIC: promoting a topic flips legacy -> stream, and a later render that omits the " +
      "promotion does NOT flip it back to legacy mid-session",
    async () => {
      const transport = new StubTransport();
      const client = new TelemetryClient(transport);
      const legacySource = makeLegacySource();
      registerDataSource(legacySource);

      function Alt() {
        const alt = useLegacyTelemetry("data", "vessel.state.altitudeAsl");
        return <div>alt:{alt === undefined ? NULL_DISPLAY : String(alt)}</div>;
      }

      const { rerender } = render(
        <TelemetryProvider client={client}>
          <Alt />
        </TelemetryProvider>,
      );

      // Not yet carried: legacy drives it.
      act(() => legacySource.emit("vessel.state.altitudeAsl", 1));
      expect(screen.getByText("alt:1")).toBeTruthy();

      // Promote all four inputs (vessel-state-extend, M3: vessel.state.*'s
      // carried-channels gate is parent-channel-scoped, so altitudeAsl needs
      // vessel.identity/system.bodies carried too now, even though it
      // doesn't itself read them; see vessel-state.ts's vesselStateChannel
      // doc comment).
      rerender(
        <TelemetryProvider
          client={client}
          carriedChannels={[
            "vessel.orbit",
            "vessel.flight",
            "vessel.identity",
            "system.bodies",
            "vessel.control",
            "vessel.target",
            "vessel.comms",
            "vessel.propulsion",
          ]}
        >
          <Alt />
        </TelemetryProvider>,
      );

      act(() => {
        transport.emit("vessel.orbit", ORBIT, {
          quality: Quality.Loaded,
          source: "vessel:1",
        });
        transport.emit("vessel.flight", FLIGHT, {
          quality: Quality.Loaded,
          source: "vessel:1",
        });
      });
      await waitFor(() => expect(screen.getByText("alt:71234")).toBeTruthy());

      // A later render whose `carriedChannels` prop OMITS the promotion
      // entirely must not un-carry it, the allowlist only ever grows for
      // the life of this mounted provider.
      rerender(
        <TelemetryProvider client={client}>
          <Alt />
        </TelemetryProvider>,
      );
      expect(screen.getByText("alt:71234")).toBeTruthy();

      // And legacy emits still must not surface, proving it's genuinely
      // still on the stream path, not coincidentally matching.
      act(() => legacySource.emit("vessel.state.altitudeAsl", 999));
      expect(screen.getByText("alt:71234")).toBeTruthy();
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
