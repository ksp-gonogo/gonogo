import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { Badge, Unit } from "@ksp-gonogo/ui-kit";
import type { ContractEntry, ContractParameter } from "./contracts";
import {
  NOTES_STYLE,
  OPTIONAL_STYLE,
  PARAMETER_STYLE,
  PARAMETER_TITLE_STYLE,
  PARAMETERS_STYLE,
} from "./styles";

const STATE_BADGE = {
  Complete: { tone: "go", label: "Done" },
  Failed: { tone: "nogo", label: "Failed" },
  Incomplete: { tone: "neutral", label: "Open" },
  Unknown: { tone: "neutral", label: "Unknown" },
} as const;

/** What a milestone objective asks for, in words the operator reads: "Reach space at Kerbin". */
function goalOf(p: ContractParameter): string | null {
  if (p.milestone === undefined) return null;
  const where = p.milestoneBody === undefined ? "" : ` at ${p.milestoneBody}`;
  return p.milestone === "REACHSPACE"
    ? `Reach space${where}`
    : `Reach ${p.milestone.toLowerCase()}${where}`;
}

function ObjectiveRow({
  parameter: p,
  altitude,
}: Readonly<{
  parameter: ContractParameter;
  altitude?: Value<"m"> | null;
}>) {
  const badge = STATE_BADGE[p.state];
  const goal = goalOf(p);
  return (
    <li style={PARAMETER_STYLE}>
      <span style={PARAMETER_TITLE_STYLE}>
        <Badge tone={badge.tone} size="sm">
          {badge.label}
        </Badge>
        <span>
          {p.title}
          {p.optional && <span style={OPTIONAL_STYLE}> (optional)</span>}
          {goal !== null && (
            <span data-contract-goal>
              {" · "}
              {goal}
              {p.targetAltitude !== undefined && (
                <>
                  {": "}
                  <Unit value={p.targetAltitude} />
                  {altitude != null && p.state === "Incomplete" && (
                    <>
                      {" · now "}
                      <Unit value={altitude} />
                    </>
                  )}
                </>
              )}
            </span>
          )}
        </span>
      </span>
      {p.notes && <div style={NOTES_STYLE}>{p.notes}</div>}
      {p.children.length > 0 && (
        <ObjectiveList parameters={p.children} altitude={altitude} nested />
      )}
    </li>
  );
}

/** A contract can carry two objectives with the same title, so the key counts occurrences. */
function keyed(parameters: ContractParameter[]) {
  const seen = new Map<string, number>();
  return parameters.map((p) => {
    const occurrence = seen.get(p.title) ?? 0;
    seen.set(p.title, occurrence + 1);
    return { key: `${p.title}::${occurrence}`, parameter: p };
  });
}

function ObjectiveList({
  parameters,
  altitude,
  nested = false,
}: Readonly<{
  parameters: ContractParameter[];
  altitude?: Value<"m"> | null;
  nested?: boolean;
}>) {
  return (
    <ul
      style={{
        ...PARAMETERS_STYLE,
        ...(nested ? { marginLeft: "1.5ch" } : {}),
      }}
    >
      {keyed(parameters).map(({ key, parameter }) => (
        <ObjectiveRow key={key} parameter={parameter} altitude={altitude} />
      ))}
    </ul>
  );
}

/**
 * A contract's objectives as its terms: each with its live state, its notes and the objectives
 * nested under it, plus a milestone's target and, for an accepted contract, how far the active
 * vessel is from it.
 */
export function ContractTerms({
  contract: c,
  altitude,
}: Readonly<{
  contract: ContractEntry;
  /** The active vessel's altitude above sea level; null when none is known. Only an accepted contract is measured against it. */
  altitude?: Value<"m"> | null;
}>) {
  if (c.parameters.length === 0) return null;
  return <ObjectiveList parameters={c.parameters} altitude={altitude} />;
}
