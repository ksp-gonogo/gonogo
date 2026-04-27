/**
 * Kerboscript for the kOS File Browser widget. A two-mode dispatcher:
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
 * Each listing entry: `{ name, size, isDir }`. `isDir` lets the widget
 * recurse into subdirectories.
 *
 * Escaping notes — `;` is the [KOSDATA] field delimiter, so file contents
 * containing `;` would otherwise truncate. We escape `;` as `;` along
 * with the usual JSON specials (`\\`, `\"`, `\n`, `\r`, `\t`). The widget's
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
  // CD accepts a full path including volume (\`0:/widget_scripts\`,
  // \`Archive/foo\`). Listing a bare volume (\`0:\`, \`0\`, \`Archive\`)
  // works too — kOS treats it as the volume root.
  CD(pathArg).
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

/**
 * Maximum number of characters to render in the file viewer. v1 caps
 * to keep both the kOS-side string-escape pass and the React render
 * fast. Files exceeding this are truncated client-side with a banner.
 */
export const MAX_VIEW_CHARS = 16_000;
