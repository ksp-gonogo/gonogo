import type { ParsedManeuverNode } from "@ksp-gonogo/data";
import type { CarriedCurrency } from "@ksp-gonogo/sitrep-sdk";
import { Section, Stack } from "@ksp-gonogo/ui-kit";
import { BurnWindowRows } from "./BurnWindowRows";

interface BurnWindowsSectionProps {
  nodes: readonly ParsedManeuverNode[];
  currentUT: number | undefined;
  from?: readonly CarriedCurrency[];
}

/**
 * The three instants of each queued burn, off the same `nodes` list the node
 * section renders, so the two cannot disagree. Its own section, since three
 * rows and an axis per burn do not fit inside a node row.
 */
export function BurnWindowsSection({
  nodes,
  currentUT,
  from,
}: BurnWindowsSectionProps) {
  if (nodes.length === 0) return null;
  return (
    <Section title="Burn windows">
      <Stack>
        {nodes.map((burn) => (
          <BurnWindowRows
            // UT survives KSP renumbering the list on a removal; an index does not.
            key={burn.UT}
            burn={{
              ut: burn.UT,
              ignitionUt: burn.ignitionUt,
              cutoffUt: burn.cutoffUt,
            }}
            nowUt={currentUT ?? 0}
            from={from}
          />
        ))}
      </Stack>
    </Section>
  );
}
