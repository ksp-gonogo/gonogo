/**
 * Kerboscript for the `/`-script picker's live drive listing
 * (kos-terminal-script-picker, hub-wizard-kos Phase 1 increment (b)).
 * Resurrected VERBATIM from the deleted KosFiles widget (`git show
 * 855bd024^:mod/GonogoKosUplink/client/src/KosFiles/filesScript.ts`) — same
 * [KOSDATA] contract, same two-mode dispatcher. The picker only ever
 * dispatches the "list" op; "read" is kept intact rather than trimmed, to
 * stay a faithful resurrection instead of a re-derived rewrite of a script
 * that was already proven correct.
 *
 *   RUN files("list", "0:")             → emits a JSON listing of that
 *                                          volume's top-level files.
 *   RUN files("list", "0:/scripts")     → emits a JSON listing of a
 *                                          subdirectory.
 *   RUN files("read", "0:/path.ks")     → emits the file's text content.
 *
 * Output contract:
 *   [KOSDATA]op=list;path=<absolute>;listing=<json-array>[/KOSDATA]
 *   [KOSDATA]op=read;path=<absolute>;contents="<json-escaped string>"[/KOSDATA]
 *
 * Each listing entry: `{ name, size, isDir }`. `isDir` lets a caller
 * recurse into subdirectories (the picker itself doesn't — see
 * `useKosScriptListing`'s doc comment).
 *
 * Escaping notes — `;` is the [KOSDATA] field delimiter, so file contents
 * containing `;` would otherwise truncate. We escape `;` as `;` along
 * with the usual JSON specials (`\\`, `\"`, `\n`, `\r`, `\t`). The caller's
 * `JSON.parse` decodes everything back transparently.
 *
 * kOS strings don't have C-style backslash escapes (a literal `\` is just
 * a backslash), so we build escape characters via `CHAR()` + concat.
 *
 * `pathArg` (not `target`) is the parameter name because `TARGET` is a
 * kOS global / suffix and shadowing it has a history of confusing the
 * parser depending on context.
 */
export const KOS_FILES_SCRIPT = `// gonogo kos-files — save to your kOS Archive volume (default
// 0:/widget_scripts/files.ks).
PARAMETER op IS "list".
PARAMETER pathArg IS "0:".

LOCAL quoteChar IS CHAR(34).
LOCAL backslash IS CHAR(92).

IF op = "list" {
  // Normalize bare volume names to volume-rooted paths. CD doesn't accept
  // \`Archive\` on its own — that's a volume identifier, not a path —
  // but \`Archive:/\` works (it switches volumes and CDs to root).
  // Inputs containing "/" are assumed already volume-qualified.
  LOCAL navPath IS pathArg.
  IF NOT navPath:CONTAINS("/") {
    IF navPath:CONTAINS(":") {
      SET navPath TO navPath + "/".
    } ELSE {
      SET navPath TO navPath + ":/".
    }
  }
  CD(navPath).
  LOCAL items IS LIST().
  LIST FILES IN items.

  LOCAL json IS "[".
  LOCAL first IS TRUE.
  FOR f IN items {
    IF NOT first { SET json TO json + ",". }
    SET first TO FALSE.
    LOCAL size IS 0.
    IF f:HASSUFFIX("SIZE") { SET size TO f:SIZE. }
    // VolumeItems expose :ISFILE — false means a directory. Older kOS
    // versions may not have the suffix, in which case we conservatively
    // treat everything as a file.
    LOCAL isDir IS FALSE.
    IF f:HASSUFFIX("ISFILE") { SET isDir TO NOT f:ISFILE. }
    SET json TO json + "{"
      + quoteChar + "name" + quoteChar + ":" + quoteChar + f:NAME + quoteChar + ","
      + quoteChar + "size" + quoteChar + ":" + size + ","
      + quoteChar + "isDir" + quoteChar + ":" + (CHOOSE "true" IF isDir ELSE "false")
      + "}".
  }
  SET json TO json + "]".
  PRINT "[KOSDATA]op=list;path=" + pathArg + ";listing=" + json + "[/KOSDATA]".
} ELSE IF op = "read" {
  IF NOT EXISTS(pathArg) {
    PRINT "[KOSDATA]op=read;path=" + pathArg + ";error=not-found[/KOSDATA]".
  } ELSE {
    LOCAL f IS OPEN(pathArg).
    LOCAL contents IS f:READALL:STRING.

    // Bulk REPLACE — quadratic-ish but fine for small scripts. Order
    // matters: backslash first, before we add new backslashes for other
    // escapes. \\u003b for ';' so the [KOSDATA] field-delimiter doesn't
    // truncate the value.
    LOCAL escaped IS contents.
    SET escaped TO escaped:REPLACE(backslash, backslash + backslash).
    SET escaped TO escaped:REPLACE(quoteChar, backslash + quoteChar).
    SET escaped TO escaped:REPLACE(";", backslash + "u003b").
    SET escaped TO escaped:REPLACE(CHAR(10), backslash + "n").
    SET escaped TO escaped:REPLACE(CHAR(13), backslash + "r").
    SET escaped TO escaped:REPLACE(CHAR(9), backslash + "t").

    PRINT "[KOSDATA]op=read;path=" + pathArg + ";contents=" + quoteChar + escaped + quoteChar + "[/KOSDATA]".
  }
}
`;

export interface KosFileEntry {
  name: string;
  size: number;
  /** True for subdirectories (kOS volumes that report ISDIR). */
  isDir?: boolean;
}

/** Default script path on the kOS Archive volume. */
export const KOS_FILES_SCRIPT_NAME = "0:/widget_scripts/files.ks";
