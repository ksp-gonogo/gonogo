import { quantityScale } from "@ksp-gonogo/ui-kit";

/** The symbol the unit registry writes for a unit, or nothing for a unit it does not know or one with no symbol. */
function symbolOf(unit: string | undefined): string {
  if (unit === undefined || unit === "" || unit === "raw") return "";
  try {
    return quantityScale({ magnitude: 0, unit }, { format: unit }).symbol;
  } catch {
    return "";
  }
}

/** An axis title: what the axis measures, then its unit's symbol in parentheses. A unit with no name says nothing, so a plot that names no quantity draws no title. */
export function axisTitle(
  name: string | undefined,
  unit: string | undefined,
): string | undefined {
  if (!name) return undefined;
  const symbol = symbolOf(unit);
  return symbol ? `${name} (${symbol})` : name;
}
