import { getComponent } from "@ksp-gonogo/core";
import { widgetDrawnFields } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import "@ksp-gonogo/components";
// The app registers a widget of its own, which importing the component library
// does not pull in.
import "../goNoGo/GoNoGoComponent";
import { alarmMatchesWidget } from "./AlarmStatusBridge";
import type { Alarm } from "./types";

/**
 * The ledger of what each migrated widget's `dataRequirements` used to say,
 * and the assertion that an alarm saved against the old key still finds the
 * widget after the swap.
 *
 * This exists because the swap looked behaviour-preserving and was not. Both
 * consumers of `dataRequirements` matched by string equality against a legacy
 * key, so replacing that key with the topic the widget actually reads detached
 * every alarm from it, with nothing failing anywhere. An operator's saved alarm
 * simply stopped lighting the panel it was about.
 *
 * Alarm keys are user data: they come from a picker over the legacy catalog and
 * live in localStorage, so they outlive any given widget's declaration and
 * cannot be migrated by editing a widget. Every slice of the vocabulary
 * migration therefore adds its widgets here, and this is the file that fails if
 * a slice quietly drops one.
 *
 * `expectMatch: false` is for a key the widget never actually rendered. Those
 * are deliberate and each carries its reason: attribution restored to what the
 * widget draws is the point of the exercise, and preserving a wrong pointer
 * would preserve the bug.
 */
interface MigratedWidget {
  /** Registered component id. */
  id: string;
  /** Legacy keys this widget used to declare, and whether an alarm on each
   *  should still be attributed to it. */
  legacyKeys: ReadonlyArray<{
    key: string;
    expectMatch: boolean;
    why?: string;
  }>;
}

