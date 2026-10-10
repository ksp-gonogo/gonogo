import type { TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { useStatusContribution } from "@ksp-gonogo/ui-kit";
import { BAND_BADGE_ID, BAND_TONE, bandBadge } from "./bands";
import { useThermal } from "./useThermal";

const PART_NAME_MAX = 12;

/** The part's name cut to what a tile row can hold, or the generic label while it has none. */
function partLabel(name: string | undefined): string {
  const trimmed = name?.trim();
  if (trimmed === undefined || trimmed === "") return "Part";
  return trimmed.length <= PART_NAME_MAX
    ? trimmed
    : `${trimmed.slice(0, PART_NAME_MAX - 3).trimEnd()}...`;
}

/**
 * The hottest part's and engine's share of their limits, the part row labelled
 * with the hottest part's name. The worst band is not a row: it is the panel's
 * status, drawn as the header dot, so a critical band reads as a red dot.
 */
export function useThermalEssentials(): readonly TinyEssential[] {
  const { worstBand, hottest, engine } = useThermal();
  const badge = bandBadge(worstBand);
  useStatusContribution(
    badge === null || badge.tone === "neutral"
      ? null
      : { id: BAND_BADGE_ID, severity: badge.tone, label: badge.label },
  );
  return [
    {
      label: partLabel(hottest.name),
      value: hottest.ratio,
      decimals: 0,
      tone: BAND_TONE[hottest.band],
    },
    {
      label: "Engine",
      value: engine.ratio,
      decimals: 0,
      tone: BAND_TONE[engine.band],
    },
  ];
}
