import { type Tone, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  NULL_DISPLAY,
  Text,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { Hazard } from "./hazardVerdict";
import type { LandingModel } from "./useLandingModel";

type Model = Readonly<{ model: LandingModel }>;

function bannerTone(noLandingVector: boolean, hazard: Hazard | null): Tone {
  if (noLandingVector || hazard === "DIVERT") return "nogo";
  if (hazard === "MARGINAL") return "warn";
  if (hazard === "SAFE") return "go";
  // UNRESOLVED: green would state a verdict and amber a site finding, when the finding is about the model.
  return "neutral";
}

/** The site verdict; with NO LANDING VECTOR it reads ABORT, never DIVERT or a green SAFE. */
export function VerdictBanner({ model }: Model) {
  const { noLandingVector } = model;
  const hazard = model.hazardVerdict.verdict;
  return (
    <div role="status" aria-live="polite">
      <Badge tone={bannerTone(noLandingVector, hazard)}>
        {noLandingVector ? "ABORT" : (hazard ?? "NO SITE")}
      </Badge>
    </div>
  );
}

/** Metres between the patch's lowest and highest cell, or null for a flat or unknown patch. */
function reliefRange(
  patch: readonly { magnitude: number }[] | null | undefined,
): number | null {
  if (!patch || patch.length === 0) return null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const { magnitude: hgt } of patch) {
    if (!Number.isFinite(hgt)) continue;
    if (hgt < lo) lo = hgt;
    if (hgt > hi) hi = hgt;
  }
  return Number.isFinite(lo) && hi > lo ? hi - lo : null;
}

function sourceLabel(source: string | null | undefined): string | null {
  if (source === "predicted") return "predicted";
  if (source === "sub-vessel") return "sub-vessel (est.)";
  return null;
}

/** Biome, slope, relief, downrange distance and where the sample came from, on one line. */
export function TerrainReadout({ model }: Model) {
  const { landing, landingReading, siteDrift } = model;
  const relief = reliefRange(landing?.terrainPatch);
  const source = sourceLabel(landing?.sampleSource);
  return (
    <Text level="muted" size="xs">
      {landing?.predictedBiome ? `${landing.predictedBiome} · ` : ""}
      {landing?.predictedSlopeAngle != null ? (
        <>
          <Unit value={landingReading.predictedSlopeAngle} decimals={1} /> slope
        </>
      ) : (
        NULL_DISPLAY
      )}
      {relief != null && relief >= 1
        ? ` · Δ ${writeQuantity(value("m", relief), { decimals: 0 })} relief`
        : ""}
      {siteDrift != null
        ? ` · ${writeQuantity(value("m", siteDrift.distanceMeters), { decimals: 0 })} downrange`
        : ""}
      {source ? ` · ${source}` : ""}
    </Text>
  );
}