const MIGRATED: readonly MigratedWidget[] = [
  {
    id: "astronaut-complex",
    legacyKeys: [{ key: "career.funds", expectMatch: true }],
  },
  {
    id: "objectives",
    legacyKeys: [{ key: "contracts.active", expectMatch: true }],
  },
  {
    id: "system-view",
    legacyKeys: [
      {
        key: "b.number",
        expectMatch: false,
        why: "the widget walks the body array and renders no count, so a body-count alarm was never about it",
      },
    ],
  },
  {
    id: "current-orbit",
    legacyKeys: [
      { key: "o.sma", expectMatch: true },
      { key: "o.eccentricity", expectMatch: true },
      { key: "o.inclination", expectMatch: true },
      { key: "o.argumentOfPeriapsis", expectMatch: true },
      { key: "o.ApA", expectMatch: true },
      { key: "o.PeA", expectMatch: true },
      { key: "o.ApR", expectMatch: true },
      { key: "o.PeR", expectMatch: true },
      { key: "o.timeToAp", expectMatch: true },
      { key: "o.timeToPe", expectMatch: true },
      { key: "o.trueAnomaly", expectMatch: true },
      { key: "o.period", expectMatch: true },
      { key: "o.referenceBody", expectMatch: true },
      { key: "v.body", expectMatch: true },
    ],
  },
  {
    id: "orbit-view",
    legacyKeys: [
      { key: "o.sma", expectMatch: true },
      { key: "o.eccentricity", expectMatch: true },
      { key: "o.argumentOfPeriapsis", expectMatch: true },
      { key: "o.ApR", expectMatch: true },
      { key: "o.PeR", expectMatch: true },
      { key: "o.trueAnomaly", expectMatch: true },
      { key: "v.body", expectMatch: true },
      {
        key: "o.ApA",
        expectMatch: false,
        why: "the diagram is drawn from apsis radii; the altitude appeared only in the requirements list",
      },
      {
        key: "o.PeA",
        expectMatch: false,
        why: "same as o.ApA, radii are what the component reads",
      },
      {
        key: "b.number",
        expectMatch: false,
        why: "body geometry comes from getBody's static table, not a streamed count",
      },
    ],
  },
  {
    id: "strategies",
    legacyKeys: [
      { key: "strategies.all", expectMatch: true },
      { key: "career.funds", expectMatch: true },
      { key: "career.reputation", expectMatch: true },
      { key: "career.science", expectMatch: true },
    ],
  },
  {
    id: "tech-tree",
    legacyKeys: [
      { key: "tech.nodes", expectMatch: true },
      { key: "career.science", expectMatch: true },
      { key: "kc.scene", expectMatch: true },
    ],
  },
  {
    id: "contract-manager",
    legacyKeys: [
      { key: "contracts.active", expectMatch: true },
      { key: "contracts.offered", expectMatch: true },
      { key: "contracts.completedRecent", expectMatch: true },
      { key: "v.altitude", expectMatch: true },
    ],
  },
  {
    id: "space-center-status",
    legacyKeys: [
      { key: "kc.facilityLevels", expectMatch: true },
      { key: "kc.partsAvailable", expectMatch: true },
      { key: "kc.launchSite", expectMatch: true },
      { key: "kc.padOccupied", expectMatch: true },
      { key: "kc.padVesselTitle", expectMatch: true },
      { key: "kc.scene", expectMatch: true },
      { key: "career.funds", expectMatch: true },
    ],
  },
  {
    id: "thermal-status",
    legacyKeys: [
      { key: "therm.hottestPartName", expectMatch: true },
      { key: "therm.hottestPartTemp", expectMatch: true },
      { key: "therm.hottestPartMaxTemp", expectMatch: true },
      { key: "therm.hottestPartTempRatio", expectMatch: true },
      { key: "therm.hottestEngineTemp", expectMatch: true },
      { key: "therm.hottestEngineMaxTemp", expectMatch: true },
      { key: "therm.hottestEngineTempRatio", expectMatch: true },
      { key: "therm.anyEnginesOverheating", expectMatch: true },
      { key: "therm.heatShieldTemp", expectMatch: true },
      { key: "therm.heatShieldFlux", expectMatch: true },
    ],
  },
  {
    id: "crew-status",
    legacyKeys: [
      { key: "v.crew", expectMatch: true },
      { key: "v.crewCount", expectMatch: true },
      { key: "v.crewCapacity", expectMatch: true },
      { key: "v.isEVA", expectMatch: true },
    ],
  },
  {
    id: "warp-control",
    legacyKeys: [
      { key: "t.currentRate", expectMatch: true },
      { key: "t.timeWarp", expectMatch: true },
      { key: "t.warpMode", expectMatch: true },
      { key: "t.isPaused", expectMatch: true },
    ],
  },
  {
    id: "comm-signal",
    legacyKeys: [
      { key: "comm.connected", expectMatch: true },
      { key: "comm.signalStrength", expectMatch: true },
      { key: "comm.controlState", expectMatch: true },
      { key: "comm.controlStateName", expectMatch: true },
      { key: "comm.signalDelay", expectMatch: true },
    ],
  },
  {
    id: "ship-map",
    legacyKeys: [
      { key: "therm.hottestPartName", expectMatch: true },
      { key: "v.externalTemperature", expectMatch: true },
      { key: "f.throttle", expectMatch: true },
    ],
  },
  {
    // Registered by the app rather than the component library, so the
    // library's own declaration gate cannot see it: covered here instead.
    id: "gonogo",
    legacyKeys: [{ key: "v.missionTime", expectMatch: true }],
  },
  {
    id: "maneuver-planner",
    legacyKeys: [
      { key: "o.sma", expectMatch: true },
      { key: "o.eccentricity", expectMatch: true },
      { key: "o.inclination", expectMatch: true },
      { key: "o.lan", expectMatch: true },
      { key: "o.argumentOfPeriapsis", expectMatch: true },
      { key: "o.ApR", expectMatch: true },
      { key: "o.PeR", expectMatch: true },
      { key: "o.timeToAp", expectMatch: true },
      { key: "o.timeToPe", expectMatch: true },
      { key: "o.trueAnomaly", expectMatch: true },
      { key: "o.orbitalSpeed", expectMatch: true },
      { key: "o.radius", expectMatch: true },
      { key: "o.referenceBody", expectMatch: true },
      { key: "v.body", expectMatch: true },
      { key: "o.maneuverNodes", expectMatch: true },
      { key: "o.maneuverNodeIds", expectMatch: true },
    ],
  },
  {
    // The parametric family is the case for declaring a CHANNEL: twenty keys
    // still attribute here off three declarations, because each resolves to a
    // path inside one of them.
    id: "fuel-status",
    legacyKeys: [
      { key: "v.currentStage", expectMatch: true },
      { key: "dv.stageCount", expectMatch: true },
      { key: "dv.totalDVVac", expectMatch: true },
      { key: "dv.totalDVASL", expectMatch: true },
      { key: "dv.totalDVActual", expectMatch: true },
      { key: "dv.totalBurnTime", expectMatch: true },
      { key: "r.resource[LiquidFuel]", expectMatch: true },
      { key: "r.resourceMax[LiquidFuel]", expectMatch: true },
      { key: "r.resourceCurrent[LiquidFuel]", expectMatch: true },
      { key: "r.resourceCurrentMax[LiquidFuel]", expectMatch: true },
      { key: "r.resource[Oxidizer]", expectMatch: true },
      { key: "r.resourceMax[Oxidizer]", expectMatch: true },
      { key: "r.resourceCurrent[Oxidizer]", expectMatch: true },
      { key: "r.resourceCurrentMax[Oxidizer]", expectMatch: true },
      { key: "r.resource[MonoPropellant]", expectMatch: true },
      { key: "r.resourceMax[MonoPropellant]", expectMatch: true },
      { key: "r.resourceCurrent[MonoPropellant]", expectMatch: true },
      { key: "r.resourceCurrentMax[MonoPropellant]", expectMatch: true },
      { key: "r.resource[XenonGas]", expectMatch: true },
      { key: "r.resourceMax[XenonGas]", expectMatch: true },
      { key: "r.resourceCurrent[XenonGas]", expectMatch: true },
      { key: "r.resourceCurrentMax[XenonGas]", expectMatch: true },
      { key: "r.resource[ElectricCharge]", expectMatch: true },
      { key: "r.resourceMax[ElectricCharge]", expectMatch: true },
      { key: "r.resourceCurrent[ElectricCharge]", expectMatch: true },
      { key: "r.resourceCurrentMax[ElectricCharge]", expectMatch: true },
    ],
  },
  {
    id: "map-view",
    legacyKeys: [
      { key: "v.lat", expectMatch: true },
      { key: "v.long", expectMatch: true },
      { key: "v.altitude", expectMatch: true },
      { key: "v.body", expectMatch: true },
      { key: "o.orbitPatches", expectMatch: true },
      { key: "o.encounterExists", expectMatch: true },
      { key: "o.encounterBody", expectMatch: true },
      { key: "o.UTsoi", expectMatch: true },
      {
        key: "o.encounterTime",
        expectMatch: false,
        why: "it names the SECONDS REMAINING and the wire carries the instant; mapping the duration's key onto it is the bug that rendered a twenty-minute encounter as 46 days, so it now maps to nothing and an alarm on it reaches no widget at all",
      },
      { key: "o.nextApsisType", expectMatch: true },
      { key: "o.timeToNextApsis", expectMatch: true },
    ],
  },
  {
    id: "launch-director",
    legacyKeys: [
      { key: "kc.savedShips", expectMatch: true },
      { key: "kc.crewRoster", expectMatch: true },
      { key: "kc.launchSites", expectMatch: true },
      { key: "kc.scene", expectMatch: true },
      { key: "kc.launchSite", expectMatch: true },
      { key: "kc.padOccupied", expectMatch: true },
      { key: "kc.padVesselTitle", expectMatch: true },
      { key: "career.funds", expectMatch: true },
      { key: "v.name", expectMatch: true },
      { key: "v.missionTime", expectMatch: true },
      { key: "v.altitude", expectMatch: true },
      { key: "ksp.canRevertToLaunch", expectMatch: true },
      { key: "ksp.canRevertToEditor", expectMatch: true },
    ],
  },
  {
    id: "experiments",
    legacyKeys: [
      { key: "sci.instruments", expectMatch: true },
      { key: "sci.experiments", expectMatch: true },
    ],
  },
  {
    id: "science-data",
    legacyKeys: [
      { key: "v.body", expectMatch: true },
      { key: "v.situationString", expectMatch: true },
      { key: "v.landedAt", expectMatch: true },
      { key: "v.biome", expectMatch: true },
      { key: "sci.experiments", expectMatch: true },
      { key: "sci.experimentBreakdown", expectMatch: true },
      { key: "sci.archive", expectMatch: true },
      { key: "career.science", expectMatch: true },
      {
        key: "career.mode",
        expectMatch: false,
        why: "it appeared only in the requirements list; the widget branches on game signal and flight state, never on career mode",
      },
    ],
  },
  {
    id: "navball",
    legacyKeys: [
      { key: "n.heading", expectMatch: true },
      { key: "n.pitch", expectMatch: true },
      { key: "n.roll", expectMatch: true },
      { key: "n.heading2", expectMatch: true },
      { key: "n.pitch2", expectMatch: true },
      { key: "n.roll2", expectMatch: true },
      { key: "f.sasMode", expectMatch: true },
      { key: "f.sasEnabled", expectMatch: true },
      { key: "f.precisionControl", expectMatch: true },
      { key: "v.rcsValue", expectMatch: true },
      { key: "f.throttle", expectMatch: true },
      { key: "v.isControllable", expectMatch: true },
      { key: "comm.signalDelay", expectMatch: true },
    ],
  },
];

