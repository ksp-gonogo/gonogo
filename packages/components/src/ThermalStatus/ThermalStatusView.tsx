import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  EmptyState,
  Meter,
  type MeterProps,
  NULL_DISPLAY,
  Panel,
  Section,
  Stack,
} from "@ksp-gonogo/ui-kit";
import { BAND_COLOR, BAND_LABEL, BAND_TONE, type Band } from "./bands";
import { Flux, Temp, TempOverMax } from "./readouts";
import {
  bandTagStyle,
  COMPACT_PILL_STYLE,
  CRITICAL_NOTE_STYLE,
  MAX_TAG_STYLE,
  PILL_ROW_STYLE,
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
  /** The inline note beside the pill, or `null` when none is shown. */
  alertNote: string | null;
  /** Each row is `null` when it is not drawn. */
  hottest: (MeterRow & { name: string | undefined }) | null;
  engine: MeterRow | null;
  shield: { tempK: number | undefined; fluxKw: number | undefined } | null;
}

export function ThermalStatusView({
  noData,
  worstBand,
  alertNote,
  hottest,
  engine,
  shield,
}: ThermalStatusViewProps) {
  const anyCritical = worstBand === "critical";
  return (
    <Panel
      panelTitle="THERMAL"
      sections={[
        noData && (
          <Section key="absence" full>
            <EmptyState>No thermal data</EmptyState>
          </Section>
        ),
        !noData && (
          <Section key="state" full>
            <div
              style={PILL_ROW_STYLE}
              role={anyCritical ? "alert" : "status"}
              aria-live={anyCritical ? "assertive" : "polite"}
            >
              <Badge
                tone={BAND_TONE[worstBand]}
                size="sm"
                style={COMPACT_PILL_STYLE}
              >
                {BAND_LABEL[worstBand]}
              </Badge>
              {alertNote !== null && (
                <span style={CRITICAL_NOTE_STYLE}>{alertNote}</span>
              )}
            </div>
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
  );
}
