import type { IsruResourceFlow } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  ContainerBreak,
  NULL_DISPLAY,
  ReadoutCaption,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { rateDecimals } from "./rates";

/* The narrowest card that holds ElectricCharge beside a three-decimal rate and its direction. */
const STACK_BELOW_PX = 380;
const CARD_WIDTH_CONTAINER = { containerType: "inline-size" } as const;
const TABLE_BASE = {
  display: "grid",
  alignItems: "baseline",
  rowGap: "var(--gap-readout-row)",
  columnGap: "var(--gap-related)",
} as const;
const TABLE_STACKED = {
  ...TABLE_BASE,
  gridTemplateColumns: "auto auto",
  justifyContent: "space-between",
} as const;
const TABLE_ONE_LINE = {
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
  justifyContent: "normal",
} as const;
const NAME_ON_ITS_OWN_LINE = { gridColumn: "1 / -1" } as const;
const NAME_IN_ITS_COLUMN = { gridColumn: "auto" } as const;
const RIGHT_ALIGN = { textAlign: "right" } as const;
/** `Value` typography for a resource name, which wraps rather than being cut. */
const RESOURCE_NAME_STYLE = {
  fontSize: "var(--font-size-value)",
  color: "var(--color-text-primary)",
  overflowWrap: "anywhere",
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
      <ContainerBreak
        at={STACK_BELOW_PX}
        narrow={NAME_ON_ITS_OWN_LINE}
        wide={NAME_IN_ITS_COLUMN}
        style={RESOURCE_NAME_STYLE}
      >
        {flow.resource ?? "?"}
      </ContainerBreak>
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
 * A process's table of resources. On a card too narrow to hold a resource's full
 * name beside its rate, each rate and direction take the line below the name.
 */
export function ResourceTable({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div style={CARD_WIDTH_CONTAINER}>
      <ContainerBreak
        at={STACK_BELOW_PX}
        narrow={TABLE_STACKED}
        wide={TABLE_ONE_LINE}
      >
        {children}
      </ContainerBreak>
    </div>
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
