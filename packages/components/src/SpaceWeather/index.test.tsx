import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceWeatherComponent } from "./index";

// SpaceWeather reads the real `kerbalism.spaceweather` Topic (canonical
// one-arg useTelemetry) plus `vessel.flight` for the belt-ring altitude, so the
// tests drive it through a real stream (setupStreamFixture), not the legacy
// MockDataSource. Radiation is emitted rad/s (as the mod does); the widget
// multiplies by 3600 for the rad/h readout.

interface SwState {
  radiationRadPerHour: number;
  stormState: 0 | 1 | 2;
  innerBelt?: boolean;
  outerBelt?: boolean;
  magnetosphere?: boolean;
  blackout?: boolean;
  shieldingValue: number;
  shieldingCapacity: number;
  altitudeM: number;
}

const NOMINAL: SwState = {
  radiationRadPerHour: 0.0143,
  stormState: 0,
  magnetosphere: true,
  shieldingValue: 3.308,
  shieldingCapacity: 3.308,
  altitudeM: 100_000,
};

const INNER_BELT: SwState = {
  ...NOMINAL,
  radiationRadPerHour: 10.376,
  innerBelt: true,
  shieldingValue: 1.2,
  altitudeM: 1_300_000,
};

const STORM_PEAK: SwState = {
  ...NOMINAL,
  radiationRadPerHour: 5.0,
  stormState: 2,
  magnetosphere: false,
  blackout: true,
  shieldingValue: 0.8,
};

