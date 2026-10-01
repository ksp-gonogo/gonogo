import type { ContractEntry } from "./contracts";
import { OPTIONAL_STYLE, PARAMETER_STYLE, PARAMETERS_STYLE } from "./styles";

/** A contract's objectives as its terms: what it asks for, not how far along it is. */
export function ContractTerms({
  contract: c,
}: Readonly<{ contract: ContractEntry }>) {
  if (c.parameters.length === 0) return null;
  return (
    <ul style={PARAMETERS_STYLE}>
      {c.parameters.map((p) => (
        <li key={`${c.id}-${p.title}`} style={PARAMETER_STYLE}>
          {p.title}
          {p.optional && <span style={OPTIONAL_STYLE}> (optional)</span>}
        </li>
      ))}
    </ul>
  );
}
