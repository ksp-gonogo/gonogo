import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";
import type { ContractEntry, ContractParameter } from "./contracts";
import { OPTIONAL_STYLE, PARAMETER_STYLE, PARAMETERS_STYLE } from "./styles";

/** What a milestone objective asks for, in words the operator reads: "Reach space at Kerbin". */
function goalOf(p: ContractParameter): string | null {
  if (p.milestone === undefined) return null;
  const where = p.milestoneBody === undefined ? "" : ` at ${p.milestoneBody}`;
  return p.milestone === "REACHSPACE"
    ? `Reach space${where}`
    : `Reach ${p.milestone.toLowerCase()}${where}`;
}

/**
 * A contract's objectives as its terms: what each asks for, its target where it has one, and for an
 * accepted contract how far the active vessel is from it.
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
  return (
    <ul style={PARAMETERS_STYLE}>
      {c.parameters.map((p) => {
        const goal = goalOf(p);
        return (
          <li key={`${c.id}-${p.title}`} style={PARAMETER_STYLE}>
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
          </li>
        );
      })}
    </ul>
  );
}
