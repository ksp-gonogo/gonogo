import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type { TargetingReading } from "./useTargetingReading";

/** The panel chrome shared by every branch, so the badges slot and title cannot drift. */
export function TargetPanel({ children }: { children: ReactNode }) {
  return (
    <Panel panelTitle="TARGET" sections={<Section full>{children}</Section>} />
  );
}

// Display tier above the type scale; DisplayDash must stay equal to this.
export const DISPLAY_VALUE_STYLE = {
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: "0.02em",
  lineHeight: "var(--line-height-tight)",
} as const;

/** Same display tier as the value it stands in for, shown while a distance has not arrived. */
export function DisplayDash() {
  return (
    <span
      style={{
        fontSize: 22,
        fontWeight: 600,
        color: "var(--color-border-strong)",
      }}
    >
      {NULL_DISPLAY}
    </span>
  );
}

interface TrackingViewProps {
  name: string;
  distance: number | undefined;
  rangeR: TargetingReading["rangeR"];
  closingRateR: TargetingReading["closingRateR"];
  age: TargetingReading["age"];
  outOfContact: boolean;
  reckoned: TargetingReading["reckoned"];
  reckonedDistance: number | undefined;
  showTargetName: boolean;
  showSubReadout: boolean;
}

/** Long-range tracking: name, range and (once close enough to matter) closing rate. */
export function TrackingView({
  name,
  distance,
  rangeR,
  closingRateR,
  age,
  outOfContact,
  reckoned,
  reckonedDistance,
  showTargetName,
  showSubReadout,
}: TrackingViewProps) {
  return (
    <TargetPanel>
      <Stack style={{ flex: 1, justifyContent: "center", minHeight: 0 }}>
        {showTargetName && (
          <Text tone="default" size="sm" style={{ letterSpacing: "0.05em" }}>
            {name}
          </Text>
        )}
        {distance === undefined ? (
          <DisplayDash />
        ) : (
          <Text
            tone={outOfContact ? "muted" : "accent"}
            style={DISPLAY_VALUE_STYLE}
          >
            <Unit value={rangeR} />
          </Text>
        )}
        {/* The caveat sits on the value, and only out of contact: under light-time delay every value is old. */}
        {outOfContact && (
          <ReadoutCaption role="status">
            at last contact
            {age !== undefined && (
              <>
                , <Unit value={age} /> ago
              </>
            )}
          </ReadoutCaption>
        )}
        {reckoned !== undefined && reckonedDistance !== undefined && (
          <ReadoutCaption>
            reckoned <Unit value={value("m", reckonedDistance)} /> (
            {reckoned.basis})
          </ReadoutCaption>
        )}
        {showSubReadout && (
          <Text
            size="xs"
            tone="muted"
            style={{
              marginTop: "var(--gap-sub-readout)",
              letterSpacing: "0.04em",
            }}
          >
            Δv <Unit value={closingRateR} decimals={2} />
          </Text>
        )}
      </Stack>
    </TargetPanel>
  );
}
