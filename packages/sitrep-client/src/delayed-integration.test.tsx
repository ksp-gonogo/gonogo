import {
  Courier,
  CourierTransport,
  ManualClock,
  StubNetwork,
} from "@ksp-gonogo/sitrep-server";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
// This is the end-to-end proof: the SAME hooks/client/provider
// from `integration.test.tsx`, now wired to the REAL delay-modelling
// server stack instead of `StubTransport` — `ManualClock` + `StubNetwork` +
// `Courier` + `CourierTransport`, imported from the `@ksp-gonogo/sitrep-server`
// package. The dependency graph is the natural DAG
// `sitrep-sdk <- sitrep-server <- sitrep-client`: sitrep-client has a
// test-only devDependency on sitrep-server (see package.json), which drives
// a real `TelemetryClient` against the courier for this integration proof.
// Production code in this package still never imports sitrep-server (see
// clock.ts's domain-seam note) — only this test file does.
import { LOSS_MARGIN, TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { useCommand } from "./use-command";
import { useStream } from "./use-stream";

/**
 * One component exercising both hooks, same shape as the `MissionPanel` in
 * `integration.test.tsx` — the point is that NEITHER hook nor the
 * component changes when the transport underneath starts modelling delay.
 */
function MissionPanel() {
  const altitude = useStream<number>("alt");
  const { send, status } = useCommand("deploy");
  return (
    <div>
      <span>altitude:{altitude ?? "—"}</span>
      <button
        type="button"
        onClick={() => {
          // Fire-and-forget from a click handler; `status` (not the promise)
          // is what these tests observe, but the promise still must be
          // caught so a lost/failed command never surfaces as an unhandled
          // rejection.
          send().catch(() => {});
        }}
      >
        deploy
      </button>
      <span>phase:{status.phase}</span>
      <span>
        eta:{status.phase === "in-flight" ? status.etaConfirm : "none"}
      </span>
    </div>
  );
}

describe("sitrep delayed comms end-to-end (M3)", () => {
  it("lags a telemetry stream by the network delay through the real Courier/CourierTransport stack", async () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport, clock);

    render(
      <TelemetryProvider client={client}>
        <MissionPanel />
      </TelemetryProvider>,
    );

    expect(screen.getByText("altitude:—")).toBeTruthy();

    // Recorded at UT 0. Not delivered before the delay elapses — no state
    // change happens synchronously here (delivery is scheduled 2s out), so
    // no act() wrapper is needed for the record() call itself.
    courier.record("vessel", "alt", 100, 0);
    expect(screen.getByText("altitude:—")).toBeTruthy();

    act(() => {
      clock.advanceTo(1);
    });
    expect(screen.getByText("altitude:—")).toBeTruthy();

    // Delivery fires exactly at validAt + delay (0 + 2): a synchronous,
    // clock-driven state update outside any DOM event, so it needs an
    // explicit act() (fireEvent wraps this automatically; a bare
    // ManualClock.advanceTo() call doesn't). The re-render itself lands one
    // animation frame later (the coalesced
    // `beginFrame()`), hence `waitFor` rather than a synchronous assertion.
    act(() => {
      clock.advanceTo(2);
    });
    await waitFor(() => expect(screen.getByText("altitude:100")).toBeTruthy());
  });

  it("shows the predicted etaConfirm in flight, then confirms after the full uplink+downlink round trip", async () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    const courier = new Courier({ clock, network });
    courier.setCommandHandler((command) => ({ ok: command }));
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport, clock);

    render(
      <TelemetryProvider client={client}>
        <MissionPanel />
      </TelemetryProvider>,
    );

    expect(screen.getByText("phase:idle")).toBeTruthy();
    fireEvent.click(screen.getByText("deploy"));

    // In-flight immediately after dispatch, carrying the transport's
    // predicted etaConfirm: now (0) + roundTripEta (2 * delay 2 = 4).
    expect(screen.getByText("phase:in-flight")).toBeTruthy();
    expect(screen.getByText("eta:4")).toBeTruthy();

    act(() => {
      clock.advanceTo(4);
    });

    await waitFor(() =>
      expect(screen.getByText("phase:confirmed")).toBeTruthy(),
    );
  });

  it("surfaces lost when the node is unreachable and silence outlasts etaConfirm + LOSS_MARGIN", async () => {
    const clock = new ManualClock();
    const network = new StubNetwork();
    network.setDelay("KSC", "vessel", 2);
    network.setReachable("KSC", "vessel", false);
    const courier = new Courier({ clock, network });
    const transport = new CourierTransport({
      courier,
      node: "vessel",
      vantage: "KSC",
      clock,
    });
    const client = new TelemetryClient(transport, clock);

    render(
      <TelemetryProvider client={client}>
        <MissionPanel />
      </TelemetryProvider>,
    );

    fireEvent.click(screen.getByText("deploy"));
    expect(screen.getByText("phase:in-flight")).toBeTruthy();
    expect(screen.getByText("eta:4")).toBeTruthy();

    act(() => {
      clock.advanceTo(4 + LOSS_MARGIN);
    });

    expect(screen.getByText("phase:lost")).toBeTruthy();
  });
});
