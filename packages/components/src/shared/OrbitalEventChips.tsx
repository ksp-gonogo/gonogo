import { formatDuration } from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import styled from "styled-components";

/**
 * Vessel-wide orbital event chips: an SOI encounter / escape and the next
 * apsis. Reads `o.encounterExists / encounterBody / encounterTime` and
 * `o.nextApsisType / timeToNextApsis`. Renders nothing when neither has data.
 *
 * `o.encounterExists` is the gate: -1 = escape (leaving current SOI),
 * 0 = none, 1 = encounter (entering another body's SOI). The body / time
 * fields only carry meaningful values when this is non-zero.
 *
 * `o.nextApsisType`: -1 = Pe, 1 = Ap, 0 = N/A (hyperbolic past Pe).
 */
export function OrbitalEventChips() {
  const vesselState = useStream<VesselState>("vessel.state");
  const enc = vesselState?.encounterExists;
  const encBody = vesselState?.encounterBody;
  const encTime = vesselState?.encounterTime;
  const apsisType = vesselState?.nextApsisType;
  const timeToApsis = vesselState?.timeToNextApsis;

  const encounterKind: "encounter" | "escape" | null =
    typeof enc === "number" && enc === 1
      ? "encounter"
      : typeof enc === "number" && enc === -1
        ? "escape"
        : null;
  const hasEncounter =
    encounterKind !== null &&
    typeof encBody === "string" &&
    encBody.length > 0 &&
    typeof encTime === "number" &&
    Number.isFinite(encTime) &&
    encTime > 0;

  const hasApsis =
    typeof apsisType === "number" &&
    apsisType !== 0 &&
    typeof timeToApsis === "number" &&
    Number.isFinite(timeToApsis) &&
    timeToApsis >= 0;

  if (!hasEncounter && !hasApsis) return null;

  return (
    <Row>
      {hasEncounter && (
        <Chip $variant={encounterKind === "escape" ? "warn" : "go"}>
          <ChipLabel>{encounterKind === "escape" ? "ESCAPE" : "ENC"}</ChipLabel>
          <ChipValue>
            {encBody as string} · {formatDuration(encTime as number)}
          </ChipValue>
        </Chip>
      )}
      {hasApsis && (
        <Chip $variant="neutral">
          <ChipLabel>NEXT</ChipLabel>
          <ChipValue>
            {apsisType === -1 ? "Pe" : "Ap"} ·{" "}
            {formatDuration(timeToApsis as number)}
          </ChipValue>
        </Chip>
      )}
    </Row>
  );
}

const Row = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;

const Chip = styled.div<{ $variant: "go" | "warn" | "neutral" }>`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid
    ${({ $variant }) =>
      $variant === "go"
        ? "var(--color-status-go-bg)"
        : $variant === "warn"
          ? "var(--color-status-warning-bg)"
          : "var(--color-surface-raised)"};
  background: ${({ $variant }) =>
    $variant === "go"
      ? "var(--color-status-go-bg)"
      : $variant === "warn"
        ? "var(--color-status-warning-bg)"
        : "transparent"};
  color: ${({ $variant }) =>
    $variant === "go"
      ? "var(--color-status-go-fg)"
      : $variant === "warn"
        ? "var(--color-status-warning-fg)"
        : "var(--color-text-primary)"};
  font-size: 10px;
  letter-spacing: 0.04em;
`;

const ChipLabel = styled.span`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  flex-shrink: 0;
`;

const ChipValue = styled.span`
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;
