import { type Tone, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  NULL_DISPLAY,
  Text,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { Hazard } from "./hazardVerdict";
import { roundedHeight } from "./readouts";
import type { LandingModel } from "./useLandingModel";

type Model = Readonly<{ model: LandingModel }>;

function bannerTone(noLandingVector: boolean, hazard: Hazard | null): Tone {
  if (noLandingVector || hazard === "DIVERT") return "nogo";
  if (hazard === "MARGINAL") return "warn";
  if (hazard === "SAFE") return "go";
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

function sourceLabel(source: string | null | undefined): string | null {
  if (source === "predicted") return "predicted";
  if (source === "sub-vessel") return "sub-vessel (est.)";
  return null;
}

/** Biome, slope, downrange distance and where the sample came from, on one line. */
export function TerrainReadout({ model }: Model) {
  const { landing, landingReading, siteDrift } = model;
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
      {siteDrift != null
        ? ` · ${writeQuantity(
            roundedHeight(value("m", siteDrift.distanceMeters)),
            {
              decimals: 0,
            },
          )} downrange`
        : ""}
      {source ? ` · ${source}` : ""}
    </Text>
  );
}
