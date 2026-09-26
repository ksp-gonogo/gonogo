import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  flushResizeObservers,
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

/**
 * What `undefined` means to LandingStatus, across its nine topics:
 *
 * - `vessel.flight` absent means "not descending", suppressing the body behind an empty state
 * - `comms.delay` absent means "no link", while a present but empty record means zero delay
 * - `vessel.surface` absent falls back to the centre-of-mass datum and says so, identically for a tombstone and a never-arrived channel
 * - `dv.summary` absent withholds the affordability verdict rather than answering "insufficient"
 *
 * Every one stops gating once a `Reading` is always truthy, so each has a test proving it fires.
 */
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.target",
  "vessel.propulsion",
  "vessel.surface",
  "vessel.landing",
  "dv.summary",
  "dv.stages",
  "vessel.structure",
  "comms.delay",
];

const MUN = { index: 3, name: "Mun", radius: 200_000, mu: 6.5138398e10 };

describe("LandingStatus: what undefined means today", () => {
  // A spec replays its scenario inside one rolling second, so the contribution budgets are reset between tests rather than raised.

  // jsdom lays nothing out, so charts need a told size.
  let restoreResizeObserver: () => void;
  afterEach(() => {
    restoreResizeObserver();
  });
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderWidget(size?: { w: number; h: number }) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "land-undef" }}>
          <WidgetContributions Widget={LandingStatusComponent}>
            <LandingStatusComponent
              id="land-undef"
              w={size?.w ?? 8}
              h={size?.h ?? 12}
            />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  interface DescentOverrides {
    altitudeTerrain?: number;
    verticalSpeed?: number;
    surfaceSpeed?: number;
    availableThrust?: number;
  }

  /** A Mun descent, by default the steep unrecoverable one (5 km AGL carrying 540 m/s); overrides give a viable descent where the ABORT hero is not under test. */
  function emitMunDescent(over: DescentOverrides = {}): void {
    stream.emit("system.bodies", {
      bodies: [
        {
          name: MUN.name,
          index: MUN.index,
          parentIndex: 0,
          radius: MUN.radius,
          orbit: null,
        },
      ],
    });
    stream.emit("vessel.identity", {
      vesselId: "test-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 6,
      parentBodyIndex: MUN.index,
      launchUt: null,
    });
    stream.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: MUN.index,
        sma: 250_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: MUN.mu,
      },
      { quality: Quality.Loaded },
    );
    const surfaceSpeed = over.surfaceSpeed ?? 540;
    stream.emit("vessel.flight", {
      latitude: 0,
      longitude: 0,
      altitudeAsl: 0,
      altitudeTerrain: over.altitudeTerrain ?? 5000,
      verticalSpeed: -(over.verticalSpeed ?? 50),
      surfaceSpeed,
      orbitalSpeed: surfaceSpeed,
      atmDensity: 0,
    });
    stream.emit("vessel.propulsion", {
      totalMass: 1,
      dryMass: 0.5,
      currentThrust: 0,
      availableThrust: over.availableThrust ?? 20,
    });
  }

  /** With nothing arrived, no link and a closed real-time loop must not share a hero: the hero asks for a link. */
  it("shows the empty state, a NO LINK regime and a hero that asks for a link when nothing has arrived", async () => {
    const { container } = renderWidget();
    await flushResizeObservers();

    // The body: `solveSuicideBurn` returns "not-descending" for an undefined height, so `deriveBoard` suppresses every readout.
    expect(visibleText(container)).toContain("No landing in progress");
    // The header keeps talking: `classifyRegime` refuses to call an unknown link live.
    expect(screen.getByText("NO LINK")).toBeInTheDocument();
    // The hero agrees: no claim about burn timing, and it names the link as missing.
    const hero = screen.getByRole("status");
    expect(hero).toHaveTextContent("BURN TIMING NEEDS A LINK");
    expect(hero).toHaveTextContent(NULL_DISPLAY);
    // Both the ignition countdown and the burn-GO clock assert a link state nothing has established.
    expect(hero).not.toHaveTextContent("SUICIDE BURN");
    expect(hero).not.toHaveTextContent("BURN GO IN");
    // No round-trip readout: `roundTripSeconds` is null, not zero.
    expect(screen.queryByText(/^RT /)).toBeNull();
    // No body caption: the widget declines to guess between atmospheric and vacuum.
    expect(visibleText(container)).not.toContain("vacuum");
    expect(visibleText(container)).not.toContain("atmospheric");
  });

  it("flips NO LINK to LIVE the moment comms.delay arrives saying there is no delay", async () => {
    // The two states differ only by whether the record exists: the same numbers, different words.
    renderWidget();
    expect(screen.getByText("NO LINK")).toBeInTheDocument();

    act(() => {
      stream.emit("comms.delay", { source: 0, oneWaySeconds: 0 });
    });

    await waitFor(() => expect(screen.getByText("LIVE")).toBeInTheDocument());
    expect(screen.queryByText("NO LINK")).toBeNull();
  });

  /**
   * `oneWaySeconds: null` is the documented no-path signal and must never be coerced to 0, which `classifyRegime` would read as `live`.
   * Each case emits a good delay first and waits for the pill to leave NO LINK before emitting the absence, since NO LINK is also the pre-emit state.
   */
  it("reads an explicit oneWaySeconds:null as NO LINK, never as a zero-delay link", async () => {
    renderWidget();

    act(() => {
      stream.emit("comms.delay", { source: 1, oneWaySeconds: 4 });
    });
    await waitFor(() => expect(screen.getByText("STAGED")).toBeInTheDocument());

    act(() => {
      stream.emit("comms.delay", { source: 1, oneWaySeconds: null });
    });
    await waitFor(() =>
      expect(screen.getByText("NO LINK")).toBeInTheDocument(),
    );
    expect(screen.queryByText("LIVE")).toBeNull();
    const hero = screen.getByRole("status");
    expect(hero).toHaveTextContent("BURN TIMING NEEDS A LINK");
    expect(hero).not.toHaveTextContent("SUICIDE BURN");
  });

  it("reads a comms.delay record with no fields as NO LINK too", async () => {
    // A record with neither source nor one-way time says nothing about the link being up.
    renderWidget();

    act(() => {
      stream.emit("comms.delay", { source: 1, oneWaySeconds: 4 });
    });
    await waitFor(() => expect(screen.getByText("STAGED")).toBeInTheDocument());

    act(() => {
      stream.emit("comms.delay", {});
    });
    await waitFor(() =>
      expect(screen.getByText("NO LINK")).toBeInTheDocument(),
    );
    expect(screen.queryByText("LIVE")).toBeNull();
  });

  it("reads the REAL no-path frame (source None AND oneWaySeconds null) as NO LINK", async () => {
    // Source None with a null value is what the mod emits with no path home: the value decides, never the source.
    renderWidget();

    act(() => {
      stream.emit("comms.delay", { source: 1, oneWaySeconds: 4 });
    });
    await waitFor(() => expect(screen.getByText("STAGED")).toBeInTheDocument());

    act(() => {
      stream.emit("comms.delay", { source: 0, oneWaySeconds: null });
    });
    await waitFor(() =>
      expect(screen.getByText("NO LINK")).toBeInTheDocument(),
    );
    expect(screen.queryByText("LIVE")).toBeNull();
    const hero = screen.getByRole("status");
    expect(hero).toHaveTextContent("BURN TIMING NEEDS A LINK");
    expect(hero).not.toHaveTextContent("SUICIDE BURN");
  });

  it("still reads a CommsDelaySource.None record as a LIVE zero-delay link", async () => {
    // Source None with value 0 is a LAN loop with genuinely no delay, so it stays live.
    renderWidget();
    expect(screen.getByText("NO LINK")).toBeInTheDocument();

    act(() => {
      stream.emit("comms.delay", { source: 0, oneWaySeconds: 0 });
    });

    await waitFor(() => expect(screen.getByText("LIVE")).toBeInTheDocument());
  });

  it("degrades to the centre-of-mass datum WITH a note when vessel.surface never arrives", async () => {
    // The note is the only on-screen distinction between the lowest-point datum and the centre-of-mass fallback.
    renderWidget();

    act(() => {
      emitMunDescent();
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          "centre-of-mass altitude (lowest-point datum unavailable)",
        ),
      ).toBeInTheDocument(),
    );

    // It clears once the lowest-point datum arrives, so the assertion above is a gate rather than a constant.
    act(() => {
      stream.emit("vessel.surface", { heightFromTerrain: 4800 });
    });
    await waitFor(() =>
      expect(
        screen.queryByText(
          "centre-of-mass altitude (lowest-point datum unavailable)",
        ),
      ).toBeNull(),
    );
  });

  it("withholds the burn cue, countdown and hot band while only the centre-of-mass datum is known", async () => {
    // A viable descent, so every burn instruction would otherwise be drawn.
    renderWidget();
    act(() => {
      emitMunDescent({
        altitudeTerrain: 2000,
        verticalSpeed: 40,
        surfaceSpeed: 45,
      });
      stream.emit("comms.delay", { source: 0, oneWaySeconds: 0 });
    });

    const rail = () =>
      screen.getByRole("meter", { name: /altitude above terrain/i });
    await waitFor(() =>
      expect(
        screen.getByText(
          "centre-of-mass altitude (lowest-point datum unavailable)",
        ),
      ).toBeInTheDocument(),
    );
    const hero = screen.getByRole("status");
    expect(hero).toHaveTextContent("SUICIDE BURN");
    expect(hero).toHaveTextContent(NULL_DISPLAY);
    expect(hero).not.toHaveTextContent("T−");
    expect(visibleText()).not.toMatch(/ignite in|past ignition/);
    expect(rail().closest("svg")?.textContent ?? "").not.toContain("burn");
    // The descent itself stays: the time to impact is a description, not an instruction.
    expect(visibleText()).toContain("Impact in");

    // The lowest point arriving restores every instruction, so the absences above are the gate's.
    act(() => {
      stream.emit("vessel.surface", { heightFromTerrain: 1990 });
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("T−"),
    );
    expect(visibleText()).toMatch(/ignite in/);
  });

  it("shows the same centre-of-mass note for a TOMBSTONED vessel.surface as for an absent one", async () => {
    // `== null` catches both, so "no lowest-point datum" and "none arrived yet" are one state here.
    renderWidget();

    act(() => {
      emitMunDescent();
      stream.emit(
        "vessel.surface",
        { heightFromTerrain: 4800 },
        { validAt: 9 },
      );
    });
    // The rail carries the lowest-point datum while live, proving the tombstone below replaced something.
    await waitFor(() =>
      expect(
        screen.getByRole("meter", { name: "Altitude above terrain" }),
      ).toHaveAttribute("aria-valuenow", "4800"),
    );
    expect(
      screen.queryByText(
        "centre-of-mass altitude (lowest-point datum unavailable)",
      ),
    ).toBeNull();

    act(() => {
      stream.emit("vessel.surface", null, { seq: 2, validAt: 10 });
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          "centre-of-mass altitude (lowest-point datum unavailable)",
        ),
      ).toBeInTheDocument(),
    );
    // The rail swaps to the centre-of-mass altitude off `vessel.flight`, a different measurement at the same scale, and names it.
    expect(
      screen.getByRole("meter", {
        name: /centre-of-mass altitude above terrain/i,
      }),
    ).toHaveAttribute("aria-valuenow", "5000");
  });

  it("withholds the affordability verdict rather than answering it when dv.summary is absent", async () => {
    // `affordable` is null, not false, with either side missing, so an absent budget renders a muted placeholder rather than an unaffordable burn; a viable descent, since the steep default takes the no-landing-vector branch.
    renderWidget();

    act(() => {
      emitMunDescent({
        altitudeTerrain: 2000,
        verticalSpeed: 10,
        surfaceSpeed: 30,
        availableThrust: 100,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Affordable")).toBeInTheDocument(),
    );
    expect(screen.queryByText("yes")).toBeNull();
    expect(screen.queryByText("insufficient dV")).toBeNull();
    // The dV readouts beside it are placeholders for the same absence.
    expect(screen.getByText("Available dV")).toBeInTheDocument();
    expect(screen.getAllByText(NULL_DISPLAY).length).toBeGreaterThanOrEqual(2);
  });

  it("drops the Divert section entirely while no target range is on the wire", async () => {
    // Absence renders as the section not existing, indistinguishable from "no target selected".
    renderWidget();

    act(() => {
      emitMunDescent();
    });

    // The descent board is up, so this is a real absence and not a suppressed widget.
    await waitFor(() =>
      expect(screen.getByText("Burn dV")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Divert")).toBeNull();
    expect(screen.queryByText("Target range")).toBeNull();
  });

  /** The present case: a 3-4-5 triangle scaled by 1000 gives a range of 5 km, measured as `Targeting` measures it. */
  it("shows the Divert section and the range once a target is on the wire", async () => {
    renderWidget();

    act(() => {
      emitMunDescent();
      stream.emit("vessel.target", {
        name: "Target",
        kind: 1,
        relativePosition: { x: 3_000, y: 4_000, z: 0 },
      });
    });

    await waitFor(() =>
      expect(screen.getAllByText("Target range").length).toBeGreaterThan(0),
    );
    // Rendered as "5.00 km" with figure and unit in separate elements, hence the number alone.
    expect(screen.getAllByText("5.00").length).toBeGreaterThan(0);
  });
});
