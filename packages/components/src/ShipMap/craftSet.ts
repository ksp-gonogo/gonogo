import {
  buildPartStateByFlightId,
  buildResourcesByFlightId,
  deriveTopologyFromVesselParts,
} from "@ksp-gonogo/data";
import type { VesselParts } from "@ksp-gonogo/sitrep-sdk";
import { wrapTopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { buildShipMapPart, type ShipMapPart } from "./shipTopology";
import { pickView, turnedView } from "./shipView";

/** The names of the captured `vessel.parts` frames under `__fixtures__/craftset`. */
export const CRAFT_SET = [
  "kerbal-x",
  "learstar-orbiter",
  "learstar-orbiter-gear-down",
  "learstar-orbiter-bays-open",
  "learstar-a1",
  "butterfly-rover",
  "two-stage-lander",
  "station-core",
  "station-core-panels-extended",
  "comsat-lx-fairing",
] as const;

/** The raw `vessel.parts` payload of a captured frame: the part list, with each part's wire fields. */
export interface CraftWire {
  parts: {
    id: string;
    name: string;
    category: string;
    categoryOrdinal: number;
    modules: string[];
    moduleStates: { type: string; state: string }[];
  }[];
}

/** A captured frame turned into the parts the Ship Map draws, by the same adapters the widget runs. `turn` presses of the rotate control are applied to the default view. */
export function craftParts(wire: CraftWire, turn = 0): ShipMapPart[] {
  const parts = wrapTopicPayload<VesselParts>(
    "vessel.parts",
    structuredClone({ parts: wire.parts }) as never,
  );
  const topology = deriveTopologyFromVesselParts(parts);
  const state = buildPartStateByFlightId(parts);
  const resources = buildResourcesByFlightId(parts);
  const angle = turnedView(pickView(topology.parts), turn);
  return topology.parts.map((p) =>
    buildShipMapPart(
      p,
      undefined,
      resources.get(p.flightId),
      angle,
      state.get(p.flightId),
    ),
  );
}
