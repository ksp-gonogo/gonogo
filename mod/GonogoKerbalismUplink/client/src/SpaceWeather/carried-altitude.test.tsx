import { getComponent } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
// Importing the real module runs its module-load registerComponent(...), which
// is what the registry lookup below and `renderWidget` both read.
import "./index";

/**
 * Where the "you are here" mark sits when the altitude behind it was MODELLED
 * rather than observed.
 *
 * The widget overlays `vessel.flight`'s reckoning onto the observation, and the
 * mark is placed from `altitudeAsl`, which is exactly the field the conic
 * moves. So the overlay is not decoration here: it is the difference between a
 * mark drawn where the craft is and one drawn where it was when the link last
 * delivered.
 *
 * Every case below therefore reads the mark's POSITION rather than snapshotting
 * the board. Dropping the overlay leaves a widget that still renders, still
 * draws a mark and still matches a snapshot: it just puts the craft 1400 km
 * lower than it is, which is the substitution the whole reckoning design exists
 * to prevent.
 */

function spaceWeather() {
  const def = getComponent("space-weather");
  if (!def) throw new Error("space-weather is not registered");
  const topic = def.channels?.[0];
  if (!topic) throw new Error("space-weather declares no primary channel");
  return { def, topic };
}
const { def: SW, topic: TOPIC } = spaceWeather();

/**
 * The conic's two inputs alongside the widget's own channels: the model
 * declines outright without the elements and the body roster to solve them
 * against, and a declined model is a green case that measured nothing.
 */
const CARRIED = [
  ...(SW.channels ?? []),
  ...(SW.optionalChannels ?? []),
  "vessel.orbit",
  "system.bodies",
];

/**
 * A craft climbing out of the periapsis of a strongly eccentric Kerbin orbit,
 * read twenty minutes after its last packet.
 *
 * The orbit is chosen for the SIZE of the gap it opens between the last
 * observation and the truth: from a 100 km periapsis the craft clears 1500 km
 * inside the window, so the observed and the modelled placements are two
 * visibly different marks rather than two roundings of one number. Twenty
 * minutes without a packet is an ordinary occultation, not a contrivance.
 */
const ANCHOR_UT = 1000;
const VIEW_UT = 2200;
const OBSERVED_ALTITUDE_M = 100_000;

/** Kerbin, with the atmosphere depth the conic's own floor is measured from. */
const BODIES = {
  bodies: [
    {
      name: "Kerbin",
      index: 1,
      parentIndex: 0,
      radius: 600_000,
      atmosphere: { depth: 70_000 },
      orbit: null,
    },
  ],
};

const ORBIT = {
  referenceBodyIndex: 1,
  sma: 5_000_000,
  ecc: 0.86,
  inc: 0,
  lan: 0,
  argPe: 0,
  // Periapsis AT the anchor, so the whole window is the outbound climb.
  meanAnomalyAtEpoch: 0,
  epoch: ANCHOR_UT,
  mu: 3.5316e12,
  horizon: { kind: 1, trajectoryKind: 1 },
};

/** Sheltered, in neither belt, so the mark's radius is the altitude's to set. */
const WEATHER = {
  radiationRadPerSecond: 0.0143 / 3600,
  magnetosphere: true,
  innerBelt: false,
  outerBelt: false,
  stormIncoming: false,
  stormInProgress: false,
  blackout: false,
  inSunlight: true,
  shieldingAmount: 3.308,
  shieldingCapacity: 3.308,
};

/**
 * The weather record, presented as CURRENT at the view time.
 *
 * Spelled out rather than left to the fixture's default because this widget
 * withholds the entire board on a stale weather reading, and a board that was
 * never drawn would satisfy every negative assertion below while measuring
 * nothing at all.
 */
const CURRENT = { validAt: VIEW_UT, deliveredAt: VIEW_UT, staleness: 0 };

/**
 * The flight sample, twenty minutes old and PRESENTED as old.
 *
 * `staleness` is what hands the reckoner a grade: a model only runs across a
 * gap the store has already called a gap, so a sample presented as current
 * would leave the reading unreckoned and every assertion here trivially true.
 */
const LAST_PACKET = {
  validAt: ANCHOR_UT,
  deliveredAt: ANCHOR_UT,
  staleness: 1,
};

/*
 * `RenderResult` is declared inside `@ksp-gonogo/ui-kit/testing` but is not
 * exported from it, so the type is reached through the function that returns it
 * rather than by name. A type-only import of it compiles away under vitest and
 * only fails at `pnpm typecheck`.
 */
