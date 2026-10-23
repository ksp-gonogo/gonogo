/** The five readings the orbit spread is judged on, each a real departure envelope read at a view time. */
export interface SpreadScene {
  id: string;
  title: string;
  /** The largest position drift the provider states, in metres, or null for none stated. */
  driftMetres: number | null;
  /** How far past the observation the view is, in seconds. */
  viewAfter: number;
}

/** Seconds of one orbit of the scene's craft; the provider's horizon is one orbit. */
export const SCENE_PERIOD = 4395;

export const SCENES: readonly SpreadScene[] = [
  {
    id: "no-band",
    title: "No band stated",
    driftMetres: null,
    viewAfter: 1000,
  },
  {
    id: "sub-pixel",
    title: "0.127 m at 532 s",
    driftMetres: 0.127,
    viewAfter: 532,
  },
  {
    id: "few-degrees",
    title: "About 3° either side",
    driftMetres: 55_000,
    viewAfter: 1000,
  },
  {
    id: "quarter-orbit",
    title: "Over a quarter of the orbit",
    driftMetres: 700_000,
    viewAfter: 1000,
  },
  {
    id: "past-horizon",
    title: "Past the horizon",
    driftMetres: 55_000,
    viewAfter: SCENE_PERIOD + 400,
  },
];

/** A scene for the System View and the map layer, which share one harness. */
export interface LayerScene {
  id: string;
  title: string;
  /** Half-width of the stated band, as degrees of the orbit; 0.127 metres of drift is far under a pixel. */
  halfWidthDegrees: number;
  /** True where the view is past the provider's horizon, which draws no band. */
  pastHorizon: boolean;
}

export const LAYER_SCENES: readonly LayerScene[] = [
  {
    id: "no-arc",
    title: "Under a pixel",
    halfWidthDegrees: 1e-6,
    pastHorizon: false,
  },
  {
    id: "few-degrees",
    title: "A few degrees",
    halfWidthDegrees: 8,
    pastHorizon: false,
  },
  {
    id: "quarter-orbit",
    title: "A quarter of the orbit",
    halfWidthDegrees: 45,
    pastHorizon: false,
  },
  {
    id: "past-horizon",
    title: "Past the horizon",
    halfWidthDegrees: 8,
    pastHorizon: true,
  },
];
