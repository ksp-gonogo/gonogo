/**
 * The words the generated Landing Status scenes carry in their `_meta`: what each scene shows, in plain terms, and, for the scenes derived from another, the note saying how.
 * Kept apart from the maths that builds the scenes so a change to a figure never has to touch a sentence.
 */

/** What each scene shows, by scenario name. */
export const SHOWS: Readonly<Record<string, string>> = {
  "descending-too-fast-to-stop":
    "A lander 12 km above the Mun descending at 350 m/s, far too fast for its thrust to stop in the remaining height, so the board reads NO LANDING VECTOR and BEST-BURN IMPACT with the site card marked ABORT.",
  "final-approach-mun":
    "A lander about 180 m above the Mun descending at 8 m/s on a live link, with the ignition countdown urgent and the craft low over the landing site.",
  "kerbin-reentry-atmospheric":
    "A craft descending through Kerbin's atmosphere at 28 km and 210 m/s, so the board shows terminal velocity (220 m/s), projected touchdown (8.4 m/s), time to impact and the descent regime instead of a suicide-burn countdown.",
  "landed-mun":
    "A lander sitting on the Mun after touchdown, with the board showing LANDED, the vessel on its site, a safe verdict, thrust-to-weight and fuel, and no countdowns.",
  "pre-burn-cruise":
    "A lander coasting about 45 km above the Mun toward a landing site 27 km downrange, well before the burn.",
  "suicide-burn-approaching-link-lost":
    "A lander about 2.8 km above the Mun descending at 42.5 m/s with the burn approaching, after the link has dropped so every reading is held rather than current.",
  "suicide-burn-approaching":
    "A lander about 2.8 km above the Mun descending at 42.5 m/s with the commit clock running and the burn approaching, showing the full metric grid, terrain cross-section and commit point.",
  "descent-approach":
    "A lander on final approach over the Mun, descending softly at about 2.5 m/s from 149 m over a marginal slope, with the commit countdowns running.",
  "descent-final":
    "A lander about to touch down on the Mun, 39 m up and descending at 1.4 m/s with gear down, over smooth flat ground rated safe.",
  "descent-high":
    "A lander high over the Mun with the aim point far downrange, over steep rough ground rated divert, on a staged comms delay.",
  "descent-ignition":
    "A lander at suicide-burn ignition over the Mun, committed to the burn but still fast enough that the site reads divert, on an autonomous comms delay.",
  "descent-landed":
    "A lander sitting on the Mun after touchdown: situation Landed, no motion and no countdown.",
  "boulder-rough":
    "A landing site with a low slope but a boulder-strewn surface, rated marginal because of the roughness.",
  "crater-field":
    "A landing site in a crater, with a deep central dip and a raised rim, rated marginal because of the roughness.",
  "flat-plains":
    "A landing site on flat, smooth plains with almost no slope, rated safe.",
  "gentle-slope":
    "A landing site on a gentle slope of about 9 degrees, rated marginal because of the slope.",
  "ridge-mountainous":
    "A landing site on a sharp mountain ridge, rated divert because of both slope and roughness.",
  "steep-slope":
    "A landing site on a slope steeper than 15 degrees, rated divert because of the slope.",
  "currency-live":
    "A lander mid-descent with every input current, so the suicide-burn instant is stated and no staleness caption appears.",
  "currency-no-link":
    "A lander mid-descent with no communications link at all, so the headline says there is no link instead of giving a burn time.",
  "currency-stale-mid-descent":
    "A lander mid-descent whose flight and surface readings have stopped arriving: altitude and speed still show with a staleness caption, and the ignition instant is withheld.",
  "atmospheric-final-approach-chute":
    "A craft at about 1.5 km over Kerbin under an open parachute at about 9 m/s, with the terrain plots showing again alongside the descent read.",
};

/** The `_meta.notes` of the scenes no other table of notes already holds. */
export const DERIVED_NOTES: Readonly<Record<string, string>> = {
  "kerbin-reentry-atmospheric":
    "SYNTHETIC (model-generated, NOT captured). Kerbin reentry (~28 km, 210 m/s down) in an atmosphere, the atmospheric board: terminal velocity, projected touchdown, aerobraking regime + the ambient (air density / temp) section, suicide-burn demoted. mach and dragToWeightRatio are derived from this scene's own numbers rather than picked: 220 m/s against a 240.15 K speed of sound is Mach 0.708, and a vessel sitting exactly at its terminal velocity has drag equal to weight, so the ratio is 1.0. Neither had ever been carried by a LandingStatus fixture, which left the descent envelope's drag chevron undrawn and its supersonic (Mach > 1) dashing unexercised; the __render_atmospheric__ scenes are where those two are worth looking at, since this dir feeds the DOM snapshots and no render config.",
  "suicide-burn-approaching-link-lost":
    "SYNTHETIC (model-generated, NOT captured). Mid descent (~2.8 km AGL, 42 m/s down) under STAGED delay: the commit clock is live and the burn is coming up; full metric grid, terrain + cross-section, commit point. Then the link drops: the transport disconnects after the scene is staged, so every reading this widget draws is held rather than current.",
  "currency-live":
    "SYNTHETIC. The CONTROL: mid-descent with every solve input current, so the suicide-burn instant is asserted and no currency caption appears.",
  "currency-no-link":
    "SYNTHETIC. No link at all: comms.delay reports oneWaySeconds null, so the hero takes the link-first refusal arm rather than the currency wording.",
  "currency-stale-mid-descent":
    "SYNTHETIC. THE case: flight and surface stopped being current mid-descent (validAt far behind the pinned view UT). Altitude/velocity/dv are DESCRIPTIONS and still render, captioned; the ignition instant is an INSTRUCTION and is withheld.",
  "atmospheric-final-approach-chute":
    "SYNTHETIC. Kerbin final approach (~1.5 km, chute deployed, ~9 m/s) WITH a settled terrain sample: exercises the terrain plots RE-APPEARING on an atmospheric board (Q1: low-altitude / stable-prediction gate) alongside the atmospheric-aware descent read.",
};
