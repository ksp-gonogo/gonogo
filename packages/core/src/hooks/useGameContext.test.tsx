import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import type { DataSource, DataSourceStatus } from "../types";
import { useGameContext } from "./useGameContext";

// Minimal in-memory legacy DataSource — same shape as useTelemetry.test.tsx.
function makeSource(id = "data") {
  const dataListeners = new Map<string, Set<(v: unknown) => void>>();
  const statusListeners = new Set<(s: DataSourceStatus) => void>();

  const source: DataSource & {
    emit: (key: string, value: unknown) => void;
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
  };
  return source;
}

beforeEach(() => clearRegistry());

/**
 * All three reads are canonical now — `career.mode` (-> `career.mode.mode`,
 * the `GameMode` enum ORDINAL `resolveCareerMode` maps to a display string),
 * `kc.scene` (-> `spaceCenter.scene.scene`) and `kc.padOccupied` (-> the
 * derived `spaceCenter.state` channel) — with NO legacy `DataSource` fallback.
 * So with no `TelemetryProvider` mounted (a station tree with no stream, or
 * the warmup window before the first frame) every read is `undefined` and the
 * context sits at its Unknown/false defaults; a legacy `DataSource` carrying
 * the old Telemachus keys is never consulted.
 */
describe("useGameContext — no TelemetryProvider mounted", () => {
  it("sits at Unknown/false defaults", () => {
    const { result } = renderHook(() => useGameContext());
    expect(result.current.careerMode).toBe("Unknown");
    expect(result.current.scene).toBe("Unknown");
    expect(result.current.padOccupied).toBe(false);
    expect(result.current.inFlight).toBe(false);
    expect(result.current.isCareerLike).toBe(false);
    expect(result.current.hasGameSignal).toBe(false);
  });

  it("ignores a legacy DataSource carrying the old Telemachus keys", () => {
    const source = makeSource();
    registerDataSource(source);

    const { result } = renderHook(() => useGameContext());
    act(() => {
      source.emit("career.mode", "career");
      source.emit("kc.scene", "Flight");
      source.emit("kc.padOccupied", true);
    });
    // No provider, canonical reads only — the legacy emits never surface.
    expect(result.current.careerMode).toBe("Unknown");
    expect(result.current.scene).toBe("Unknown");
    expect(result.current.padOccupied).toBe(false);
  });
});

describe("useGameContext — career.mode streamed GameMode ordinal (mapped + carried)", () => {
  it("resolves each GameMode ordinal to its display string", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeSource();
    registerDataSource(legacySource);

    const { result } = renderHook(() => useGameContext(), {
      wrapper: ({ children }) => (
        <TelemetryProvider client={client} carriedChannels={["career.mode"]}>
          {children}
        </TelemetryProvider>
      ),
    });

    expect(result.current.careerMode).toBe("Unknown");
    expect(transport.isSubscribed("career.mode")).toBe(true);

    // The store's visible frame advances on a scheduled (rAF/microtask)
    // tick, not synchronously within `act()` — poll with `waitFor`, same as
    // every other stream-backed hook test in this repo.
    act(() => transport.emit("career.mode", { mode: 0 }));
    await waitFor(() => expect(result.current.careerMode).toBe("SANDBOX"));
    expect(result.current.isCareerLike).toBe(false);

    act(() => transport.emit("career.mode", { mode: 1 }));
    await waitFor(() => expect(result.current.careerMode).toBe("CAREER"));
    expect(result.current.isCareerLike).toBe(true);

    act(() => transport.emit("career.mode", { mode: 2 }));
    await waitFor(() => expect(result.current.careerMode).toBe("SCIENCE"));
    expect(result.current.isCareerLike).toBe(true);

    act(() => transport.emit("career.mode", { mode: 3 }));
    await waitFor(() => expect(result.current.careerMode).toBe("Unknown"));

    // A legacy emit must not surface once the key is carried — the stream
    // value (SCIENCE) keeps winning over it.
    act(() => transport.emit("career.mode", { mode: 2 }));
    await waitFor(() => expect(result.current.careerMode).toBe("SCIENCE"));
    act(() => legacySource.emit("career.mode", "SANDBOX"));
    expect(result.current.careerMode).toBe("SCIENCE");
  });
});

/**
 * P4a shared-map: `kc.scene` maps onto `spaceCenter.scene.scene` — a plain
 * raw-field walk, no ordinal/normalization step needed. The mod's
 * `SpaceCenterViewProvider.MapScene` already folds the raw `GameScenes` enum
 * name onto the same six tokens (`Flight`/`SpaceCenter`/`Editor`/
 * `TrackingStation`/`MainMenu`/`Other`) the legacy `kc.scene` key used, so
 * `KNOWN_SCENES` resolves the streamed value exactly like the legacy one.
 */
describe("useGameContext — kc.scene streamed (mapped + carried)", () => {
  it("resolves a streamed scene the same way as the legacy string", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeSource();
    registerDataSource(legacySource);

    const { result } = renderHook(() => useGameContext(), {
      wrapper: ({ children }) => (
        <TelemetryProvider
          client={client}
          carriedChannels={["spaceCenter.scene"]}
        >
          {children}
        </TelemetryProvider>
      ),
    });

    expect(result.current.scene).toBe("Unknown");
    expect(transport.isSubscribed("spaceCenter.scene")).toBe(true);

    act(() => transport.emit("spaceCenter.scene", { scene: "Flight" }));
    await waitFor(() => expect(result.current.scene).toBe("Flight"));
    expect(result.current.inFlight).toBe(true);

    act(() =>
      transport.emit("spaceCenter.scene", { scene: "TrackingStation" }),
    );
    await waitFor(() => expect(result.current.scene).toBe("TrackingStation"));
    expect(result.current.inFlight).toBe(false);

    // A legacy emit must not surface once the key is carried — the stream
    // value keeps winning over it (same invariant as the career.mode test).
    act(() => legacySource.emit("kc.scene", "Flight"));
    expect(result.current.scene).toBe("TrackingStation");
  });
});

/**
 * `kc.padOccupied` maps onto the `spaceCenter.state.padOccupied` derived
 * channel (`space-center-state.ts`), which pulls stock-pad occupancy out of
 * the `spaceCenter.launchSites` array (only the stock KSC pad reports a
 * non-null `padOccupied`). With the input carried, the streamed value wins
 * over the legacy `DataSource`, same invariant as the career.mode/kc.scene
 * tests above.
 */
describe("useGameContext — kc.padOccupied streamed via spaceCenter.state (mapped + carried)", () => {
  it("derives padOccupied from the stock-pad entry of spaceCenter.launchSites", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const legacySource = makeSource();
    registerDataSource(legacySource);

    const { result } = renderHook(() => useGameContext(), {
      wrapper: ({ children }) => (
        <TelemetryProvider
          client={client}
          carriedChannels={["spaceCenter.launchSites"]}
        >
          {children}
        </TelemetryProvider>
      ),
    });

    expect(result.current.padOccupied).toBe(false);
    expect(transport.isSubscribed("spaceCenter.launchSites")).toBe(true);

    act(() =>
      transport.emit("spaceCenter.launchSites", [
        { name: "LaunchPad", padOccupied: true, padVesselTitle: "Kerbal X" },
        { name: "Runway", padOccupied: null, padVesselTitle: null },
      ]),
    );
    await waitFor(() => expect(result.current.padOccupied).toBe(true));

    // The stream value keeps winning over a legacy emit once carried.
    act(() => legacySource.emit("kc.padOccupied", false));
    expect(result.current.padOccupied).toBe(true);
  });
});
