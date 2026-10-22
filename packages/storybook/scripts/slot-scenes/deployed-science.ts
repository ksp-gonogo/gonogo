import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    id: "planted-slot:deployed-science.experiment",
    widgetId: "deployed-science",
    // Not `mun-and-minmus-bases.json`: that fixture's `_stream.emits` are wire-shaped
    // (`topic`/`payload`), for the Uplink render probe's own scenes. WidgetScene reads
    // the plain `channel`/`value` shape, so this slot needs its own fixture in that
    // shape, kept out of the Uplink's own `__fixtures__` (which the Uplink docs
    // generator sweeps and requires a `_scene` block none of this needs).
    fixture:
      "packages/components/scripts/probe/slot-fixtures/deployed-science.experiment.json",
    w: 6,
    h: 12,
  },
];
