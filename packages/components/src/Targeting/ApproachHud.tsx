import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  Grid,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { DISPLAY_VALUE_STYLE, DisplayDash } from "./TargetingView";

interface ApproachHudProps {
  name: string;
  distance: number | undefined;
  relVel: number | undefined;
  /** Time to closest approach, with the target model's figure beside it where one reaches past the received edge. */
  timeToClosestApproach: Reading<Value<"s">>;
  /** A pairing is selected but its geometry is held, so the alignment is not drawn. */
  alignmentWithheld?: boolean;
  cols: number;
  rows: number;
}

/** A `label` / `value` pair for the approach + docking-HUD readout grids. */
function ReadoutRow({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "ok" | "warn";
  children: ReactNode;
}) {
  return (
    <>
      <ReadoutCaption
        style={{
          alignSelf: "baseline",
          whiteSpace: "nowrap",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </ReadoutCaption>
      <Text
        size="lg"
        tone={tone === "ok" ? "go" : undefined}
        style={{
          fontWeight: 600,
          whiteSpace: "nowrap",
          color: tone === "warn" ? "var(--color-warn-mark)" : undefined,
        }}
      >
        {children}
      </Text>
    </>
  );
}

function closingTone(
  closingMagnitude: number | null,
  closing: boolean,
): "ok" | "warn" | undefined {
  if (closingMagnitude === null) return undefined;
  return closing ? "ok" : "warn";
}

/** Why the docking HUD is not on screen while a pairing is still selected. */
function AlignmentWithheldNotice() {
  return (
    <ReadoutCaption role="status">Docking alignment withheld</ReadoutCaption>
  );
}

/**
 * Approach mode, between long-range tracking and the docking HUD: the
 * 100 m-5 km band, where closing rate and time to closest approach matter.
 * `relVel` is positive when opening, negative when closing.
 */
export function ApproachHud({
  name,
  distance,
  relVel,
  timeToClosestApproach,
  alignmentWithheld,
  cols,
  rows,
}: ApproachHudProps) {
  // Below 6 cols the paired grid clips values, so labels stack above them.
  const stack = cols < 6;
  const closing = relVel !== undefined && Number.isFinite(relVel) && relVel < 0;
  const closingMagnitude =
    relVel !== undefined && Number.isFinite(relVel) ? Math.abs(relVel) : null;

  // The smallest size cannot fit the stacked grid: distance is the headline and closing rate a subreadout; TCA is cut.
  if (rows < 5) {
    return (
      <Panel
        panelTitle="APPROACH"
        /* Panel measures before it centres, so an overflowing readout still starts at the top. */
        fitToSize
        sections={
          <Section full gap="related-dense">
            <Text size="sm" style={{ letterSpacing: "0.05em" }}>
              {name}
            </Text>
            {distance === undefined ? (
              <DisplayDash />
            ) : (
              <Text tone="go" style={DISPLAY_VALUE_STYLE}>
                <Unit value={value("m", distance)} />
              </Text>
            )}
            {closingMagnitude !== null && (
              <Text
                size="xs"
                level="muted"
                style={{
                  marginTop: "var(--gap-sub-readout)",
                  letterSpacing: "0.04em",
                }}
              >
                {closing ? "−" : "+"}
                <Unit value={value("m/s", closingMagnitude)} decimals={1} />
              </Text>
            )}
            {alignmentWithheld && <AlignmentWithheldNotice />}
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="APPROACH"
      sections={[
        <Section key="target" full>
          <Text size="sm" style={{ letterSpacing: "0.05em" }}>
            {name}
          </Text>
        </Section>,
        <Section key="approach" full>
          <Grid
            cols={stack ? "1fr" : "auto 1fr"}
            gap="section-compact"
            style={{
              marginTop: "var(--gap-related-compact)",
              rowGap: stack ? "0" : "var(--gap-row-wrap)",
            }}
          >
            <ReadoutRow label="Distance">
              {distance === undefined ? (
                NULL_DISPLAY
              ) : (
                <Unit value={value("m", distance)} />
              )}
            </ReadoutRow>

            <ReadoutRow
              label="Closing rate"
              tone={closingTone(closingMagnitude, closing)}
            >
              {closingMagnitude === null ? (
                NULL_DISPLAY
              ) : (
                <>
                  {closing ? "−" : "+"}
                  <Unit value={value("m/s", closingMagnitude)} decimals={1} />
                </>
              )}
            </ReadoutRow>

            <ReadoutRow label="TCA">
              {timeToClosestApproach.value === undefined ? (
                NULL_DISPLAY
              ) : (
                <Countdown value={timeToClosestApproach} clock precise />
              )}
            </ReadoutRow>
          </Grid>
          {alignmentWithheld && <AlignmentWithheldNotice />}
        </Section>,
      ]}
    />
  );
}
