import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { readingOf, type TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { PLANTED_TINY_MISFIT_ID } from "./plantedTinyMisfit";

function usePlantedEssentials(): readonly TinyEssential[] {
  const career = useTelemetry("career.status");
  return [
    {
      label: "Bal",
      value: readingOf(career, (c) => c.economy?.funds ?? undefined),
      decimals: 0,
    },
  ];
}

/**
 * A widget whose tiny form fits its 2x3 floor while it has nothing to show and
 * overflows it once a real balance arrives, the way the Admin Building's did at
 * 2x2.
 * The render harness mounts it both ways to prove the tiny fit audit sees the
 * difference: an audit run only on empty states passes it.
 *
 * Registered by the harness's own page alone, so no gate that sweeps the
 * registry ever counts it among the real widgets.
 */
registerComponent({
  id: PLANTED_TINY_MISFIT_ID,
  name: "Planted tiny misfit",
  description: "A render harness plant: a tiny figure too wide for its tile.",
  tags: [],
  component: () => null,
  minSize: { w: 2, h: 3 },
  tiny: { title: "BAL", useEssentials: usePlantedEssentials },
  channels: ["career.status"],
});
