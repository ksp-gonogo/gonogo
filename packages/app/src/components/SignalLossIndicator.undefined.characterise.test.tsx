import { useTelemetry } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SignalLossIndicator } from "./SignalLossIndicator";

/**
 * Characterisation of what `SignalLossIndicator` DOES today when its two
 * telemetry reads (`comms.link`, `vessel.comms`) come back `undefined`, and
 * where it does or does not distinguish `undefined` from `null`.
 *
 * Nothing here is an endorsement. The widget's headline behaviour is that an
 * absent read reads as "connected": a dropped frame and a healthy link are the
 * same render. That is pinned below so it becomes visible if it changes.
 *
 * Both reads feed three separate absence gates:
 *  - `link?.connected`, so an absent `comms.link` makes `connected` undefined,
 *    which never satisfies the confirmed-true gate and so never arms the banner
 *  - `comms?.signalStrength`, plus `signalStrength !== undefined` inside
 *    `deriveState`, so a missing strength is "no reading" and never 0%
 *  - `comms == null`, which deliberately covers BOTH warmup and a tombstone,
 *    and is the read that used to crash the app on `null.controlState`
 */

const CARRIED = ["comms.link", "vessel.comms"];

/**
 * The pinned view time. Every emission below stamps an explicit `validAt` at or
 * before this, so "the newest sample the frame can see" is the one the test
 * just emitted rather than an artefact of same-UT insert order.
 */
const VIEW_UT = 100;

/** Raw `ControlState` ordinals, as the mod sends them on `vessel.comms`. */
const CONTROL_STATE_PARTIAL = 3;
const CONTROL_STATE_KERBAL_FULL = 10;

/**
 * A readout of the two raw reads, so "no banner" cannot pass for the wrong
 * reason. `SignalLossIndicator` renders nothing at all in the healthy state, so
 * without this a broken fixture (nothing subscribed, no provider) would satisfy
 * every absence assertion in this file.
 *
 * It also pins the SHAPE of the read, and that shape is the thing the migration
 * changed. It used to be `undefined` for an unarrived topic and `null` for a
 * tombstone, two spellings that no call site could reliably tell apart. The arm
 * names them instead: `pending` and `absent`.
 */
function Probe() {
  const link = useTelemetry("comms.link");
  const comms = useTelemetry("vessel.comms");
  return (
    <div>
      <span data-testid="raw-link">{link.state}</span>
      <span data-testid="raw-comms">{comms.state}</span>
    </div>
  );
}

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: VIEW_UT,
  });
  render(
    <fixture.Provider>
      <SignalLossIndicator />
      <Probe />
    </fixture.Provider>,
  );
  const emit = (topic: string, payload: unknown, validAt: number) => {
    act(() => {
      fixture.emit(topic, payload, { validAt, deliveredAt: validAt });
    });
  };
  /**
   * Mint a frame and let the widget render on it. Required BETWEEN a
   * `connected: true` and a later `connected: false`: `hasConfirmedConnection`
   * is set by an effect, so the true has to reach a render for the banner to
   * ever arm. Two edges coalesced into one frame leave the banner disarmed.
   */
  const frame = () => {
    act(() => {
      fixture.store.beginFrame();
    });
  };
  return { ...fixture, emit, frame };
}

/** Neither banner label, and no elapsed timer: the whole banner is absent. */
function expectNoBanner() {
  expect(screen.queryByText("SIGNAL LOSS")).toBeNull();
  expect(screen.queryByText("PARTIAL CONTROL")).toBeNull();
  expect(screen.queryByText(/^T\+/)).toBeNull();
}

describe("SignalLossIndicator: nothing has arrived", () => {
  it("renders no banner at all, and both reads are literally undefined", async () => {
    const fixture = mount();
    act(() => {
      fixture.store.beginFrame();
    });

    // Pins the read shape at the two call sites: `undefined`, not a wrapper,
    // not null. `link?.connected` / `comms?.signalStrength` short-circuit and
    // `comms == null` is true.
    await waitFor(() =>
      expect(screen.getByTestId("raw-link").textContent).toBe("pending"),
    );
    expect(screen.getByTestId("raw-comms").textContent).toBe("pending");

    // The documented intent ("absence of data is not a blackout"), pinned as
    // behaviour: a widget with no telemetry whatsoever is indistinguishable
    // from a healthy link.
    expectNoBanner();
  });

  it("CONTROL: a confirmed link that then drops does render SIGNAL LOSS", async () => {
    // Non-vacuity guard for every absence assertion in this file: the banner
    // is reachable through this fixture, so "no banner" above is a statement
    // about the undefined reads and not about a dead test harness.
    const fixture = mount();
    fixture.emit("comms.link", { connected: true }, 0);
    fixture.emit(
      "vessel.comms",
      {
        connected: true,
        signalStrength: 0.8,
        controlState: CONTROL_STATE_KERBAL_FULL,
      },
      0,
    );
    fixture.frame();
    expectNoBanner();
    fixture.emit("comms.link", { connected: false }, 50);

    await waitFor(() => expect(screen.getByText("SIGNAL LOSS")).toBeTruthy());
  });
});

