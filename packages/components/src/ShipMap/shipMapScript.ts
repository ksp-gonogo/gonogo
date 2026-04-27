/**
 * Kerboscript for the Ship Map widget. Enumerates SHIP:PARTS, projects each
 * part's position into ship-local (star/top/fore) coordinates, and emits a
 * JSON array inside a [KOSDATA] block.
 *
 * v2 — adds category (derived from p:MODULES + resource scan), thermal
 * data (temp / maxTemp), stage, per-resource amount/capacity, and the
 * in-game part tag (set via the kOS part's right-click menu). Older
 * v1 payloads still parse — every new field is optional in
 * `ShipMapPart`.
 *
 * Output contract:
 *   [KOSDATA]parts=<json-array>[/KOSDATA]
 * Where each array element is:
 *   { uid, name, title, category, mass, x, y, z,
 *     temp, maxTemp, stage, resources, tag, parent }
 *
 * Coordinate frame: x = STARVECTOR (right), y = TOPVECTOR (up),
 * z = FOREVECTOR (forward), with origin at SHIP:POSITION.
 *
 * Title quoting: stock titles include ASCII double quotes; we strip
 * them with :REPLACE so the JSON string stays well-formed.
 */
export const SHIP_MAP_SCRIPT = `// gonogo ship-map v2 — save to your kOS Archive volume (default
// 0:/widget_scripts/shipmap.ks). The Ship Map widget runs this via
// RUNPATH on demand and on staging.
//
// \`quoteChar\` rather than the obvious \`q\`: kOS already binds \`q\` as
// the builtin quaternion-direction constructor, so trying to LOCAL q
// errors with "would clobber BUILTIN_FUNCTION q".
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

  LOCAL safeTitle IS p:TITLE:REPLACE(quoteChar, "'").

  // Category — derive from modules + a SolidFuel resource scan so a
  // BACC Thumper reads as "booster" rather than a generic "engine".
  LOCAL hasEngine IS FALSE.
  LOCAL hasDecouple IS FALSE.
  LOCAL hasRCSMod IS FALSE.
  LOCAL hasCommand IS FALSE.
  LOCAL hasSolar IS FALSE.
  LOCAL hasParachute IS FALSE.
  LOCAL hasFin IS FALSE.
  FOR m IN p:MODULES {
    IF m:CONTAINS("Engine") { SET hasEngine TO TRUE. }
    IF m:CONTAINS("Decouple") OR m:CONTAINS("Separator") { SET hasDecouple TO TRUE. }
    IF m:CONTAINS("RCS") { SET hasRCSMod TO TRUE. }
    IF m:CONTAINS("Command") { SET hasCommand TO TRUE. }
    IF m:CONTAINS("SolarPanel") { SET hasSolar TO TRUE. }
    IF m:CONTAINS("Parachute") { SET hasParachute TO TRUE. }
    IF m:CONTAINS("LiftingSurface") OR m:CONTAINS("AeroSurface") OR m:CONTAINS("ControlSurface") { SET hasFin TO TRUE. }
  }

  LOCAL hasSolidFuel IS FALSE.
  LOCAL resJson IS "[".
  LOCAL firstR IS TRUE.
  FOR r IN p:RESOURCES {
    IF r:NAME = "SolidFuel" { SET hasSolidFuel TO TRUE. }
    IF NOT firstR { SET resJson TO resJson + ",". }
    SET firstR TO FALSE.
    SET resJson TO resJson + "{"
      + quoteChar + "n" + quoteChar + ":" + quoteChar + r:NAME + quoteChar + ","
      + quoteChar + "a" + quoteChar + ":" + ROUND(r:AMOUNT, 2) + ","
      + quoteChar + "c" + quoteChar + ":" + ROUND(r:CAPACITY, 2)
      + "}".
  }
  SET resJson TO resJson + "]".

  LOCAL category IS "other".
  IF hasEngine AND hasSolidFuel { SET category TO "booster". }
  ELSE IF hasEngine { SET category TO "engine". }
  ELSE IF hasDecouple { SET category TO "decoupler". }
  ELSE IF hasRCSMod { SET category TO "rcs". }
  ELSE IF hasCommand { SET category TO "capsule". }
  ELSE IF hasSolar { SET category TO "solar". }
  ELSE IF hasParachute { SET category TO "parachute". }
  ELSE IF hasFin { SET category TO "fin". }
  ELSE IF p:RESOURCES:LENGTH > 0 { SET category TO "tank". }

  LOCAL temp IS 0.
  LOCAL maxTemp IS 0.
  IF p:HASSUFFIX("TEMPERATURE") { SET temp TO p:TEMPERATURE. }
  IF p:HASSUFFIX("MAXTEMP") { SET maxTemp TO p:MAXTEMP. }

  // Avoid LOCAL stage — kOS binds \`stage\` as a builtin function, so
  // declaring a local of the same name errors with "would clobber
  // BUILTIN_FUNCTION stage".
  LOCAL stageIdx IS 0.
  IF p:HASSUFFIX("STAGE") { SET stageIdx TO p:STAGE. }

  // Player-set tag from the right-click menu — strip ASCII quotes so
  // the JSON string stays well-formed even if someone tagged with " in
  // the name.
  LOCAL tag IS "".
  IF p:HASSUFFIX("TAG") { SET tag TO p:TAG:REPLACE(quoteChar, "'"). }

  SET json TO json + "{"
    + quoteChar + "uid" + quoteChar + ":" + quoteChar + p:UID + quoteChar + ","
    + quoteChar + "name" + quoteChar + ":" + quoteChar + p:NAME + quoteChar + ","
    + quoteChar + "title" + quoteChar + ":" + quoteChar + safeTitle + quoteChar + ","
    + quoteChar + "category" + quoteChar + ":" + quoteChar + category + quoteChar + ","
    + quoteChar + "mass" + quoteChar + ":" + ROUND(p:MASS, 4) + ","
    + quoteChar + "x" + quoteChar + ":" + ROUND(sx, 3) + ","
    + quoteChar + "y" + quoteChar + ":" + ROUND(sy, 3) + ","
    + quoteChar + "z" + quoteChar + ":" + ROUND(sz, 3) + ","
    + quoteChar + "temp" + quoteChar + ":" + ROUND(temp, 1) + ","
    + quoteChar + "maxTemp" + quoteChar + ":" + ROUND(maxTemp, 1) + ","
    + quoteChar + "stage" + quoteChar + ":" + stageIdx + ","
    + quoteChar + "resources" + quoteChar + ":" + resJson + ","
    + quoteChar + "tag" + quoteChar + ":" + quoteChar + tag + quoteChar + ","
    + quoteChar + "parent" + quoteChar + ":" + quoteChar + parentUid + quoteChar
    + "}".
}
SET json TO json + "]".

PRINT "shipmap: emitted " + SHIP:PARTS:LENGTH + " parts, " + json:LENGTH + " chars".
PRINT "[KOSDATA]parts=" + json + "[/KOSDATA]".
`;

/**
 * Shape of a parsed Ship Map payload. One entry per part. Fields beyond
 * `uid/name/title/mass/x/y/z/parent` come from the v2 script — older
 * v1 payloads still parse because every v2 field is optional.
 */
export interface ShipMapPart {
  uid: string;
  name: string;
  title: string;
  /** v2: derived in-game from p:MODULES. Preferred over name/title heuristics. */
  category?: string;
  mass: number;
  x: number;
  y: number;
  z: number;
  /** v2: current part temperature in Kelvin. */
  temp?: number;
  /** v2: maximum safe part temperature in Kelvin. */
  maxTemp?: number;
  /** v2: stage at which the part will detach (or 0). */
  stage?: number;
  /** v2: resources held by the part (LiquidFuel, Oxidizer, SolidFuel, etc.). */
  resources?: { n: string; a: number; c: number }[];
  /** v2: player-set tag from the part's right-click menu (kOS p:TAG). */
  tag?: string;
  parent: string;
}

/** Default script path on the kOS Archive volume. */
export const SHIP_MAP_SCRIPT_NAME = "0:/widget_scripts/shipmap.ks";
