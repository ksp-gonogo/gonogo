import { useCommand } from "@ksp-gonogo/sitrep-client";
import type { CrewMember } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  CommandButton,
  GhostButton,
  SelectableRow,
  Stack,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { type CostLine, carriedOf, mayAct, verbFor } from "./repair";

/** Why the repair would be refused, stated before sending it, or null when nothing known stands in the way. */
function refusalFor(
  eligibleCount: number,
  requirement: string | null,
  short: { needed: number; label: string; reachable: number } | undefined,
): string | null {
  if (eligibleCount === 0 && requirement) {
    return `Needs ${requirement}, and nobody aboard qualifies`;
  }
  if (eligibleCount === 0) return "Nobody is aboard to do it";
  if (short) {
    return `Needs ${short.needed} ${short.label}, and ${short.reachable} can be reached`;
  }
  return null;
}

/**
 * The action for one part: repair a failure, or clear a service. Collapsed
 * until asked, so a row does not become a form. Every known refusal is shown on
 * a disabled control, since under delay each costs a round trip. The cost sits
 * beside the control and is the provider's own `repairCost`; an empty cost is
 * not a cost of zero, so it draws no ledger and gates nothing.
 */
export function RepairControl({
  partId,
  condition,
  repairTrait,
  repairLevel,
  crew,
  cost,
}: {
  partId: string;
  condition: string | null | undefined;
  repairTrait: string | null | undefined;
  repairLevel: number | null | undefined;
  crew: CrewMember[];
  cost: CostLine[];
}) {
  const repair = useCommand("vessel.repair");
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  const verb = verbFor(condition);

  // Default to whoever can act with NO fetch, ranked on the first stated item; with no cost stated, roster order stands.
  const rankOn = cost[0]?.name;
  const eligible = crew.filter((c) => mayAct(c, repairTrait, repairLevel));
  const readiest = rankOn
    ? eligible
        .slice()
        .sort((a, b) => carriedOf(b, rankOn) - carriedOf(a, rankOn))[0]
    : eligible[0];
  const performer = chosen ?? readiest?.name ?? null;
  const acting = eligible.find((c) => c.name === performer);

  /** Per stated item: what this performer could reach without another trip. */
  const lines = cost.map((line) => {
    const held = acting ? carriedOf(acting, line.name) : 0;
    return { ...line, carried: held, reachable: held + line.reserve };
  });
  const short = lines.find((line) => line.reachable < line.needed);

  const requirement = repairTrait
    ? `${repairTrait}${repairLevel != null ? ` level ${repairLevel}` : ""}`
    : null;
  const refusal = refusalFor(eligible.length, requirement, short);

  if (!open) {
    return (
      <Cluster justify="start">
        <GhostButton onClick={() => setOpen(true)}>{verb}</GhostButton>
      </Cluster>
    );
  }

  return (
    <Stack>
      {lines.map((line) => (
        <span key={line.name}>
          {`${line.needed} ${line.label} · ${line.carried} carried · ${line.reserve} aboard`}
        </span>
      ))}
      {eligible.map((member) => (
        <SelectableRow
          key={member.name ?? "unknown"}
          selected={member.name === performer}
          onClick={() => setChosen(member.name ?? null)}
        >
          {rankOn
            ? `${member.name ?? "Unknown"} · ${carriedOf(member, rankOn)} carried`
            : (member.name ?? "Unknown")}
        </SelectableRow>
      ))}
      {refusal && <span>{refusal}</span>}
      <CommandButton
        handle={repair}
        args={{ partId, crewName: performer ?? "" }}
        size="sm"
        commandLabel={`${verb} with ${performer ?? "nobody"}`}
        label={verb}
        confirmLabel="Confirm"
        pendingLabel={`${verb}...`}
        disabled={refusal !== null}
        title={refusal ?? undefined}
      />
    </Stack>
  );
}
