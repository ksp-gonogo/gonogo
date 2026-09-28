import {
  CORE_ERROR_CODES,
  type ErrorCodeDeclaration,
} from "../__generated__/error-codes";

const coreById = new Map<string, ErrorCodeDeclaration>(
  CORE_ERROR_CODES.map((code) => [code.id, code]),
);

/** Codes learnt at runtime: an Uplink's own table, and every refinement the running mod lists on `system.uplinks`. */
const registered = new Map<string, ErrorCodeDeclaration>();

/**
 * What an error code means and what an operator reads for it: a core code
 * first, then any code an Uplink registered or the running mod listed, or
 * `undefined` for an id nothing here has declared.
 *
 * @category Error codes
 */
export function describeErrorCode(
  id: string,
): ErrorCodeDeclaration | undefined {
  return coreById.get(id) ?? registered.get(id);
}

/**
 * Makes an Uplink's generated error-code table describable, so its refinements
 * read with their meaning as well as their sentence. A core id is never
 * replaced.
 *
 * @category Error codes
 */
export function registerErrorCodes(
  codes: readonly ErrorCodeDeclaration[],
): void {
  for (const code of codes) {
    if (coreById.has(code.id)) continue;
    registered.set(code.id, code);
  }
}

/**
 * Every code registered or learnt so far, core's excepted, in the order it arrived.
 *
 * @category Error codes
 */
export function registeredErrorCodes(): readonly ErrorCodeDeclaration[] {
  return [...registered.values()];
}

/**
 * Learns every refinement the running mod lists on `system.uplinks`, which is
 * how a code from an Uplink whose bundle never loaded still reads as a
 * sentence. A code already registered with its meaning keeps it.
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
