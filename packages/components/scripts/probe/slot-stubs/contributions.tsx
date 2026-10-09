import {
  type ExperimentsInstrumentEntry,
  type PlotEntry,
  stillTrue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { plantContribution } from "./stub";

/*
 * A stand-in contribution for every contribution slot a built-in widget
 * declares, each entry labelled with the slot it fills wherever the entry
 * carries text. Slots whose entries name something in the scene (a kerbal, a
 * part, a hop, a vessel, a body) read it from the scene's own Topics.
 */

plantContribution("astronaut-complex.readouts", {
  compute: () => [
    { id: "stub", label: "astronaut-complex.readouts", text: "stub" },
  ],
});

plantContribution("comm-signal.hop-rates", {
  deps: ["comms.path"],
  compute: (topics) =>
    stillTrue(topics["comms.path"], null)?.hops.map((hop) => ({
      fromNodeId: hop.from,
      toNodeId: hop.to,
      bitsPerSec: 9_600,
    })) ?? null,
});

/** The names of the kerbals aboard, as the crew roster reports them. */
function crewNames(
  crew: { crew: { name?: string | null }[] } | null | undefined,
): string[] {
  return (crew?.crew ?? []).flatMap((kerbal) =>
    kerbal.name ? [kerbal.name] : [],
  );
}

plantContribution("crew-status.row-tone", {
  deps: ["vessel.crew"],
  compute: (topics) =>
    crewNames(stillTrue(topics["vessel.crew"], null)).map((crewName) => ({
      crewName,
      tone: "warn" as const,
    })),
});

plantContribution("crew-status.meters", {
  deps: ["vessel.crew"],
  compute: (topics) =>
    crewNames(stillTrue(topics["vessel.crew"], null)).map((name) => ({
      id: name,
      label: "crew-status.meters",
      value: value("ratio", 0.5),
      row: name,
    })),
});

const INSTRUMENT: ExperimentsInstrumentEntry = {
  partId: "planted-slot-instrument",
  partTitle: "experiments.instruments",
  expId: "plantedSlotScan",
  deployed: false,
  hasData: true,
  rerunnable: true,
  inoperable: false,
  reading: { state: "observed", value: [], reckoning: { status: "none" } },
};

plantContribution("experiments.instruments", {
  compute: () => [INSTRUMENT],
});

const PLOT: PlotEntry = {
  subject: "planted-slot-plot",
  title: "plots",
  frame: { xDomain: [0, 1], yDomain: [0, 1] },
  layers: [
    {
      kind: "caption",
      id: "stub",
      anchor: "top-left",
      text: "plots",
      tone: "info",
    },
  ],
};

plantContribution("plots", {
  compute: () => [PLOT],
});

plantContribution("ship-map.part-meters", {
  deps: ["vessel.parts"],
  compute: (topics) => {
    const part = stillTrue(topics["vessel.parts"], null)?.parts[0];
    if (!part) return null;
    return [
      {
        partId: String(part.id),
        resource: "ElectricCharge",
        displayName: "ship-map.part-meters",
        amount: value("units", 50),
        capacity: value("units", 100),
      },
    ];
  },
});

plantContribution("ship-map.part-meta", {
  deps: ["vessel.parts"],
  compute: (topics) => {
    const part = stillTrue(topics["vessel.parts"], null)?.parts[0];
    if (!part) return null;
    return [
      {
        partId: String(part.id),
        label: "ship-map.part-meta",
        tone: "info" as const,
        kind: "text" as const,
        text: "stub",
      },
    ];
  },
});

plantContribution("space-center-status.facilities", {
  compute: () => [
    {
      facility: "LaunchPad",
      currentTier: 0,
      maxTier: 2,
      currentTierText: "* space-center-status.facilities: stub",
    },
  ],
});

/** How far from its body the stand-in entity sits: outside Kerbin, inside its SOI. */
const ENTITY_OFFSET_M = 1_500_000;

plantContribution("system-view.entities", {
  deps: ["system.bodies"],
  compute: (topics) =>
    stillTrue(topics["system.bodies"], null)?.bodies.flatMap((body) =>
      body.name
        ? [
            {
              id: `planted-slot-entity:${body.name}`,
              position: {
                kind: "fixed" as const,
                parentName: body.name,
                xMetres: ENTITY_OFFSET_M,
                yMetres: 0,
                zMetres: 0,
              },
              shape: { kind: "point" as const, radiusPx: 6 },
              style: { tone: "info" as const },
              meta: { slot: "system-view.entities" },
            },
          ]
        : [],
    ) ?? null,
});

plantContribution("system-view.vessel-status", {
  deps: ["vessel.identity"],
  compute: (topics) => {
    const vessel = stillTrue(topics["vessel.identity"], null);
    if (!vessel) return null;
    return [
      {
        target: vessel.vesselId,
        tone: "warn" as const,
        emphasis: "reckoned" as const,
        label: "system-view.vessel-status",
      },
    ];
  },
});

/**
 * One projection of its own per body that has a parent, with an id the host's
 * stock entries never use, so a scene can pin it by id and the frame it draws
 * in is the one thing that differs from the host without it.
 */
plantContribution("system-view.projection", {
  deps: ["system.bodies"],
  compute: (topics) =>
    stillTrue(topics["system.bodies"], null)?.bodies.flatMap((body) =>
      body.parentIndex != null && body.parentIndex !== body.index
        ? [
            {
              id: `planted-slot-projection:${body.index}`,
              label: "system-view.projection",
              choice: {
                kind: "parent-direction" as const,
                bodyIndex: body.index,
              },
              extent: { kind: "auto-fit-metres" as const },
              frameBodyIndex: body.index,
            },
          ]
        : [],
    ) ?? null,
});
