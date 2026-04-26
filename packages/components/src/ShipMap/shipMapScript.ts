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
export const SHIP_MAP_SCRIPT = `// gonogo ship-map — save to your kOS Archive volume (default
// 0:/widget_scripts/shipmap.ks). The Ship Map widget runs this via
// RUNPATH on demand and on staging.
//
// \`quoteChar\` rather than the obvious \`q\`: kOS already binds \`q\` as
// the builtin quaternion-direction constructor (q(pitch, yaw, roll, angle)),
// so trying to LOCAL q errors with "would clobber BUILTIN_FUNCTION q".
LOCAL quoteChar IS CHAR(34).
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
  LOCAL safeTitle IS p:TITLE:REPLACE(quoteChar, "'").

  SET json TO json + "{"
    + quoteChar + "uid" + quoteChar + ":" + quoteChar + p:UID + quoteChar + ","
    + quoteChar + "name" + quoteChar + ":" + quoteChar + p:NAME + quoteChar + ","
    + quoteChar + "title" + quoteChar + ":" + quoteChar + safeTitle + quoteChar + ","
    + quoteChar + "mass" + quoteChar + ":" + ROUND(p:MASS, 4) + ","
    + quoteChar + "x" + quoteChar + ":" + ROUND(sx, 3) + ","
    + quoteChar + "y" + quoteChar + ":" + ROUND(sy, 3) + ","
    + quoteChar + "z" + quoteChar + ":" + ROUND(sz, 3) + ","
    + quoteChar + "parent" + quoteChar + ":" + quoteChar + parentUid + quoteChar
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

/** Default script path on the kOS Archive volume. */
export const SHIP_MAP_SCRIPT_NAME = "0:/widget_scripts/shipmap.ks";
