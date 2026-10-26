import { Unit } from "@ksp-gonogo/ui-kit";
import type { ContractEntry, ContractParameter } from "./contracts";
import {
  NOTES_STYLE,
  OPTIONAL_STYLE,
  PARAMETER_STYLE,
  PARAMETER_TITLE_STYLE,
  PARAMETERS_STYLE,
} from "./styles";

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
}: Readonly<{ parameter: ContractParameter }>) {
  const goal = goalOf(p);
  return (
    <li style={PARAMETER_STYLE}>
      <span style={PARAMETER_TITLE_STYLE}>
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
                </>
              )}
            </span>
          )}
        </span>
      </span>
      {p.notes && <div style={NOTES_STYLE}>{p.notes}</div>}
      {p.children.length > 0 && (
        <ObjectiveList parameters={p.children} nested />
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
  nested = false,
}: Readonly<{
  parameters: ContractParameter[];
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
        <ObjectiveRow key={key} parameter={parameter} />
      ))}
    </ul>
  );
}

/**
 * A contract's objectives, listed as plain items with their notes, the objectives nested under
 * them and a milestone's goal and target altitude. It draws no per-objective state: the
 * Objectives widget tracks which goals are met.
 */
export function ContractTerms({
  contract: c,
}: Readonly<{ contract: ContractEntry }>) {
  if (c.parameters.length === 0) return null;
  return <ObjectiveList parameters={c.parameters} />;
}
