/** A rectangle in plot units, `x0,y0` top left to `x1,y1` bottom right. */
export interface CaptionBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where an encounter marker's caption is drawn, relative to the marker's centre in plot units. */
export interface CaptionPlace {
  dx: number;
  dy: number;
  anchor: "start" | "end";
}

const overlaps = (a: CaptionBox, b: CaptionBox): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Where the caption of an encounter or escape marker goes: right of the ring
 * unless a body's name is there, then left of it, then above and below on
 * either side, the first spot that overlaps none of the names in `avoid`. With
 * every spot taken the caption keeps the right-hand spot.
 *
 * `widthPx` and `heightPx` are the caption's size on screen and `zoom` turns
 * them, and the ring's radius, into plot units.
 */
export function placeEncounterCaption({
  x,
  y,
  zoom,
  widthPx,
  heightPx,
  avoid,
}: {
  x: number;
  y: number;
  zoom: number;
  widthPx: number;
  heightPx: number;
  avoid: readonly CaptionBox[];
}): CaptionPlace {
  const reach = (4 + 3) / zoom;
  const w = widthPx / zoom;
  const h = heightPx / zoom;
  const candidates: CaptionPlace[] = [
    { dx: reach, dy: 3 / zoom, anchor: "start" },
    { dx: -reach, dy: 3 / zoom, anchor: "end" },
    { dx: reach, dy: -reach, anchor: "start" },
    { dx: reach, dy: reach + h, anchor: "start" },
    { dx: -reach, dy: -reach, anchor: "end" },
    { dx: -reach, dy: reach + h, anchor: "end" },
  ];
  const free = candidates.find((place) => {
    const left = place.anchor === "start" ? x + place.dx : x + place.dx - w;
    const box: CaptionBox = {
      x0: left,
      y0: y + place.dy - h * 0.8,
      x1: left + w,
      y1: y + place.dy + h * 0.2,
    };
    return !avoid.some((other) => overlaps(box, other));
  });
  return free ?? candidates[0];
}
