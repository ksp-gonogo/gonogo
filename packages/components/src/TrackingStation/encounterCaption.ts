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

/** The clear space kept around every caption on screen, in pixels, so a font that runs wider than the estimate still has room. */
const CAPTION_MARGIN_PX = 2;

/** A caption to place: its marker's centre in plot units and its size on screen in pixels. */
export interface CaptionRequest {
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
}

const boxFor = (
  { x, y, widthPx, heightPx }: CaptionRequest,
  zoom: number,
  place: CaptionPlace,
): CaptionBox => {
  const w = widthPx / zoom;
  const h = heightPx / zoom;
  const m = CAPTION_MARGIN_PX / zoom;
  const left = place.anchor === "start" ? x + place.dx : x + place.dx - w;
  return {
    x0: left - m,
    y0: y + place.dy - h * 0.8 - m,
    x1: left + w + m,
    y1: y + place.dy + h * 0.2 + m,
  };
};

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
}: CaptionRequest & {
  zoom: number;
  avoid: readonly CaptionBox[];
}): CaptionPlace {
  const reach = (4 + 3) / zoom;
  const h = heightPx / zoom;
  const candidates: CaptionPlace[] = [
    { dx: reach, dy: 3 / zoom, anchor: "start" },
    { dx: -reach, dy: 3 / zoom, anchor: "end" },
    { dx: reach, dy: -reach, anchor: "start" },
    { dx: reach, dy: reach + h, anchor: "start" },
    { dx: -reach, dy: -reach, anchor: "end" },
    { dx: -reach, dy: reach + h, anchor: "end" },
  ];
  const request = { x, y, widthPx, heightPx };
  const free = candidates.find((place) => {
    const box = boxFor(request, zoom, place);
    return !avoid.some((other) => overlaps(box, other));
  });
  return free ?? candidates[0];
}

/**
 * Places a diagram's encounter and escape captions one after another, each
 * keeping clear of the names in `avoid` and of every caption placed before it,
 * so two markers close together never print over one another. The result
 * matches `markers` in order.
 */
export function placeEncounterCaptions(
  markers: readonly CaptionRequest[],
  zoom: number,
  avoid: readonly CaptionBox[],
): CaptionPlace[] {
  const taken = [...avoid];
  return markers.map((marker) => {
    const place = placeEncounterCaption({ ...marker, zoom, avoid: taken });
    taken.push(boxFor(marker, zoom, place));
    return place;
  });
}
