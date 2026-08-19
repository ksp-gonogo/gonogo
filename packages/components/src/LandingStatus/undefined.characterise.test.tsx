import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

/**
 * What `undefined` MEANS to LandingStatus today, recorded before `useTelemetry`
 * starts returning a `Reading`.
 *
 * This widget reads nine topics and gives absence a DIFFERENT meaning on almost
 * every one:
 *
 * - `vessel.flight` absent means "not descending", which suppresses the whole
 *   body behind an empty state
 * - `comms.delay` absent means "no link", and is the one place the widget is
 *   deliberately honest about not knowing. A PRESENT but empty record means
 *   zero delay instead, so absence and emptiness disagree by a whole regime
 * - `vessel.surface` absent means "fall back to the centre-of-mass datum and
 *   say so", and it fires identically for a tombstone and for a channel that
 *   never arrived
 * - `dv.summary` absent means the affordability verdict is withheld rather than
 *   answered "insufficient"
 *
 * Every one of those gates stops gating once a `Reading` is always truthy, so
 * each has a test here that proves it FIRES today.
 */
const CARRIED = [
  "vessel.state",
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
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    registerStockBodies();
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
  });

  function renderWidget(size?: { w: number; h: number }) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "land-undef" }}>
          <LandingStatusComponent
            id="land-undef"
            w={size?.w ?? 8}
            h={size?.h ?? 12}
          />
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

  /**
   * A Mun descent. The default is the steep, unrecoverable one (5 km AGL
   * carrying 540 m/s), which is what the other tests in this directory use;
   * overrides buy a viable descent where the ABORT hero is not the branch under
   * test.
   */
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

  /**
   * Recorded prior behaviour: "a dashed suicide-burn hero when nothing has
   * arrived". `live` was `regime === "live" || regime === "no-path"`, so no link
   * and a closed real-time loop took the same hero arm and an operator with no
   * telemetry at all was shown a SUICIDE BURN countdown slot.
   *
   * `classifyRegime` already refused to call an unknown link live, calling that
   * out in its own doc as "defensive: never silently treat a lost path as live".
   * The next line undid it. The hero now has its own arm for a link it cannot
   * vouch for.
   */
  it("shows the empty state, a NO LINK regime and a hero that asks for a link when nothing has arrived", () => {
    const { container } = renderWidget();

    // The body: `solveSuicideBurn` returns "not-descending" for an undefined
    // height, so `deriveBoard` suppresses every readout.
    expect(visibleText(container)).toContain("No landing in progress");
    // The header is NOT suppressed, and it keeps talking. The regime pill is
    // the one honest reading: `readOneWaySeconds(undefined)` returns null and
    // `classifyRegime` refuses to call an unknown link live.
    expect(screen.getByText("NO LINK")).toBeInTheDocument();
    // And the hero agrees with it rather than contradicting it: no claim about
    // burn timing, and it names the link as the missing thing.
    const hero = screen.getByRole("status");
    expect(hero).toHaveTextContent("BURN TIMING NEEDS A LINK");
    expect(hero).toHaveTextContent(NULL_DISPLAY);
    // The claim that used to be here. Both the ignition countdown and the
    // burn-GO clock are withheld, because each one asserts a different link
    // state and nothing has established either.
    expect(hero).not.toHaveTextContent("SUICIDE BURN");
    expect(hero).not.toHaveTextContent("BURN GO IN");
    // No round-trip readout: `roundTripSeconds` is null, not zero.
    expect(screen.queryByText(/^RT /)).toBeNull();
    // No body caption at all, the `bodyName !== undefined` gate: the widget
    // declines to guess between atmospheric and vacuum.
    expect(visibleText(container)).not.toContain("vacuum");
    expect(visibleText(container)).not.toContain("atmospheric");
  });

  it("flips NO LINK to LIVE the moment comms.delay arrives saying there is no delay", async () => {
    // The `if (!delay) return null` gate, proven to fire: the two states differ
    // ONLY by whether the record exists. A zero-delay link and an unknown link
    // are the same numbers and different words, which is the distinction the
    // gate exists to make.
    renderWidget();
    expect(screen.getByText("NO LINK")).toBeInTheDocument();

    act(() => {
      stream.emit("comms.delay", { source: 0, oneWaySeconds: 0 });
    });

    await waitFor(() => expect(screen.getByText("LIVE")).toBeInTheDocument());
    expect(screen.queryByText("NO LINK")).toBeNull();
  });

  /**
   * `oneWaySeconds: null` is the mod's DOCUMENTED "no path" signal, and
   * `command-delay.ts` says of it: "null means NO PATH, never a measured
   * zero-distance delay. Never coerce it to 0."
   *
   * `readOneWaySeconds` coerced it to 0 anyway, and `classifyRegime` reads a
   * zero round trip as `live`. So a vessel with no comms path rendered
   * "T-1s SUICIDE BURN" behind a green LIVE badge: a countdown an operator
   * would burn on, asserted about a craft nothing can reach. Found by
   * rendering it, not by reading it.
   *
   * The `no-path` arm in `CommitLayer` was written expecting this null and
   * could only ever be reached by the payload being ABSENT, so the two halves
   * of the design disagreed about which value meant "no path".
   */
  /**
   * Each of these emits a GOOD delay first and waits for the pill to leave
   * `NO LINK`, then emits the absence and waits for it to come back.
   *
   * That shape is the point. `NO LINK` is also the pre-emit state, so a test
   * that merely waited for `NO LINK` after emitting passed on the first tick,
   * before the emit had propagated, and reported success while measuring
   * nothing. Both of these tests did exactly that when first written, and
   * agreed with a render that showed the opposite. Requiring the pill to change
   * TWICE is what makes the second change real.
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
    // Same defect, milder shape: a record carrying neither a source nor a
    // one-way time fell through to `return 0` and reported a closed real-time
    // loop. Nothing in an empty frame says the link is up.
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

  it("still reads a CommsDelaySource.None record as a LIVE zero-delay link", async () => {
    // The one place zero is a real measurement rather than a fabrication:
    // source None is a LAN loop with genuinely no delay. This is what stops the
    // fix above from turning every local session into NO LINK.
    renderWidget();
    expect(screen.getByText("NO LINK")).toBeInTheDocument();

    act(() => {
      stream.emit("comms.delay", { source: 0, oneWaySeconds: 0 });
    });

    await waitFor(() => expect(screen.getByText("LIVE")).toBeInTheDocument());
  });

  it("degrades to the centre-of-mass datum WITH a note when vessel.surface never arrives", async () => {
    // `surfaceHeight == null` is the gate, and the note is the widget's own
    // statement that its primary datum is missing. The fallback altitude is a
    // different measurement (centre of mass, not the vessel's lowest point), so
    // this note is the only thing distinguishing the two on screen.
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

    // And it clears once the lowest-point datum does arrive, which is what
    // makes the assertion above a gate rather than a constant.
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

  it("shows the same centre-of-mass note for a TOMBSTONED vessel.surface as for an absent one", async () => {
    // `null` vs `undefined`: the doc comment on the fallback says it covers
    // `vessel.surface` being NULLED by the orbiting/escaping capture guard, and
    // `== null` catches both. So a confirmed "there is no lowest-point datum"
    // and "none has arrived" are one state to this widget.
    renderWidget();

    act(() => {
      emitMunDescent();
      stream.emit(
        "vessel.surface",
        { heightFromTerrain: 4800 },
        { validAt: 9 },
      );
    });
    // The rail carries the lowest-point datum while the channel is live, which
    // is what proves the tombstone below actually replaced something.
    await waitFor(() =>
      expect(
        screen.getByRole("meter", { name: /altitude above terrain/i }),
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
    // And the rail silently swaps to the centre-of-mass altitude off
    // `vessel.flight`: a different measurement at the same scale.
    expect(
      screen.getByRole("meter", { name: /altitude above terrain/i }),
    ).toHaveAttribute("aria-valuenow", "5000");
  });

  it("withholds the affordability verdict rather than answering it when dv.summary is absent", async () => {
    // `affordable` is `null` (not `false`) when either side of the comparison is
    // missing, and the render branches on that to a muted placeholder instead of
    // the yes / insufficient-dV badge. An absent fuel budget must not read as an
    // unaffordable burn.
    //
    // A VIABLE descent, deliberately: under the steep default the widget shows
    // "n/a · no path" here instead, which is the no-landing-vector branch rather
    // than the absent-budget one.
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
    // `vs?.targetDistance != null` guards both the Divert section and the
    // Target range readout. Absence is rendered as the section not existing, so
    // there is nothing on screen to distinguish "no target selected" from "the
    // target channel has not arrived yet".
    renderWidget();

    act(() => {
      emitMunDescent();
    });

    // The descent board IS up, so this is a real absence and not a suppressed
    // widget.
    await waitFor(() =>
      expect(screen.getByText("Burn dV")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Divert")).toBeNull();
    expect(screen.queryByText("Target range")).toBeNull();
  });
});
