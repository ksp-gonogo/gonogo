/**
 * Kerboscript for the kOS Processors widget. Lists every kOS CPU on the
 * active vessel (via `LIST PROCESSORS`) and emits their tag, run mode,
 * current volume, boot file, and mounting part.
 *
 * Output contract:
 *   [KOSDATA]processors=<json-array>[/KOSDATA]
 * Each entry: { tag, mode, volume, bootFile, partTitle, partUid }
 *
 * `mode` is the string kOS reports — "READY", "STARVED", "OFF". Anything
 * else is forwarded verbatim so we can spot kOS version drift in logs.
 */
export const KOS_PROCESSORS_SCRIPT = `// gonogo kos-processors — save to your kOS Archive volume (default
// 0:/widget_scripts/processors.ks).
LOCAL quoteChar IS CHAR(34).
PRINT "kos-procs: scanning vessel".

LOCAL procs IS LIST().
LIST PROCESSORS IN procs.

LOCAL json IS "[".
LOCAL first IS TRUE.
FOR proc IN procs {
  IF NOT first { SET json TO json + ",". }
  SET first TO FALSE.

  LOCAL tag IS "".
  IF proc:HASSUFFIX("TAG") { SET tag TO proc:TAG:REPLACE(quoteChar, "'"). }

  LOCAL mode IS "unknown".
  IF proc:HASSUFFIX("MODE") { SET mode TO proc:MODE. }

  LOCAL bootFile IS "".
  IF proc:HASSUFFIX("BOOTFILENAME") { SET bootFile TO proc:BOOTFILENAME. }

  LOCAL volname IS "".
  IF proc:HASSUFFIX("CURRENTVOLUME") {
    LOCAL vol IS proc:CURRENTVOLUME.
    IF vol:HASSUFFIX("NAME") { SET volname TO vol:NAME. }
  }

  LOCAL partTitle IS "".
  LOCAL partUid IS "".
  IF proc:HASSUFFIX("PART") {
    LOCAL pp IS proc:PART.
    SET partTitle TO pp:TITLE:REPLACE(quoteChar, "'").
    SET partUid TO pp:UID.
  }

  SET json TO json + "{"
    + quoteChar + "tag" + quoteChar + ":" + quoteChar + tag + quoteChar + ","
    + quoteChar + "mode" + quoteChar + ":" + quoteChar + mode + quoteChar + ","
    + quoteChar + "volume" + quoteChar + ":" + quoteChar + volname + quoteChar + ","
    + quoteChar + "bootFile" + quoteChar + ":" + quoteChar + bootFile + quoteChar + ","
    + quoteChar + "partTitle" + quoteChar + ":" + quoteChar + partTitle + quoteChar + ","
    + quoteChar + "partUid" + quoteChar + ":" + quoteChar + partUid + quoteChar
    + "}".
}
SET json TO json + "]".

PRINT "kos-procs: emitted " + procs:LENGTH + " processors, " + json:LENGTH + " chars".
PRINT "[KOSDATA]processors=" + json + "[/KOSDATA]".
`;

export interface KosProcessor {
  tag: string;
  mode: string;
  volume: string;
  bootFile: string;
  partTitle: string;
  partUid: string;
}

/** Default script path on the kOS Archive volume. */
export const KOS_PROCESSORS_SCRIPT_NAME = "0:/widget_scripts/processors.ks";
