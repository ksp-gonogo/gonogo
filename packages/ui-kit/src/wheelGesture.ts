/**
 * Decides which wheel events belong to a diagram and which to the page around
 * it. A gesture is a run of wheel events with no quiet gap longer than
 * `quietMs`; inertial trackpad scrolling keeps sending events, so it stays one
 * gesture to the end. The gesture belongs to the diagram only when its first
 * event had the pointer inside the diagram, and only if the pointer was not
 * left still while the page scrolled the diagram under it.
 *
 * Used by {@link useWheelGesture}.
 *
 * @category Layout
 */
export interface WheelGestureOptions {
  /** Longest pause, in milliseconds, between two wheel events of one gesture. */
  quietMs?: number;
}

/**
 * Who a wheel event belongs to: the diagram under the pointer or the page
 * around it. Returned by {@link WheelGesture}.
 *
 * @category Layout
 */
export type WheelOwner = "diagram" | "page";

/**
 * The state behind the wheel rule, driven with timestamps so a sequence of
 * events can be replayed without a browser. Used by {@link useWheelGesture}.
 *
 * @category Layout
 */
export interface WheelGesture {
  /** Records a wheel event anywhere on the page and returns who its gesture belongs to. */
  wheel(at: number, pointerInside: boolean): WheelOwner;
  /** Records that the page scrolled, which moves the diagram under a pointer that did not move. */
  pageScrolled(): void;
  /** Records that the pointer really moved while over the diagram, which is the operator choosing it. */
  pointerMovedInside(): void;
  /** Hands the rest of the current gesture to the page, for a diagram that has nothing left to zoom. */
  yieldToPage(): void;
  /** Who the most recent wheel event's gesture belongs to; `null` before any. */
  readonly owner: WheelOwner | null;
}

/** A pause this long ends a gesture: longer than inertial trackpad gaps, shorter than a deliberate second turn of the wheel. */
export const WHEEL_QUIET_MS = 200;

/**
 * Builds the wheel rule's state. Useful for testing the rule against a
 * recorded event sequence. Used by {@link useWheelGesture}.
 *
 * @intent Published so an Uplink can test a diagram of its own against a recorded wheel event sequence, as the kit does for its own surfaces.
 * @category Layout
 */
export function createWheelGesture(
  options: WheelGestureOptions = {},
): WheelGesture {
  const quietMs = options.quietMs ?? WHEEL_QUIET_MS;
  let owner: WheelOwner | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  /*
   * A page that scrolls under a still pointer brings the diagram to the
   * pointer without the operator aiming at it, however slowly the notches
   * come. Nothing but a real pointer move over the diagram says it was meant.
   */
  let aimed = true;
  return {
    wheel(at, pointerInside) {
      if (owner === null || at - lastAt > quietMs) {
        owner = pointerInside && aimed ? "diagram" : "page";
      }
      lastAt = at;
      return owner;
    },
    pageScrolled() {
      aimed = false;
    },
    pointerMovedInside() {
      aimed = true;
    },
    yieldToPage() {
      owner = "page";
    },
    get owner() {
      return owner;
    },
  };
}

const LINE_PX = 16;
const PAGE_PX = 400;
const MAX_STEP_PX = 120;
/** A 100 px mouse notch is a 1.15 step. */
const NOTCH_RATE = Math.log(1.15) / 100;
const PINCH_RATE = 0.01;

/**
 * The zoom ratio one wheel event asks for: above 1 zooms in. A mouse notch
 * is 1.15, a trackpad pinch (small fractional deltas under Ctrl) is
 * scaled up so it keeps pace with the fingers. Used by {@link useWheelGesture}.
 *
 * @intent Published so a third party drawing a surface that is not a plane, such as a canvas viewer, scales a notch and a pinch the same way the kit does.
 * @category Layout
 */
export function wheelZoomFactor(
  deltaY: number,
  deltaMode: number,
  pinch: boolean,
): number {
  const px =
    deltaMode === 1
      ? deltaY * LINE_PX
      : deltaMode === 2
        ? deltaY * PAGE_PX
        : deltaY;
  const clamped = Math.max(-MAX_STEP_PX, Math.min(MAX_STEP_PX, px));
  const rate = pinch && Math.abs(px) < 40 ? PINCH_RATE : NOTCH_RATE;
  return Math.exp(-clamped * rate);
}