type WidgetTree = ReturnType<typeof renderWidget>;

let stream: ReturnType<typeof setupStreamFixture>;

function mount(): WidgetTree {
  return renderWidget("space-weather", {
    instanceId: "sw-carried",
    w: 8,
    h: 11,
    wrapper: stream.Provider,
  });
}

function emitClimbingOutOfPeriapsis(): void {
  act(() => {
    stream.emit("system.bodies", BODIES);
    stream.emit("vessel.orbit", ORBIT, { quality: 0 });
    stream.emit(TOPIC, WEATHER, CURRENT);
    stream.emit(
      "vessel.flight",
      {
        altitudeAsl: OBSERVED_ALTITUDE_M,
        altitudeTerrain: OBSERVED_ALTITUDE_M,
      },
      LAST_PACKET,
    );
  });
}

/**
 * The belt diagram's own placement arithmetic, so each expectation below is an
 * ALTITUDE rather than a number lifted out of the implementation: the box is
 * 100 units across, the body is radius 12 and the magnetopause 48, and an
 * altitude maps linearly across that span up to 8000 km.
 */
function markCxFor(altitudeKm: number): number {
  return 50 + 12 + Math.min(1, Math.max(0, altitudeKm / 8000)) * 36;
}

const PLACED = "Radiation belt position";
const UNPLACED = "Radiation belts, vessel position unknown";

/**
 * How far out from the body the vessel mark sits, in the diagram's own units.
 *
 * The diagram is reached through its accessible name, which is the same
 * statement a screen reader gets: the two names above are how this widget says
 * whether it placed a craft at all. Inside it the mark has no name of its own,
 * so it is found by its radius, the rings and the body all being larger and
 * concentric while the vessel is the only thing drawn off-centre.
 */
function vesselMarkCx(tree: WidgetTree): number {
  const diagram = tree.getByRole("img", { name: PLACED });
  const mark = diagram.querySelector<SVGCircleElement>('circle[r="3"]');
  if (mark === null) throw new Error("the belt diagram drew no vessel mark");
  const cx = Number(mark.getAttribute("cx"));
  if (!Number.isFinite(cx)) {
    throw new Error(`the vessel mark has no cx: ${mark.outerHTML}`);
  }
  return cx;
}

describe("SpaceWeather places the vessel from the carried altitude", () => {
  beforeEach(() => {
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: VIEW_UT,
    });
  });

  it("places a vessel on the belt diagram at all", async () => {
    // The control. Without it every assertion below would also pass on a widget
    // whose diagram never places a craft.
    const tree = mount();
    emitClimbingOutOfPeriapsis();
    await waitFor(() => expect(vesselMarkCx(tree)).toBeGreaterThan(50));
  });

  it("puts the craft where the conic says it is, not where it was last seen", async () => {
    // The overlay, as a figure. The last packet had the craft at 100 km and
    // twenty minutes of climb have taken it past 1500 km, so a mark drawn from
    // the observation sits almost on the body while the craft is out near the
    // inner belt.
    const tree = mount();
    emitClimbingOutOfPeriapsis();
    await waitFor(() => expect(vesselMarkCx(tree)).toBeGreaterThan(50));

    const cx = vesselMarkCx(tree);
    expect(cx).toBeGreaterThan(markCxFor(1400));
    expect(cx).toBeLessThan(markCxFor(1700));
    // And specifically not the observation, which is a claim about where a
    // habitat is sitting that the operator has no way to catch.
    expect(cx).not.toBeCloseTo(markCxFor(OBSERVED_ALTITUDE_M / 1000), 1);
  });

  it("says the position is unknown rather than falling back on the last one", async () => {
    // No elements, so no model. The observation is stale, and a mark placed
    // from it would be the same false claim the overlay exists to replace, so
    // the diagram has to say it placed nobody.
    const tree = mount();
    act(() => {
      stream.emit("system.bodies", BODIES);
      stream.emit(TOPIC, WEATHER, CURRENT);
      stream.emit(
        "vessel.flight",
        { altitudeAsl: OBSERVED_ALTITUDE_M },
        LAST_PACKET,
      );
    });

    await waitFor(() =>
      expect(tree.getByRole("img", { name: UNPLACED })).toBeTruthy(),
    );
    expect(tree.queryByRole("img", { name: PLACED })).toBeNull();
  });
});
