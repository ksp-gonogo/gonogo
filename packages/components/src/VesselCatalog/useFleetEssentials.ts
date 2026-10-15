import { type TinyEssential, value } from "@ksp-gonogo/sitrep-sdk";
import { commsRollup } from "./comms";
import { useFleet } from "./fleet";

/** The fleet's size and how much of it can be reached; a roster that has not arrived has no counts, which is not a count of zero. */
export function useFleetEssentials(): readonly TinyEssential[] {
  const { known, vessels } = useFleet();
  if (!known) {
    return [
      { label: "Vessels", value: null },
      { label: "Linked", value: null },
      { label: "No link", value: null },
    ];
  }
  const rollup = commsRollup(vessels);
  return [
    { label: "Vessels", value: value("count", vessels.length) },
    { label: "Linked", value: value("count", rollup.linked) },
    {
      label: "No link",
      value: value("count", rollup.none),
      tone: rollup.none > 0 ? "nogo" : "neutral",
    },
  ];
}
