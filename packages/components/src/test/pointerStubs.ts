/** Pointer-interaction stand-ins for the zoom/pan hooks' specs. */

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

/** A pointer event carrying those fields. React's synthetic event has no public constructor, so the erasure lives here. */
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
  } as React.PointerEvent<HTMLDivElement>;
}
