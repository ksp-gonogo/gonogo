import type { IsruResourceFlow } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  NULL_DISPLAY,
  ReadoutCaption,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { rateDecimals } from "./rates";

/** Resource | rate | flow-direction, shared by every process card's table. */
export const RESOURCE_TABLE_COLS = "minmax(0, 1fr) auto auto";
const RIGHT_ALIGN = { textAlign: "right" } as const;
/** `Value` typography for `Truncate`, which a long resource name needs to ellipsize inside a grid cell. */
const RESOURCE_NAME_STYLE = {
  fontSize: "var(--font-size-value)",
  color: "var(--color-text-primary)",
} as const;

/** A figure withheld because its channel is held, drawn apart from one that never arrived. */
export function WithheldOr({
  withheld,
  figure,
}: Readonly<{ withheld: boolean; figure: ReactNode | null }>) {
  if (withheld) return <Text level="muted">{NULL_DISPLAY}</Text>;
  if (figure === null) return <Text level="faint">unknown</Text>;
  return figure;
}

/**
 * One row of a process's resource table: resource name, rate, and direction.
 * Returns three flat cells, not a row wrapper, so the enclosing `Grid` aligns
 * columns across every row in the card.
 */
export function ResourceCells({
  flow,
  direction,
  ratesHeld,
}: Readonly<{
  flow: IsruResourceFlow;
  direction: "in" | "out" | "extract";
  /** Held rather than never arrived: the cell reads as held back, not "unknown". */
  ratesHeld: boolean;
}>) {
  return (
    <>
      <Truncate style={RESOURCE_NAME_STYLE} title={flow.resource ?? undefined}>
        {flow.resource ?? "?"}
      </Truncate>
      <Text size="sm" style={RIGHT_ALIGN}>
        <WithheldOr
          withheld={ratesHeld}
          figure={
            flow.rate === null || flow.rate === undefined ? null : (
              <Unit value={flow.rate} decimals={rateDecimals(flow.rate, 3)} />
            )
          }
        />
      </Text>
      <ReadoutCaption style={RIGHT_ALIGN}>{direction}</ReadoutCaption>
    </>
  );
}

/**
 * The run-state chip for a rig whose channel is current. An unread flag is not
 * "stopped": the operator reads "stopped" as a rig they can start.
 */
export function RunStateBadge({
  running,
}: Readonly<{ running?: boolean | null }>) {
  if (running === null || running === undefined) {
    return <Badge tone="warn">run state unread</Badge>;
  }
  return (
    <Badge tone={running ? "go" : "info"}>
      {running ? "running" : "stopped"}
    </Badge>
  );
}
