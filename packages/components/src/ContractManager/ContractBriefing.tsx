import { Badge, Disclosure, Tooltip } from "@ksp-gonogo/ui-kit";
import type { ContractEntry, ContractPrestige } from "./contracts";
import { BRIEFING_BODY_STYLE, NOTES_STYLE, SYNOPSIS_STYLE } from "./styles";

const PRESTIGE_TONE = {
  Trivial: "neutral",
  Significant: "caution",
  Exceptional: "go",
} as const satisfies Record<ContractPrestige, string>;

/** The contract's difficulty tier as a small chip, or nothing when the wire carried none. */
export function ContractPrestigeBadge({
  contract: c,
}: Readonly<{ contract: ContractEntry }>) {
  if (c.prestige === undefined) return null;
  return (
    <Tooltip text="Contract prestige">
      <Badge tone={PRESTIGE_TONE[c.prestige]} size="sm">
        {c.prestige}
      </Badge>
    </Tooltip>
  );
}

/** What the contract asks in one line, with its full briefing and notes a click away. */
export function ContractBriefing({
  contract: c,
}: Readonly<{ contract: ContractEntry }>) {
  const hasMore = c.briefing !== undefined || c.notes !== undefined;
  return (
    <>
      {c.synopsis && <div style={SYNOPSIS_STYLE}>{c.synopsis}</div>}
      {hasMore && (
        <Disclosure variant="inline" label="Briefing">
          {c.briefing && <div style={BRIEFING_BODY_STYLE}>{c.briefing}</div>}
          {c.notes && <div style={NOTES_STYLE}>{c.notes}</div>}
        </Disclosure>
      )}
    </>
  );
}
