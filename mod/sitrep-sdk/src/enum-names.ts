/**
 * Returns the names of a numeric enum's members, indexed by value, for an enum
 * whose values run 0, 1, 2 and so on, as every enum in the Gonogo contract
 * does: `namesOf(Situation)[0]` is `"Landed"`. It is built from the enum, so
 * it covers every member. For KSP's own enums, use {@link namesByValue}.
 *
 * @category Enum names
 */
export function namesOf(members: object): readonly string[] {
  const byOrdinal = members as Record<number, string | undefined>;
  const names: string[] = [];
  for (let ordinal = 0; byOrdinal[ordinal] !== undefined; ordinal += 1) {
    names.push(byOrdinal[ordinal] as string);
  }
  return names;
}

/**
 * Returns the names of a numeric enum's members, keyed by value, for an enum
 * whose values do not run 0, 1, 2: one with negative values, gaps, or bit
 * flags, as KSP's `PartCategories` and `KSPActionGroup` have.
 *
 * @category Enum names
 */
export function namesByValue(members: object): ReadonlyMap<number, string> {
  const byValue = new Map<number, string>();
  for (const [key, value] of Object.entries(members)) {
    // The reverse map's keys are the numeric values, stringified; the forward half (name → value) is what the Number() guard drops.
    const numeric = Number(key);
    if (Number.isInteger(numeric) && typeof value === "string") {
      byValue.set(numeric, value);
    }
  }
  return byValue;
}
