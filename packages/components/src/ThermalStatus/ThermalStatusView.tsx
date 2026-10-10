import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  EmptyState,
  Meter,
  type MeterProps,
  NULL_DISPLAY,
  Panel,
  Section,
  Stack,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import { BAND_COLOR, BAND_LABEL, type Band, bandBadge } from "./bands";
import { Flux, Temp, TempOverMax } from "./readouts";
import {
  bandTagStyle,
  MAX_TAG_STYLE,
  READOUT_GROUPS_STYLE,
  ROW_BODY_STYLE,
  ROW_HEADER_STYLE,
  ROW_LABEL_STYLE,
  TEMP_READOUT_STYLE,
  TEMP_VALUE_STYLE,
} from "./styles";

type KelvinReading = Reading<Value<"K">> | undefined;

export interface MeterRow {
  band: Band;
  ratio: MeterProps["value"];
  temp: KelvinReading;
  max: KelvinReading;
}

export interface ThermalStatusViewProps {
  noData: boolean;
  worstBand: Band;
  /** Each row is `null` when it is not drawn. */
  hottest: (MeterRow & { name: string | undefined }) | null;
  engine: MeterRow | null;
  shield: { tempK: number | undefined; fluxKw: number | undefined } | null;
}

export function ThermalStatusView({
  noData,
  worstBand,
  hottest,
  engine,
  shield,
}: ThermalStatusViewProps) {
  const badge = bandBadge(worstBand);
  return (
    <>
      {worstBand === "critical" && !noData && (
        <VisuallyHidden role="alert" aria-live="assertive">
          Thermal critical
        </VisuallyHidden>
      )}
      <Panel
        panelTitle="THERMAL"
        panelBadges={[badge]}
        sections={[
          noData && (
            <Section key="absence" full>
              <EmptyState>No thermal data</EmptyState>
            </Section>
          ),
          /* No ScrollArea here: Panel's body is already the scroller. */
          !noData && (hottest || engine || shield) && (
            <Section key="rows" full>
              <Stack style={READOUT_GROUPS_STYLE}>
                {hottest && (
                  <Section>
                    <div style={ROW_HEADER_STYLE}>
                      <div style={ROW_LABEL_STYLE}>Hottest part</div>
                      <span style={bandTagStyle(hottest.band)}>
                        {BAND_LABEL[hottest.band]}
                      </span>
                    </div>
                    <Meter
                      label={hottest.name ?? NULL_DISPLAY}
                      value={hottest.ratio}
                      fillColor={BAND_COLOR[hottest.band]}
                      valueLabelNode={
                        <TempOverMax temp={hottest.temp} max={hottest.max} />
                      }
                    />
                  </Section>
                )}

                {engine && (
                  <Section>
                    <div style={ROW_HEADER_STYLE}>
                      <div style={ROW_LABEL_STYLE}>Hottest engine</div>
                      <span style={bandTagStyle(engine.band)}>
                        {BAND_LABEL[engine.band]}
                      </span>
                    </div>
                    <Meter
                      label="Temperature"
                      value={engine.ratio}
                      fillColor={BAND_COLOR[engine.band]}
                      valueLabelNode={
                        <TempOverMax temp={engine.temp} max={engine.max} />
                      }
                    />
                  </Section>
                )}

                {shield && (
                  <Section>
                    <div style={ROW_LABEL_STYLE}>Heat shield</div>
                    <div style={ROW_BODY_STYLE}>
                      <div style={TEMP_READOUT_STYLE}>
                        <span style={TEMP_VALUE_STYLE}>
                          <Temp kelvin={shield.tempK} />
                        </span>
                        <span style={MAX_TAG_STYLE}>
                          · flux <Flux kw={shield.fluxKw} />
                        </span>
                      </div>
                    </div>
                  </Section>
                )}
              </Stack>
            </Section>
          ),
        ]}
      />
    </>
  );
}
