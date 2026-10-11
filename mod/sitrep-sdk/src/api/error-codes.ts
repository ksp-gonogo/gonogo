import {
  CORE_ERROR_CODES,
  type ErrorCodeDeclaration,
  type UplinkErrorCodeDeclaration,
} from "../__generated__/error-codes";

const coreById = new Map<string, ErrorCodeDeclaration>(
  CORE_ERROR_CODES.map((code) => [code.id, code]),
);

/** Codes learnt at runtime: an Uplink's own table, and every refinement the running mod lists on `system.uplinks`. */
const registered = new Map<string, ErrorCodeDeclaration>();

/**
 * What an error code means and the sentence the operator reads for it: a core
 * code first, then any code an Uplink registered or the running mod listed, or
 * `undefined` for an id nothing here has declared. Useful for telling the
 * operator why a command was refused or failed. Used by the command button
 * and the command list to word a refusal.
 *
 * @category Error codes
 * @categoryDescription Error codes
 * The codes a command is refused or fails with, the sentence an operator reads
 * for each, and how an Uplink registers codes of its own.
 */
export function describeErrorCode(
  id: string,
): ErrorCodeDeclaration | undefined {
  return coreById.get(id) ?? registered.get(id);
}

/**
 * Adds an Uplink's generated error-code table, so {@link describeErrorCode}
 * returns the meaning and the sentence of each refinement. Useful for showing
 * the operator why one of your Uplink's commands was refused. A core id is never
 * replaced. An Uplink's table holds refusals only: faults are declared by core.
 *
 * @category Error codes
 */
export function registerErrorCodes(
  codes: readonly UplinkErrorCodeDeclaration[],
): void {
  for (const code of codes) {
    if (coreById.has(code.id)) continue;
    registered.set(code.id, code);
  }
}

/**
 * Every error code registered by an Uplink or listed by the running mod so far,
 * in the order it arrived. Core codes are not included. Useful for checking
 * which Uplink codes a screen can describe.
 *
 * @category Error codes
 */
export function registeredErrorCodes(): readonly ErrorCodeDeclaration[] {
  return [...registered.values()];
}

/**
 * Reads every error-code refinement the running mod lists on `system.uplinks`
 * and makes it describable, so a code from an Uplink whose client never loaded
 * still reads as a sentence. Useful for showing the operator a refusal from an
 * Uplink with no client on this screen. A code already registered with its
 * meaning keeps it.
 *
 * @category Error codes
 */
export function noteRosterErrorCodes(roster: unknown): void {
  const uplinks = field(roster, "uplinks");
  if (!Array.isArray(uplinks)) return;
  for (const uplink of uplinks) {
    const codes = field(uplink, "errorCodes");
    if (!Array.isArray(codes)) continue;
    for (const entry of codes) {
      const id = field(entry, "id");
      const refines = field(entry, "refines");
      const sentence = field(entry, "sentence");
      if (typeof id !== "string" || typeof sentence !== "string") continue;
      if (coreById.has(id) || registered.has(id)) continue;
      registered.set(id, {
        id,
        kind: "refusal",
        refines: typeof refines === "string" ? refines : null,
        origin: null,
        sentence,
        meaning: "",
      });
    }
  }
}

/** One property of a value off the wire, or `undefined` when it is not an object. */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}
