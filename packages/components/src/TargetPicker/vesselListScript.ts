import { registerKosScript } from "@gonogo/core";

/**
 * Kerboscript for the Target Picker's Vessels tab. Pure feed — enumerates
 * every vessel in range and emits `name`, `type`, and `distance` for each.
 *
 * This script used to also accept a `setTargetName` parameter and SET TARGET
 * inline; that side-effect now lives in `setTargetScript.ts`, which the
 * widget invokes on demand through `executeScript`. Splitting the two lets
 * the listing slot into the centralised `kos.compute.target-vessels.vessels`
 * fanout while the rare "set target" RPC stays a one-shot.
 *
 * Output contract:
 *   [KOSDATA:target-vessels]vessels=<json-array>[/KOSDATA]
 *
 * Each entry: `{ name, type, distance }`. `distance` is metres from the
 * active ship, rounded to 1 decimal so the JSON stays compact.
 *
 * Quoting note: vessel names can contain double quotes (`"USS \"Heisenberg\""`),
 * which would break the JSON. We `:REPLACE(quoteChar, "'")` to keep the
 * payload well-formed — same approach the ShipMap script uses for part
 * titles.
 */
export const VESSEL_LIST_SCRIPT = `// gonogo target-vessels — list every in-range target.
LOCAL quoteChar IS CHAR(34).
LOCAL ts IS LIST().
LIST TARGETS IN ts.

LOCAL json IS "[".
LOCAL first IS TRUE.
FOR v IN ts {
  IF NOT first { SET json TO json + ",". }
  SET first TO FALSE.
  LOCAL d IS (v:POSITION - SHIP:POSITION):MAG.
  LOCAL safeName IS v:NAME:REPLACE(quoteChar, "'").
  LOCAL safeType IS v:TYPENAME:REPLACE(quoteChar, "'").
  SET json TO json + "{"
    + quoteChar + "name" + quoteChar + ":" + quoteChar + safeName + quoteChar + ","
    + quoteChar + "type" + quoteChar + ":" + quoteChar + safeType + quoteChar + ","
    + quoteChar + "distance" + quoteChar + ":" + ROUND(d, 1)
    + "}".
}
SET json TO json + "]".
PRINT "[KOSDATA:target-vessels]vessels=" + json + "[/KOSDATA]".
`;

export const VESSEL_LIST_SCRIPT_NAME = "0:/widget_scripts/targetlist.ks";

/** Topic id for the centralised kOS compute fanout. */
export const TARGET_VESSELS_TOPIC_ID = "target-vessels";

export interface VesselListEntry {
  name: string;
  type: string;
  /** Metres from the active vessel. */
  distance: number;
}

// Self-register at module load. 5s passive cadence — frequent enough to
// keep distances fresh on a moving formation, infrequent enough not to
// hold the kOS REPL captive.
registerKosScript({
  id: TARGET_VESSELS_TOPIC_ID,
  name: "Target Vessels",
  script: VESSEL_LIST_SCRIPT,
  intervalMs: 5_000,
  fields: [{ name: "vessels", type: "json" }],
});
