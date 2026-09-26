import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import type { AbsenceScene } from "./absenceScene";

/**
 * The exceptions to healthy-telemetry render scenes: each withholds one input
 * from a fixture that already renders, so the pair differs by that arrival
 * alone. The prose fields are what make a scene worth adding: why the input
 * can be missing, what the widget owes the operator, and which text settles
 * it. Deliberately few, each saying what the change has to be.
 */
export const ABSENCE_SCENES: AbsenceScene[] = [
  {
    id: "map-view-position-never-arrived",
    widget: "map-view",
    fixture: "MapView/__fixtures__/kerbin-lko-equator.json",
    channel: "vessel.flight",
    mode: { name: "tiny-3x4", w: 3, h: 4 },
    because:
      "vessel.flight is one wire topic among several, published by the flight " +
      "provider, and a session can take orbit and body frames without one. " +
      "The body still resolves off `vessel.identity`, so the tile names it and " +
      "says only that the position is missing",
    expects:
      "the coordinates are withheld AND the tile says why, in the same words " +
      "the full map uses, because two bare em dashes are what a craft that " +
      "has never reported and a craft whose position we hold both look like",
    withholds: ["75.00"],
    showsMore: [NULL_DISPLAY, "No position data"],
    stillPaints: ["MAP"],
  },
  {
    id: "tech-tree-balance-never-arrived",
    widget: "tech-tree",
    fixture: "TechTree/__fixtures__/small-career-detail.json",
    channel: "career.status",
    mode: { name: "default-6x9", w: 6, h: 9 },
    because:
      "career.status carries the tree and the science balance together, so " +
      "this is the career provider silent while the space centre reports",
    expects:
      "the reference behaviour for the whole family: the widget already " +
      "separates a balance that never arrived from one it has stopped " +
      "vouching for, and refuses the spend on either",
    withholds: ["researchable"],
    showsMore: ["Awaiting tech telemetry"],
  },
  {
    id: "crew-status-suit-resources-never-arrived",
    widget: "crew-status",
    fixture: "CrewStatus/__fixtures__/eva-suit-low-o2.json",
    channel: "vessel.resources",
    mode: { name: "default-6x8", w: 6, h: 8 },
    because:
      "vessel.resources is this widget's one declared optionalChannel, so its " +
      "own author has written down that it may be absent at runtime",
    expects:
      "the suit figures go and the roster the widget is actually for survives: " +
      "one absent optional input must not take the panel with it. What the " +
      "widget does with the METERS is an open question and this scene does " +
      "not settle it: `suitTank` drops the pair on a reading that never " +
      "arrived, so the meters vanish, while the comment above it says a " +
      "never-reported figure is one the Meter draws honestly and only a key " +
      "missing from an ARRIVED payload should draw nothing. Those are two " +
      "different pictures of an EVA kerbal and the operator cannot tell them " +
      "apart",
    withholds: ["12.5"],
    stillPaints: ["CREW", "Jebediah Kerman"],
  },
  {
    id: "comm-signal-link-never-arrived",
    widget: "comm-signal",
    fixture: "CommSignal/__fixtures__/strong-direct-ksc.json",
    channel: "comms.link",
    mode: { name: "default-6x5", w: 6, h: 5 },
    because:
      "comms.link is the CommsCore Uplink's own topic while the signal " +
      "strength rides vessel.comms, so a strong bar count can be aboard with " +
      "nothing having said whether the link is up",
    expects:
      "the caption stops naming a centre, because 'Signal to KSC' asserts a " +
      "signal and the widget has no verdict to assert one from; the strength " +
      "is its own measurement and stays",
    withholds: ["Signal to KSC"],
    showsMore: [NULL_DISPLAY],
    stillPaints: ["COMMNET", "87"],
  },
];
