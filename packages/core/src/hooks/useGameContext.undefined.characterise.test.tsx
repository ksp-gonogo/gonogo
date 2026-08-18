import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry } from "../registry";
import { useGameContext } from "./useGameContext";

/**
 * CHARACTERISATION: what `useGameContext` reports TODAY when its three
 * telemetry reads are `undefined`, and what it CANNOT distinguish.
 *
 * Every one of the three reads goes through an absence gate:
 *   - `useTelemetry("spaceCenter.scene")?.scene` then a `KNOWN_SCENES` check
 *   - `useStream<SpaceCenterState>("spaceCenter.state")?.padOccupied` then `=== true`
 *   - `useTelemetry("career.mode")?.mode` then `resolveCareerMode`'s typeof gates
 *
 * All three collapse "nothing arrived", "confirmed nothing", and "arrived but
 * unrecognised" onto ONE answer. These tests pin that collapse so the
 * migration cannot quietly change which of those it means.
 */

const ALL_CARRIED = [
  "career.mode",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
];

function mountedWrapper(transport: StubTransport) {
  const client = new TelemetryClient(transport);
  return ({ children }: { children: ReactNode }) => (
    <TelemetryProvider client={client} carriedChannels={ALL_CARRIED}>
      {children}
    </TelemetryProvider>
  );
}

beforeEach(() => clearRegistry());

describe("useGameContext characterisation: a provider is mounted but nothing has arrived", () => {
  it("reports every field at its Unknown/false default, indistinguishable from having no provider at all", () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    // The subscriptions are live: this is genuinely "waiting for telemetry",
    // not "no stream mounted". Today the two states render the same.
    expect(transport.isSubscribed("spaceCenter.scene")).toBe(true);
    expect(transport.isSubscribed("career.mode")).toBe(true);
    expect(transport.isSubscribed("spaceCenter.launchSites")).toBe(true);

    expect(result.current).toEqual({
      scene: "Unknown",
      inFlight: false,
      padOccupied: false,
      careerMode: "Unknown",
      isCareerLike: false,
      // The two charging flags are the exception to this test's own heading:
      // they do NOT default to false. An unknown mode has to be treated as one
      // that charges, because the widgets reading these are gating spends and
      // the cost of being wrong is asymmetric. Defaulting them false would put
      // the fail-open back one level down from the widgets.
      chargesFunds: true,
      chargesScience: true,
      hasGameSignal: false,
    });
  });

  it("returns the same shape with no provider mounted, so a widget cannot tell warmup from a station with no stream", () => {
    const { result: withProvider } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(new StubTransport()),
    });
    const { result: withoutProvider } = renderHook(() => useGameContext());

    // Pins the conflation the `pending` arm is being introduced to break.
    expect(withoutProvider.current).toEqual(withProvider.current);
  });
});

describe("useGameContext characterisation: the scene gate", () => {
  /**
   * `?.scene` fires on the absent record: the optional chain is the gate.
   * A partial record (arrived, `scene` field missing) lands on the SAME
   * "Unknown" as nothing having arrived at all.
   */
  it("reports Unknown for a record that arrived without a scene field", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() => transport.emit("spaceCenter.scene", { scene: "Flight" }));
    await waitFor(() => expect(result.current.scene).toBe("Flight"));

    act(() => transport.emit("spaceCenter.scene", {}));
    await waitFor(() => expect(result.current.scene).toBe("Unknown"));
    // hasGameSignal drops back to false too: a partial record is treated as
    // no game signal at all, not as "connected but scene unreported".
    expect(result.current.hasGameSignal).toBe(false);
    expect(result.current.inFlight).toBe(false);
  });

  /**
   * An arrived-but-UNRECOGNISED scene string is also flattened to "Unknown",
   * even though the type's own doc reserves "Other" for that case. So a scene
   * token the mod adds later reads as "telemetry hasn't arrived".
   */
  it("flattens an unrecognised scene string onto Unknown rather than Other", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    // "Other" first, so the drop back to Unknown is an observed transition
    // rather than a vacuously-already-true assertion.
    act(() => transport.emit("spaceCenter.scene", { scene: "Other" }));
    await waitFor(() => expect(result.current.scene).toBe("Other"));
    // "Other" DOES count as a game signal, so the two mid-load-ish states
    // are not equivalent.
    expect(result.current.hasGameSignal).toBe(true);

    act(() => transport.emit("spaceCenter.scene", { scene: "PSystemSpawn" }));
    await waitFor(() => expect(result.current.scene).toBe("Unknown"));
    expect(result.current.hasGameSignal).toBe(false);
  });

  /** A non-string scene (a wire-shape change) reads as absent, not as an error. */
  it("reports Unknown for a numeric scene rather than surfacing it", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() => transport.emit("spaceCenter.scene", { scene: "Editor" }));
    await waitFor(() => expect(result.current.scene).toBe("Editor"));

    act(() => transport.emit("spaceCenter.scene", { scene: 7 }));
    await waitFor(() => expect(result.current.scene).toBe("Unknown"));
  });
});

