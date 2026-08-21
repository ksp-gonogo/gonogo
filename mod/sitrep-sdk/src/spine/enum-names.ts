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
