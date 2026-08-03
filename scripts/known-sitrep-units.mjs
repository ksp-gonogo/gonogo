/**
 * The contract's declared unit tokens, read out of the generated `units.ts`.
 *
 * That file is TypeScript and declares `KnownSitrepUnit` as a type, which has
 * no runtime form to import, so the token list is recovered from the source.
 * Narrow enough to be safe: the shape is one `| "token"` per line inside a
 * single type alias, emitted by `RtConfig.EmitUnitMap` and not hand-edited.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(
  join(root, "mod/sitrep-sdk/src/__generated__/units.ts"),
  "utf8",
);
const block = src.slice(
  src.indexOf("export type KnownSitrepUnit ="),
  src.indexOf("export type SitrepUnit ="),
);
export const KNOWN_SITREP_UNITS = [...block.matchAll(/\| "([^"]+)"/g)].map(
  (m) => m[1],
);
if (KNOWN_SITREP_UNITS.length === 0) {
  throw new Error(
    "Recovered no tokens from the generated units.ts. The emitted shape of " +
      "KnownSitrepUnit has changed and this reader needs updating.",
  );
}
