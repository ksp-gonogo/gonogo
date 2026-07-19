/**
 * Marker subclass: errors raised by the running kerboscript itself
 * (explicit [KOSERROR], or kOS runtime exceptions like
 * KOSUndefinedIdentifierException), not by transport / proxy / session
 * bookkeeping. Raised by `KosUplinkExecutor` (via `kosUplinkExecutor.ts`)
 * so callers can distinguish a script-author fault from a transport error
 * without every failure mode collapsing into a generic `Error`.
 */
export class KosScriptError extends Error {
  readonly isScriptError = true;
  constructor(message: string) {
    super(message);
    this.name = "KosScriptError";
  }
}

/**
 * Duck-type check that survives bundling, structured-clone, and the
 * occasional cross-realm Error. Prefer this over `instanceof` at module
 * boundaries.
 */
export function isKosScriptError(err: unknown): err is KosScriptError {
  return (
    err !== null &&
    typeof err === "object" &&
    (err as { isScriptError?: unknown }).isScriptError === true
  );
}