describe("SignalLossIndicator: absence gates fire", () => {
  it("an absent comms.link never arms the banner, so a 0% strength alone stays quiet", async () => {
    // Pins `link?.connected` → undefined → `hasConfirmedConnection` never set.
    // A 0% signal strength IS otherwise enough to read SIGNAL LOSS, so this is
    // the gate doing the work: no link topic means the widget declines to call
    // a dead link dead.
    const fixture = mount();
    fixture.emit(
      "vessel.comms",
      {
        connected: true,
        signalStrength: 0,
        controlState: CONTROL_STATE_KERBAL_FULL,
      },
      0,
    );

    await waitFor(() =>
      expect(screen.getByTestId("raw-comms").textContent).toBe("observed"),
    );
    expect(screen.getByTestId("raw-link").textContent).toBe("pending");
    expectNoBanner();
  });

  it("an absent vessel.comms leaves control state unknown, so no PARTIAL CONTROL even on a live link", async () => {
    // Pins the `comms == null` gate for the WARMUP meaning: control state is
    // simply unreported, and unknown renders as full control.
    const fixture = mount();
    fixture.emit("comms.link", { connected: true }, 0);

    await waitFor(() =>
      expect(screen.getByTestId("raw-link").textContent).toBe("observed"),
    );
    expect(screen.getByTestId("raw-comms").textContent).toBe("pending");
    expectNoBanner();
  });

  it("a comms record with signalStrength omitted is 'no reading', never 0%", async () => {
    // Partial payload: the record arrived, the field did not. `deriveState`'s
    // `signalStrength !== undefined` gate fires, so the zero-signal branch
    // cannot trip, even though the same widget reads an explicit 0 as SIGNAL
    // LOSS (asserted in the second half).
    const fixture = mount();
    fixture.emit("comms.link", { connected: true }, 0);
    fixture.emit(
      "vessel.comms",
      { connected: true, controlState: CONTROL_STATE_KERBAL_FULL },
      0,
    );

    await waitFor(() =>
      expect(screen.getByTestId("raw-comms").textContent).toBe("observed"),
    );
    expectNoBanner();

    // Same record, strength now present and zero: the field's ABSENCE was
    // carrying the difference.
    fixture.emit(
      "vessel.comms",
      {
        connected: true,
        signalStrength: 0,
        controlState: CONTROL_STATE_KERBAL_FULL,
      },
      50,
    );
    await waitFor(() => expect(screen.getByText("SIGNAL LOSS")).toBeTruthy());
  });
});

describe("SignalLossIndicator: null versus undefined on vessel.comms", () => {
  it("treats a null tombstone as UNKNOWN control state, identically to never-arrived", async () => {
    // Which meaning is implemented: `comms == null` covers BOTH arms, so a
    // confirmed "this vessel has no comms" (tombstone) is read as "control
    // state unreported", NOT as "no control". The observable consequence is
    // that a standing PARTIAL CONTROL banner DISAPPEARS the moment the
    // tombstone lands, which is the opposite of what a confirmed comms-dark
    // vessel means.
    const fixture = mount();
    fixture.emit("comms.link", { connected: true }, 0);
    fixture.emit(
      "vessel.comms",
      {
        connected: true,
        signalStrength: 0.8,
        controlState: CONTROL_STATE_PARTIAL,
      },
      0,
    );
    await waitFor(() =>
      expect(screen.getByText("PARTIAL CONTROL")).toBeTruthy(),
    );

    fixture.emit("vessel.comms", null, 50);

    await waitFor(() =>
      expect(screen.getByTestId("raw-comms").textContent).toBe("absent"),
    );
    // The tombstone is distinguishable AT the read (literally `null`, not
    // `undefined`) and then flattened by the gate: the render is the
    // never-arrived render.
    expectNoBanner();
  });

  it("a null tombstone does not resurrect a lost banner: the loss still rides comms.link", async () => {
    // The other half of the same gate. A tombstone erases control state but
    // says nothing about connectivity, so a confirmed disconnect stays lost.
    const fixture = mount();
    fixture.emit("comms.link", { connected: true }, 0);
    fixture.emit(
      "vessel.comms",
      {
        connected: true,
        signalStrength: 0.8,
        controlState: CONTROL_STATE_KERBAL_FULL,
      },
      0,
    );
    fixture.frame();
    fixture.emit("comms.link", { connected: false }, 50);
    fixture.emit("vessel.comms", null, 50);

    await waitFor(() => expect(screen.getByText("SIGNAL LOSS")).toBeTruthy());
    expect(screen.getByTestId("raw-comms").textContent).toBe("absent");
  });
});