describe("SpaceWeatherComponent", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    clearRegistry();
    stream = setupStreamFixture({
      carriedChannels: ["kerbalism.spaceweather", "vessel.flight"],
      pinnedUt: 149_489,
    });
  });

  function renderWidget(size = { w: 8, h: 11 }) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sw-test" }}>
          <SpaceWeatherComponent
            config={{}}
            id="sw-test"
            w={size.w}
            h={size.h}
          />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function emit(sw: SwState) {
    act(() => {
      stream.emit("kerbalism.spaceweather", {
        radiationRadPerSecond: sw.radiationRadPerHour / 3600,
        habitatRadiationRadPerSecond: sw.radiationRadPerHour / 3600,
        magnetosphere: sw.magnetosphere ?? false,
        innerBelt: sw.innerBelt ?? false,
        outerBelt: sw.outerBelt ?? false,
        stormIncoming: sw.stormState === 1,
        stormInProgress: sw.stormState === 2,
        blackout: sw.blackout ?? false,
        inSunlight: true,
        shieldingAmount: sw.shieldingValue,
        shieldingCapacity: sw.shieldingCapacity,
      });
      stream.emit("vessel.flight", {
        altitudeAsl: sw.altitudeM,
        altitudeTerrain: sw.altitudeM,
      });
    });
  }

  it("shows the habitat dose rate and a Sheltered status when nominal", async () => {
    renderWidget();
    emit(NOMINAL);
    await waitFor(() => expect(visibleText()).toContain("0.014 rad/h"));
    expect(screen.getByText("Sheltered")).toBeInTheDocument();
    expect(screen.getByText("No storm activity")).toBeInTheDocument();
  });

  it("flags the inner belt with a storm-in-progress status and lit belt tag", async () => {
    renderWidget();
    emit(INNER_BELT);
    await waitFor(() => expect(visibleText()).toContain("10.38 rad/h"));
    expect(screen.getByText("Storm in progress")).toBeInTheDocument();
    // The shielding meter reflects the fraction (1.2 / 3.308 ≈ 36%).
    expect(screen.getByRole("meter", { name: "Shielding" })).toHaveAttribute(
      "aria-valuenow",
      "36",
    );
  });

  it("surfaces storm-in-progress and comms blackout at storm peak", async () => {
    renderWidget();
    emit(STORM_PEAK);
    await waitFor(() => expect(visibleText()).toContain("5.00 rad/h"));
    // Both the timeline headline and the status badge read "Storm in
    // progress" at peak: the badge scoped by role, the timeline by its own
    // findAllByText count, so this doesn't collide with getByText's
    // single-match requirement.
    expect(screen.getByRole("status")).toHaveTextContent("Storm in progress");
    expect(await screen.findAllByText(/Storm in progress/)).toHaveLength(2);
    expect(screen.getByText("Comms blackout")).toBeInTheDocument();
  });

  it("shows a CME-inbound headline and Exposed status when a storm is incoming", async () => {
    renderWidget();
    emit({ ...NOMINAL, stormState: 1 });
    expect(await screen.findByText("CME inbound")).toBeInTheDocument();
    expect(screen.getByText("Exposed")).toBeInTheDocument();
  });

  it("announces the mission-state via a polite live region", async () => {
    renderWidget();
    emit(STORM_PEAK);
    // Wait for the storm state to propagate before reading the badge (the
    // pre-emit render shows the default "Unshielded").
    await screen.findByText("5.00 rad/h");
    // The status badge is the discrete mission-state announcement (label
    // changes only on a state transition, not every telemetry tick).
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Storm in progress");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  // The sun vantage, asserted BY VALUE throughout. A star card with no star and a tracker with
  // no CME render the same chrome as ones that work, so "the section is there"
  // proves nothing: these name the distance, the target and the ETA.

  /** The sun-vantage half of the payload, emitted beside a nominal vessel read. */
  function emitSun(sun: {
    stars: unknown[];
    storms: unknown[];
    stormEjectionSpeed?: number;
  }) {
    act(() => {
      stream.emit("kerbalism.spaceweather", {
        radiationRadPerSecond: NOMINAL.radiationRadPerHour / 3600,
        habitatRadiationRadPerSecond: NOMINAL.radiationRadPerHour / 3600,
        magnetosphere: true,
        innerBelt: false,
        outerBelt: false,
        stormIncoming: false,
        stormInProgress: false,
        blackout: false,
        inSunlight: true,
        shieldingAmount: NOMINAL.shieldingValue,
        shieldingCapacity: NOMINAL.shieldingCapacity,
        stormEjectionSpeed: 98_931_511.14,
        ...sun,
      });
    });
  }

  it("draws a card per star, naming each one and its distance", async () => {
    renderWidget();
    emitSun({
      stars: [
        { star: "Kerbol", distance: value("m", 13_400_000_000) },
        { star: "Valentine", distance: value("m", 41_200_000_000) },
      ],
      storms: [],
    });

    await waitFor(() => expect(screen.getByText("Kerbol")).toBeInTheDocument());
    expect(screen.getByText("Valentine")).toBeInTheDocument();
    const text = visibleText();
    expect(text).toContain("13.4 Gm");
    expect(text).toContain("41.2 Gm");
    // A ring per star, each labelled with its own baseline verdict, is what
    // makes "per-star" true rather than one diagram fused across the pack.
    expect(
      screen.getByLabelText("Solar activity for Kerbol: baseline"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Solar activity for Valentine: baseline"),
    ).toBeInTheDocument();
  });

  it("names the body a CME is aimed at, with its transit and impact ETA", async () => {
    renderWidget();
    emitSun({
      stars: [{ star: "Kerbol", distance: value("m", 13_400_000_000) }],
      storms: [
        {
          star: "Kerbol",
          stormState: 1,
          // 80s out at the pinned UT of 149,489.
          stormTime: 149_569,
          dist: 13_400_000_000,
          targetKind: 0,
          targetName: "Kerbin",
        },
      ],
    });

    await waitFor(() =>
      expect(screen.getByText("Inbound to Kerbin")).toBeInTheDocument(),
    );
    // No "(current vessel)" qualifier on a BODY target: that phrase is what
    // distinguishes the per-vessel slot, so it must not appear here.
    expect(visibleText()).not.toContain("current vessel");
    expect(screen.getByText("Inbound")).toBeInTheDocument();
    // The ETA is the pinned 80 seconds, not a placeholder.
    expect(visibleText()).toContain("1min 20s");
    // The star's own ring switches off baseline once it has a CME in transit.
    expect(
      screen.getByLabelText("Solar activity for Kerbol: CME inbound"),
    ).toBeInTheDocument();
    // Transit progress is a real percentage off dist / ejection speed, and it
    // is the bar's own accessible value rather than decoration.
    const bar = screen.getByRole("progressbar", {
      name: "Transit progress from Kerbol",
    });
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  });

  it("names the VESSEL as the target for a craft in solar orbit", async () => {
    renderWidget();
    emitSun({
      stars: [{ star: "Kerbol", distance: value("m", 17_500_000_000) }],
      storms: [
        {
          star: "Kerbol",
          stormState: 1,
          stormTime: 149_579,
          dist: 17_500_000_000,
          // The per-vessel slot: Kerbalism rolled this against the craft's own
          // sun distance, so no other vessel shares it.
          targetKind: 1,
          targetName: "Duna Surveyor 1",
        },
      ],
    });

    await waitFor(() =>
      expect(
        screen.getByText("Inbound to Duna Surveyor 1 (current vessel)"),
      ).toBeInTheDocument(),
    );
  });

  it("reads an arrived CME as an impact, not as another inbound one", async () => {
    renderWidget();
    emitSun({
      stars: [{ star: "Kerbol", distance: value("m", 13_400_000_000) }],
      storms: [
        {
          star: "Kerbol",
          stormState: 2,
          stormTime: 149_409,
          dist: 13_400_000_000,
          targetKind: 0,
          targetName: "Kerbin",
        },
      ],
    });

    await waitFor(() =>
      expect(screen.getByText("Impacting Kerbin")).toBeInTheDocument(),
    );
    // "Impact" is BOTH the badge label and the ETA row label, so the badge
    // is queried by role rather than by a text match that finds two nodes.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getAllByText("Impact")).toHaveLength(2);
    expect(
      screen.getByLabelText("Solar activity for Kerbol: CME impacting"),
    ).toBeInTheDocument();
  });

  it("keeps the vessel's own exposure readout alongside the sun vantage", async () => {
    // The recovered branch DELETED this half, on the grounds that it had moved
    // to ShipSystems and CrewStatus. It had not. This pins both halves on one
    // render so a future move has to be deliberate.
    renderWidget();
    emitSun({
      stars: [{ star: "Kerbol", distance: value("m", 13_400_000_000) }],
      storms: [],
    });

    await waitFor(() => expect(screen.getByText("Kerbol")).toBeInTheDocument());
    const text = visibleText();
    expect(text).toContain("0.014 rad/h");
    expect(text).toContain("habitat dose rate");
    expect(text).toContain("Shielding");
    expect(text).toContain("Magnetosphere");
  });

  it("has no axe violations", async () => {
    const { container } = renderWidget();
    emit(INNER_BELT);
    await waitFor(() => expect(visibleText()).toContain("10.38 rad/h"));
    await expectNoA11yViolations(container);
  });
});