function thresholdAlarm(dataKey: string): Alarm {
  return {
    id: `alarm-${dataKey}`,
    name: dataKey,
    state: "firing",
    createdBy: "main",
    createdAt: 0,
    trigger: {
      kind: "threshold",
      dataKey,
      op: ">",
      value: 0,
      sustainSeconds: 0,
    },
  };
}

describe("migrated widgets keep the alarms saved against their old keys", () => {
  for (const widget of MIGRATED) {
    describe(widget.id, () => {
      it("is registered and declares no legacy key any more", () => {
        const def = getComponent(widget.id);
        expect(def, `${widget.id} is not registered`).toBeDefined();
        const stillLegacy = (def?.dataRequirements ?? []).filter(
          (requirement) =>
            widget.legacyKeys.some(({ key }) => key === requirement),
        );
        expect(stillLegacy).toEqual([]);
      });

      for (const { key, expectMatch, why } of widget.legacyKeys) {
        it(`${expectMatch ? "still attributes" : "no longer attributes"} an alarm on ${key}${why ? `, because ${why}` : ""}`, () => {
          const def = getComponent(widget.id);
          expect(
            // The SAME accessor `GridItemContent` hands `AlarmStatusBridge`. It
            // has to be, or this asserts about a path production does not take.
            alarmMatchesWidget(thresholdAlarm(key), widgetDrawnFields(def)),
          ).toBe(expectMatch);
        });
      }
    });
  }
});
