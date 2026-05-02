import { synthesizeFlight } from "@gonogo/data";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ReplayDataSourceFixture,
  setupReplayDataSource,
  stepwise,
  teardownReplayDataSource,
} from "../test/setupReplayDataSource";
import { CommSignalComponent } from "./index";

/**
 * Demo: drive CommSignal through a full signal-loss-and-recovery cycle.
 * Validates the bar count, the tone transitions (ok → warn → lost), and
 * the "No signal" subtitle that appears when `comm.connected` flips false.
 */

const SIGNAL_CYCLE = synthesizeFlight({
  vesselName: "Lost Probe",
  launchedAt: 1_700_000_000_000,
  samples: {
    "v.name": [[0, "Lost Probe"]],
    "v.missionTime": [
      [0, 0],
      [10_000, 10],
      [30_000, 30],
      [60_000, 60],
      [90_000, 90],
    ],
    "comm.connected": [
      [0, true],
      [60_000, false],
      [90_000, true],
    ],
    "comm.signalStrength": [
      [0, 0.95], // strong link
      [30_000, 0.4], // partial — degrading
      [60_000, 0], // blackout
      [90_000, 0.85], // recovered
    ],
    "comm.controlState": [
      [0, 2], // Full
      [30_000, 1], // Partial
      [60_000, 0], // None
      [90_000, 2], // Full
    ],
    "comm.controlStateName": [
      [0, "Full"],
      [30_000, "Partial"],
      [60_000, "None"],
      [90_000, "Full"],
    ],
    "comm.signalDelay": [
      [0, 0],
      [60_000, 0.5],
      [90_000, 0.05],
    ],
  },
});

describe("CommSignal — integration via FlightReplayDataSource", () => {
  let fixture: ReplayDataSourceFixture;

  beforeEach(async () => {
    fixture = await setupReplayDataSource({ fixture: SIGNAL_CYCLE });
  });

  afterEach(() => {
    teardownReplayDataSource(fixture);
  });

  function renderComm() {
    return render(
      <CommSignalComponent config={{}} id="comm-replay" w={6} h={5} />,
    );
  }

  it("opens with no signal data before the first sample", async () => {
    renderComm();
    expect(await screen.findByText(/no signal data/i)).toBeInTheDocument();
  });

  it("shows full signal at launch (4 lit bars + Signal to KSC)", async () => {
    renderComm();
    await stepwise(fixture, 5_000);
    expect(await screen.findByText(/signal to ksc/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Signal 4 of 4")).toBeInTheDocument();
    // Strength rendered as percentage when comm.signalStrength is publishable.
    expect(screen.getByText(/95%/)).toBeInTheDocument();
  });

  it("degrades to partial at +30s (2 lit bars + Partial control)", async () => {
    renderComm();
    await stepwise(fixture, 31_000);
    await waitFor(() => {
      // strength 0.4 → ceil(0.4 × 4) = 2 bars
      expect(screen.getByLabelText("Signal 2 of 4")).toBeInTheDocument();
    });
    // Detail grid shows the control state name verbatim.
    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(screen.getByText(/40%/)).toBeInTheDocument();
  });

  it("flips to no-signal at +60s (0 bars + No signal subtitle)", async () => {
    renderComm();
    await stepwise(fixture, 61_000);
    await waitFor(() => {
      expect(screen.getByLabelText("Signal 0 of 4")).toBeInTheDocument();
    });
    expect(screen.getByText(/no signal/i)).toBeInTheDocument();
    // Headline collapses to em-dash when connected is false.
    expect(screen.getByText("—")).toBeInTheDocument();
    // Delay still surfaces (formatted in ms when sub-second).
    expect(screen.getByText(/500 ms/)).toBeInTheDocument();
  });

  it("recovers to full signal at +90s after the blackout", async () => {
    renderComm();
    await stepwise(fixture, fixture.replay.duration());
    await waitFor(() => {
      expect(screen.getByLabelText("Signal 4 of 4")).toBeInTheDocument();
    });
    expect(screen.getByText(/signal to ksc/i)).toBeInTheDocument();
    expect(screen.getByText(/85%/)).toBeInTheDocument();
  });
});
