import { Grid, Section, SectionTitle, Text } from "@ksp-gonogo/ui-kit";
import { GridCellPair, Metres, Mps } from "./readouts";
import type { LandingModel } from "./useLandingModel";

type Model = Readonly<{ model: LandingModel }>;

/** The solve's velocity split; the atmospheric-estimate board carries its own, and this never depends on a plot restating it. */
export function VelocitySection({ model }: Model) {
  const { board, solution } = model;
  if (board === "atmospheric-estimate" || solution.horizontalSpeed == null) {
    return null;
  }
  return (
    <Section>
      <SectionTitle>Velocity</SectionTitle>
      <Grid cols="auto 1fr" gap="readout-row">
        <GridCellPair label="Vertical">
          {<Mps v={solution.verticalSpeed} />}
        </GridCellPair>
        <GridCellPair label="Horizontal">
          {<Mps v={solution.horizontalSpeed} />}
        </GridCellPair>
      </Grid>
    </Section>
  );
}

/** Plain AGL, for a width with no altitude rail. */
export function HeightSection({ model }: Model) {
  return (
    <Section>
      <SectionTitle>Height</SectionTitle>
      <Grid cols="auto 1fr" gap="readout-row">
        <GridCellPair label="AGL">
          {<Metres m={model.heightFromTerrain} />}
        </GridCellPair>
      </Grid>
    </Section>
  );
}

export function DivertSection({ model }: Model) {
  const { landed, noLandingVector, targetRange } = model;
  if (landed || noLandingVector || targetRange === undefined) return null;
  return (
    <Section>
      <SectionTitle>Divert</SectionTitle>
      <Grid cols="auto 1fr" gap="readout-row">
        <GridCellPair label="Target range">
          {<Metres m={targetRange} />}
        </GridCellPair>
      </Grid>
    </Section>
  );
}

export function ComDatumNote({ model }: Model) {
  if (!model.usingComDatum) return null;
  return (
    <Text tone="muted" size="xs">
      root-part altitude (lowest-point datum unavailable)
    </Text>
  );
}
