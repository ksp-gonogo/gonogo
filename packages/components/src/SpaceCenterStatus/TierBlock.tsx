import { NULL_DISPLAY, Row, Stack } from "@ksp-gonogo/ui-kit";
import type { FacilityLevel } from "./facilities";
import { parseLevelText } from "./levelText";
import {
  TIER_SPEC_LIST,
  TierBlock__Absent,
  TierBlock__Heading,
  TierBlock__Label,
  TierBlock__Root,
  TierBlock__Value,
} from "./styles";

/**
 * One tier's description as a list. The value stays a string: "140t" and
 * "Unlimited" are both legitimate settings of the same property.
 */
export function TierBlock({
  heading,
  text,
}: {
  heading: string;
  text: string;
}) {
  const specs = parseLevelText(text);
  return (
    <TierBlock__Root>
      <TierBlock__Heading>{heading}</TierBlock__Heading>
      {specs.length === 0 ? (
        <TierBlock__Absent>{NULL_DISPLAY}</TierBlock__Absent>
      ) : (
        <Stack as="ul" style={TIER_SPEC_LIST}>
          {specs.map((spec) =>
            spec.kind === "pair" ? (
              <Row key={spec.id}>
                <TierBlock__Label>{spec.label}</TierBlock__Label>
                <TierBlock__Value size="xs">{spec.value}</TierBlock__Value>
              </Row>
            ) : (
              <Row key={spec.id}>
                <TierBlock__Value size="xs">{spec.text}</TierBlock__Value>
              </Row>
            ),
          )}
        </Stack>
      )}
    </TierBlock__Root>
  );
}

/** The current-tier text and next-tier preview, for the cell's native `title` tooltip. */
export function buildFacilityTooltip(label: string, f?: FacilityLevel): string {
  if (!f) return label;
  if (!f.currentLevelText && !f.nextLevelText) {
    return `${label} (no level descriptions on this telemetry)`;
  }
  const parts: string[] = [`${label}: tier ${f.level + 1} of ${f.max + 1}`];
  if (f.currentLevelText) {
    parts.push("", "NOW", plainTierSpecs(f.currentLevelText));
  }
  if (f.nextLevelText) {
    parts.push("", "NEXT", plainTierSpecs(f.nextLevelText));
  }
  return parts.join("\n");
}

/** The cell's tier lines flattened for a `title` attribute; a pair keeps its colon. */
export function plainTierSpecs(text: string): string {
  return parseLevelText(text)
    .map((spec) =>
      spec.kind === "pair" ? `${spec.label}: ${spec.value}` : spec.text,
    )
    .join("\n");
}
