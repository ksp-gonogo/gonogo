/**
 * Pointer-interaction stand-ins for the zoom/pan hooks, shared by their two
 * specs so the one unavoidable erasure lives in a single place.
 */

/**
 * A real element with a fixed 200x100 box and the pointer-capture methods
 * jsdom does not implement, which the hooks call on every drag.
 */
export function makeInteractionElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  el.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
  return el;
}

/** The fields a zoom/pan handler reads off a pointer event. */
export interface PointerFields {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  currentTarget?: HTMLDivElement;
}

/**
 * A pointer event carrying those fields.
 *
 * React's synthetic event has no public constructor and is minted by the
 * reconciler, so a spec driving a handler directly cannot build a real one.
 * The erasure is here rather than in each spec.
 */
export function pointerEvent(
  fields: PointerFields,
  el?: HTMLDivElement,
): React.PointerEvent<HTMLDivElement> {
  const currentTarget = fields.currentTarget ?? el;
  if (!currentTarget) {
    throw new Error("a pointer event needs a currentTarget to be handled");
  }
  return {
    pointerId: fields.pointerId ?? 1,
    clientX: fields.clientX ?? 0,
    clientY: fields.clientY ?? 0,
    currentTarget,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}
