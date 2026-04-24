/**
 * Kerboscript for the Ship Map widget. Enumerates SHIP:PARTS, projects each
 * part's position into ship-local (star/top/fore) coordinates, and emits a
 * JSON array inside a [KOSDATA] block.
 *
 * v1 — unverified against a live KSP install; the user is expected to
 * paste this into `Archive/shipmap.ks` and RUN it once to confirm the
 * coordinate frame and quoting hold up. The widget surfaces parse errors
 * and a first-200-char preview of the raw output in the app logs to
 * make that iteration cheap.
 *
 * Output contract:
 *   [KOSDATA]parts=<json-array>[/KOSDATA]
 * Where each array element is:
 *   { uid, name, title, mass, x, y, z, parent }
 *
 * Coordinate frame: x = STARVECTOR (right), y = TOPVECTOR (up),
 * z = FOREVECTOR (forward), with origin at SHIP:POSITION.
 *
 * Note on title quoting: stock KSP part titles contain ASCII double quotes
 * (e.g. `LV-T30 "Reliant"`). We strip them with :REPLACE to keep the JSON
 * simple — this is lossy but non-breaking, and the `name` field
 * (`liquidEngine3` etc.) is unambiguous.
 */
export const SHIP_MAP_SCRIPT = `// gonogo ship-map v1 — save as Archive/shipmap.ks then RUN shipmap.
// The Ship Map widget runs this on demand and on staging.
LOCAL q IS CHAR(34).
PRINT "shipmap: scanning " + SHIP:PARTS:LENGTH + " parts on " + SHIP:NAME.

LOCAL json IS "[".
LOCAL first IS TRUE.
LOCAL shipPos IS SHIP:POSITION.
LOCAL fwd IS SHIP:FACING:FOREVECTOR.
LOCAL upv IS SHIP:FACING:TOPVECTOR.
LOCAL rightv IS SHIP:FACING:STARVECTOR.

FOR p IN SHIP:PARTS {
  IF NOT first { SET json TO json + ",". }
  SET first TO FALSE.

  LOCAL rel IS p:POSITION - shipPos.
  LOCAL sx IS VDOT(rel, rightv).
  LOCAL sy IS VDOT(rel, upv).
  LOCAL sz IS VDOT(rel, fwd).

  LOCAL parentUid IS "".
  IF p:HASPARENT { SET parentUid TO p:PARENT:UID. }

  // Strip ASCII double quotes from the human title (stock titles include
  // them, e.g. LV-T30 'Reliant') so the JSON string stays well-formed.
  LOCAL safeTitle IS p:TITLE:REPLACE(q, "'").

  SET json TO json + "{"
    + q + "uid" + q + ":" + q + p:UID + q + ","
    + q + "name" + q + ":" + q + p:NAME + q + ","
    + q + "title" + q + ":" + q + safeTitle + q + ","
    + q + "mass" + q + ":" + ROUND(p:MASS, 4) + ","
    + q + "x" + q + ":" + ROUND(sx, 3) + ","
    + q + "y" + q + ":" + ROUND(sy, 3) + ","
    + q + "z" + q + ":" + ROUND(sz, 3) + ","
    + q + "parent" + q + ":" + q + parentUid + q
    + "}".
}
SET json TO json + "]".

PRINT "shipmap: emitted " + SHIP:PARTS:LENGTH + " parts, " + json:LENGTH + " chars".
PRINT "[KOSDATA]parts=" + json + "[/KOSDATA]".
`;

/**
 * Shape of a parsed Ship Map payload. One entry per part.
 */
export interface ShipMapPart {
  uid: string;
  name: string;
  title: string;
  mass: number;
  x: number;
  y: number;
  z: number;
  parent: string;
}

/** Default script filename on the kOS Archive volume. */
export const SHIP_MAP_SCRIPT_NAME = "shipmap";
