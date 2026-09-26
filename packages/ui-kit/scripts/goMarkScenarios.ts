/**
 * The five sites Saga #551 moves off `--color-status-go-bg` (a background
 * meant to sit under text) onto the new go-mark token: what each site's mark
 * looks like, one sheet per site.
 *
 * Separate from the entry that renders them so the before/after pair differs
 * only in the component source, never in the scene: run once against the
 * pre-change tree and once against the post-change one.
 */
export interface GoMarkSheet {
  id: string;
  title: string;
  blurb: string;
  width: number;
}

export const SHEETS: GoMarkSheet[] = [
  {
    id: "combobox-selected",
    title: "Combobox: selected option",
    blurb: "DropdownItem's $selected fill, on the raised dropdown panel.",
    width: 240,
  },
  {
    id: "diverging-bar",
    title: "DivergingBar: positive fill, live and held",
    blurb:
      "The go-tone fill for a producing term, at a live reading and at a held (stale) one.",
    width: 240,
  },
  {
    id: "meter-go-fill",
    title: "Meter: go fill, live and held",
    blurb: "TONE_FILL.go, at a live reading and at a held (stale) one.",
    width: 320,
  },
  {
    id: "readout-status-pill",
    title: "Readout: StatusPill go edge",
    blurb: "The go tone's only edge, on the panel.",
    width: 200,
  },
  {
    id: "switch-checked",
    title: "Switch: checked track",
    blurb: "The checked track's fill and edge.",
    width: 200,
  },
];
