import {
  Countdown,
  Grid,
  NULL_DISPLAY,
  Section,
  SectionTitle,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { GridCellPair, Mps } from "./readouts";
import type { LandingModel } from "./useLandingModel";

/** Air thin enough that the descent is effectively vacuum, so the readout says so rather than quoting zeroes. */
const NEGLIGIBLE_DENSITY = 0.001; // kg/m³, the base unit a bare operand takes

function airDensity({ flight, flightReading }: LandingModel): ReactNode {
  if (flight?.atmDensity == null || !flight.atmDensity.isFinite()) {
    return NULL_DISPLAY;
  }
  if (flight.atmDensity.lessThan(NEGLIGIBLE_DENSITY)) return "negligible";
  return <Unit value={flightReading.atmDensity} decimals={3} />;
}

/** The atmospheric and unsolved boards; a vacuum solve reads from `SolutionReadouts` instead. */
export function DescentBoard({ model }: Readonly<{ model: LandingModel }>) {
  const { board, landing, landingReading, flight, solution } = model;

  if (board === "atmospheric-aware") {
    return (
      <Section>
        <SectionTitle>Atmospheric descent (estimate)</SectionTitle>
        <Grid cols="auto 1fr" gap="readout-row">
          <GridCellPair label="Terminal">
            {<Mps v={landing?.terminalVelocity} />}
          </GridCellPair>
          <GridCellPair label="Touchdown">
            {<Mps v={landing?.projectedTouchdownSpeed} />}
          </GridCellPair>
          <GridCellPair label="Impact in">
            {landing?.atmosphericTimeToImpact == null ? (
              NULL_DISPLAY
            ) : (
              <Countdown
                value={landingReading.atmosphericTimeToImpact}
                precise
              />
            )}
          </GridCellPair>
          {landing?.descentRegime && (
            <GridCellPair label="Regime">{landing.descentRegime}</GridCellPair>
          )}
        </Grid>
        <Text tone="muted" size="xs">
          est · current config
          {landing?.parachuteState === "armed" ? " · excludes chute" : ""}
        </Text>
      </Section>
    );
  }

  // In atmosphere with no terminal velocity yet: show velocity, air density and that drag is still building, labelled as an estimate.
  if (board === "atmospheric-estimate") {
    return (
      <Section>
        <SectionTitle>Atmospheric descent (estimate)</SectionTitle>
        <Grid cols="auto 1fr" gap="readout-row">
          <GridCellPair label="Vertical">
            {<Mps v={solution.verticalSpeed} />}
          </GridCellPair>
          <GridCellPair label="Horizontal">
            {<Mps v={solution.horizontalSpeed} />}
          </GridCellPair>
          <GridCellPair label="Air density">{airDensity(model)}</GridCellPair>
        </Grid>
        <Text tone="muted" size="xs">
          {flight?.atmDensity?.lessThan(NEGLIGIBLE_DENSITY)
            ? "negligible drag · near free-fall, terminal velocity resolves as air thickens"
            : "above terminal · drag building, terminal velocity resolves as descent continues"}
        </Text>
      </Section>
    );
  }

  if (board === "atmospheric-unmodelled") {
    return (
      <Section>
        <Text tone="muted" size="xs">
          descent in atmosphere · no terrain model (no body data)
        </Text>
      </Section>
    );
  }

  if (board === "no-solution") {
    return (
      <Section>
        <Text tone="muted">no solution · no body data</Text>
      </Section>
    );
  }

  return null;
}
