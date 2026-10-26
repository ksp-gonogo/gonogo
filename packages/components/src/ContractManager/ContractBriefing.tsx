import { Disclosure, Pips } from "@ksp-gonogo/ui-kit";
import type { ContractEntry, ContractPrestige } from "./contracts";
import {
  BRIEFING_BODY_STYLE,
  NOTES_STYLE,
  REWARD_LABEL_STYLE,
  REWARD_STYLE,
  SYNOPSIS_STYLE,
} from "./styles";

const PIPS = {
  Trivial: 1,
  Significant: 2,
  Exceptional: 3,
} as const satisfies Record<ContractPrestige, number>;

/** The contract's difficulty on its own line: one to three filled pips out of three (KSP's own contract rating), or nothing when the wire carried none. */
export function ContractDifficulty({
  contract: c,
}: Readonly<{ contract: ContractEntry }>) {
  if (c.prestige === undefined) return null;
  const filled = PIPS[c.prestige];
  return (
    <div style={REWARD_STYLE}>
      <span style={REWARD_LABEL_STYLE}>DIFFICULTY</span>
      <Pips filled={filled} of={3} label="Difficulty" />
    </div>
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
