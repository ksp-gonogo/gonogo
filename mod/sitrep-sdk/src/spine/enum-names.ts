/**
 * The ordinal→name table for a generated contract enum, taken FROM the enum
 * rather than transcribed beside it.
 *
 * The wire carries a C# enum as its ORDINAL, and a table like this is what
 * turns one back into a name. Each table used to be a hand-written array with
 * the ordinals in trailing comments, and `TARGET_KIND_NAMES` is what that
 * costs: `TargetKind` grew `Position` and `Part`, the table kept its three
 * entries, and a docking-port target resolved to `undefined` because its
 * ordinal indexed off the end. Nothing threw and nothing warned, so every
 * consumer read that `undefined` as "the channel has not arrived".
 *
 * A transcription drifts the moment somebody appends a member, which is the
 * moment nobody re-reads the consumers. Deriving removes the transcription, so
 * a member added in C# reaches the table with the generated enum.
 *
 * Reads the reverse map every TypeScript numeric enum carries
 * (`Situation[0] === "Landed"`), walking up from 0 until the ordinals run out.
 * Every enum in this contract is densely indexed from zero: the wire depends on
 * declaration order, so the contract's own convention forbids explicit values.
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
 * The value→name map for a generated enum whose values are NOT a dense run
 * from zero, taken FROM the enum the same way `namesOf` takes its array.
 *
 * `namesOf` walks 0, 1, 2… and stops at the first gap, which is exactly right
 * for an enum this contract declares: the wire carries declaration order, so
 * our own enums are dense by convention and an array indexed by ordinal is the
 * natural shape. KSP's enums are not ours. `PartCategories` opens at `none =
 * -1`, and `KSPActionGroup` is a `[Flags]` bitmask, so `namesOf` would resolve
 * no name for `none` at all and would stop dead after `None = 0` on the
 * bitmask, in both cases handing every consumer an `undefined` that reads as
 * "the field has not arrived". That is the `TARGET_KIND_NAMES` defect with a
 * different cause, so it gets a table that cannot have it rather than a
 * transcription that promises not to.
 *
 * Reads the same reverse map every TypeScript numeric enum carries, but off
 * `Object.entries` rather than by counting, so a negative, sparse or
 * power-of-two value set survives intact.
 */
export function namesByValue(members: object): ReadonlyMap<number, string> {
  const byValue = new Map<number, string>();
  for (const [key, value] of Object.entries(members)) {
    // The reverse map's keys are the numeric values, stringified; the forward
    // half (name → value) is what the Number() guard drops.
    const numeric = Number(key);
    if (Number.isInteger(numeric) && typeof value === "string") {
      byValue.set(numeric, value);
    }
  }
  return byValue;
}
