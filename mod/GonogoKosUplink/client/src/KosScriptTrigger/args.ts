import type { KosScriptArg } from "../shared/kos-data-parser";

/**
 * Parse the trigger widget's free-text args field into typed `KosScriptArg`s
 * for `executeScript`. Whitespace-separated tokens, with light type
 * inference so a typed `5` reaches the script as the number 5 rather than
 * the string "5" (which the executor would quote), matching an operator's
 * intent when they type a bare number or `true`/`false`:
 *
 *   - a token that parses as a finite number becomes a `number`
 *   - `true` / `false` (any case) become a `boolean`
 *   - everything else stays a `string` (the executor quotes it for kOS)
 *
 * No quoting syntax in v1: a string argument therefore cannot contain a
 * space, same limitation the KosTerminal `/`-composer's own `\s+` split
 * carries. Empty / whitespace-only input yields no args.
 */
export function parseScriptArgs(text: string): KosScriptArg[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.map(parseToken);
}

function parseToken(token: string): KosScriptArg {
  if (/^(true|false)$/i.test(token)) return token.toLowerCase() === "true";
  // Reject the empty string and whitespace up front: Number("") is 0 and
  // Number(" ") is 0, neither of which a caller means as a numeric arg.
  const asNumber = Number(token);
  if (token !== "" && Number.isFinite(asNumber)) return asNumber;
  return token;
}