describe("useGameContext characterisation: the careerMode gate", () => {
  /**
   * `resolveCareerMode(undefined)` answers "Unknown", and so does an ordinal
   * of 3 (`GameMode.Unknown` on the wire). A CONFIRMED unknown-mode from the
   * mod and a mode that has never arrived are the same string here.
   */
  it("cannot distinguish a never-arrived mode from the mod reporting GameMode.Unknown", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    expect(result.current.careerMode).toBe("Unknown");

    // CAREER first so the return to Unknown is an observed transition.
    act(() => transport.emit("career.mode", { mode: 1 }));
    await waitFor(() => expect(result.current.careerMode).toBe("CAREER"));

    act(() => transport.emit("career.mode", { mode: 3 }));
    await waitFor(() => expect(result.current.careerMode).toBe("Unknown"));
    // And with a confirmed GameMode.Unknown in hand, hasGameSignal is STILL
    // false: the widget is told nothing is happening while telemetry flows.
    expect(result.current.hasGameSignal).toBe(false);
  });

  it("reports Unknown for a record that arrived without a mode field", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() => transport.emit("career.mode", { mode: 1 }));
    await waitFor(() => expect(result.current.careerMode).toBe("CAREER"));

    // Partial record: the field within the payload is undefined.
    act(() => transport.emit("career.mode", {}));
    await waitFor(() => expect(result.current.careerMode).toBe("Unknown"));
    expect(result.current.isCareerLike).toBe(false);
  });

  /**
   * null vs undefined: the code does NOT distinguish them. `?.mode` yields
   * undefined for an absent record, and `resolveCareerMode(null)` takes the
   * same final `return "Unknown"`. A tombstoned mode field reads as pending.
   */
  it("treats an explicit null mode exactly as it treats a never-arrived one", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() => transport.emit("career.mode", { mode: 2 }));
    await waitFor(() => expect(result.current.careerMode).toBe("SCIENCE"));

    act(() => transport.emit("career.mode", { mode: null }));
    await waitFor(() => expect(result.current.careerMode).toBe("Unknown"));
    expect(result.current.isCareerLike).toBe(false);
  });

  /** An out-of-range ordinal falls off the end of the lookup and reads as absent. */
  it("reports Unknown for an ordinal past the end of GAME_MODE_ORDINAL", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() => transport.emit("career.mode", { mode: 99 }));
    await waitFor(() => expect(result.current.careerMode).toBe("Unknown"));
  });
});

describe("useGameContext characterisation: the padOccupied gate", () => {
  /**
   * `padOccupiedRaw === true` is the coercion. Absent, null, and a confirmed
   * `false` all become `false`, so "the pad is clear" and "we have no idea
   * whether the pad is clear" are one value.
   */
  it("reports padOccupied false when the derived channel has produced nothing", () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    expect(result.current.padOccupied).toBe(false);
  });

  it("reports the same false for a launch-site list whose stock pad reports null occupancy", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() =>
      transport.emit("spaceCenter.launchSites", [
        { name: "LaunchPad", padOccupied: true, padVesselTitle: "Kerbal X" },
      ]),
    );
    await waitFor(() => expect(result.current.padOccupied).toBe(true));

    // Occupancy tombstoned back to null: reads as "not occupied", the same
    // answer as never having heard from the space centre.
    act(() =>
      transport.emit("spaceCenter.launchSites", [
        { name: "LaunchPad", padOccupied: null, padVesselTitle: null },
      ]),
    );
    await waitFor(() => expect(result.current.padOccupied).toBe(false));
  });

  it("reports padOccupied false for an empty launch-site list, indistinguishable from no data", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() => transport.emit("spaceCenter.launchSites", []));
    await waitFor(() => expect(result.current.padOccupied).toBe(false));
  });

  /**
   * padOccupied is NOT gated on the scene read: it can be true while the
   * scene is still Unknown, which contradicts its doc comment ("Implies
   * inFlight"). Pinned because the migration touches both reads.
   */
  it("can report padOccupied true while scene is still Unknown, contradicting its own doc", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() =>
      transport.emit("spaceCenter.launchSites", [
        { name: "LaunchPad", padOccupied: true, padVesselTitle: "Kerbal X" },
      ]),
    );
    await waitFor(() => expect(result.current.padOccupied).toBe(true));
    expect(result.current.scene).toBe("Unknown");
    expect(result.current.inFlight).toBe(false);
    // And padOccupied does NOT feed hasGameSignal: only scene and careerMode do.
    expect(result.current.hasGameSignal).toBe(false);
  });
});

describe("useGameContext characterisation: hasGameSignal is an OR over two absence gates", () => {
  it("flips true on the scene read alone, with careerMode still Unknown", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() => transport.emit("spaceCenter.scene", { scene: "SpaceCenter" }));
    await waitFor(() => expect(result.current.hasGameSignal).toBe(true));
    expect(result.current.careerMode).toBe("Unknown");
  });

  it("flips true on the careerMode read alone, with scene still Unknown", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() => transport.emit("career.mode", { mode: 0 }));
    await waitFor(() => expect(result.current.hasGameSignal).toBe(true));
    expect(result.current.scene).toBe("Unknown");
    // SANDBOX is a real mode but not career-like: pinned so the migration
    // does not fold it back into Unknown.
    expect(result.current.careerMode).toBe("SANDBOX");
    expect(result.current.isCareerLike).toBe(false);
    // And a CONFIRMED sandbox is the one case where nothing is charged, so the
    // spend gates stand down. This is what keeps them from being permanently
    // true, and it is why they read the mode rather than the balance.
    expect(result.current.chargesFunds).toBe(false);
    expect(result.current.chargesScience).toBe(false);
  });

  it("charges funds only in CAREER, and science in CAREER and SCIENCE", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useGameContext(), {
      wrapper: mountedWrapper(transport),
    });

    act(() => transport.emit("career.mode", { mode: 1 }));
    await waitFor(() => expect(result.current.careerMode).toBe("CAREER"));
    expect(result.current.chargesFunds).toBe(true);
    expect(result.current.chargesScience).toBe(true);

    // Science mode has science points and no funds, so a funds gate has nothing
    // to guard while a science gate does.
    act(() => transport.emit("career.mode", { mode: 2 }));
    await waitFor(() => expect(result.current.careerMode).toBe("SCIENCE"));
    expect(result.current.chargesFunds).toBe(false);
    expect(result.current.chargesScience).toBe(true);
  });
});
