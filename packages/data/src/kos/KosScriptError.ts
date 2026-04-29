/**
 * Marker subclass: errors raised by the running kerboscript itself
 * (explicit [KOSERROR], or kOS runtime exceptions like
 * KOSUndefinedIdentifierException), not by transport / proxy / session
 * bookkeeping.
 *
 * Lives in @gonogo/data so both the in-process KosDataSource (app
 * package) and the PeerClient resolver (app package) and the consumer
 * hook `useKosWidget` (data package) can construct and identify the same
 * error class without a layering inversion.
 *
 * The interval-mode breaker in `useKosWidget` only counts these toward
 * its consecutive-error threshold; a flaky telnet hop or proxy restart
 * shouldn't trip every kOS widget at once.
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
