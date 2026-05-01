/**
 * Kerboscript for the Target Picker widget's Vessels tab. Single-shot
 * dispatcher that optionally sets the KSP target by name and always
 * emits the current list of in-range targets so the widget can refresh.
 *
 * Pass an empty string for `setTargetName` to list-only. Pass `<clear>`
 * to clear the target (kerboscript's `SET TARGET TO ""` semantics).
 *
 * Output contract:
 *   [KOSDATA]vessels=<json-array>[/KOSDATA]
 *
 * Each entry: `{ name, type, distance }`. `distance` is metres from the
 * active ship, rounded to 1 decimal so the JSON stays compact.
 *
 * Quoting note: vessel names can contain double quotes (`"USS \"Heisenberg\""`),
 * which would break the JSON. We `:REPLACE(quoteChar, "'")` to keep the
 * payload well-formed — same approach the ShipMap script uses for part
 * titles.
 */
export const VESSEL_LIST_SCRIPT = `// gonogo target-picker — list nearby targets, optionally set/clear.
PARAMETER setTargetName IS "".

LOCAL quoteChar IS CHAR(34).
LOCAL ts IS LIST().
LIST TARGETS IN ts.

IF setTargetName:LENGTH > 0 {
  IF setTargetName = "<clear>" {
    SET TARGET TO "".
  } ELSE {
    LOCAL found IS FALSE.
    FOR v IN ts {
      IF NOT found AND v:NAME = setTargetName {
        SET TARGET TO v.
        SET found TO TRUE.
      }
    }
  }
}

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
PRINT "[KOSDATA]vessels=" + json + "[/KOSDATA]".
`;

export const VESSEL_LIST_SCRIPT_NAME = "0:/widget_scripts/targetlist.ks";

export interface VesselListEntry {
  name: string;
  type: string;
  /** Metres from the active vessel. */
  distance: number;
}
