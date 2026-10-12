import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWheelGesture } from "./useWheelGesture";

/**
 * Where a diagram is looking: the point of the diagram at the middle of the
 * view, in the diagram's own units, and how many screen pixels one unit takes.
 *
 * @category Layout
 */
export interface PanZoomCamera {
  /** Magnification; 1 draws one diagram unit per pixel. */
  zoom: number;
  /** Diagram x at the middle of the view. */
  panX: number;
  /** Diagram y at the middle of the view. */
  panY: number;
}

/**
 * Tuning for {@link usePanZoom}. Every field is optional.
 *
 * @category Layout
 */
export interface UsePanZoomOptions {
  /** Starting camera, and where {@link UsePanZoomResult.reset} returns to. */
  home?: PanZoomCamera;
  /** Smallest zoom, or a function of the camera for a limit that depends on where the view is centred. A view already outside the limits moves from where it is and is never snapped to one. */
  minZoom?: number | ((camera: PanZoomCamera) => number);
  /** Largest zoom. */
  maxZoom?: number;
  /** `"pointer"` keeps the point under the cursor fixed while zooming; `"centre"` zooms about the middle of the view. */
  zoomAbout?: "pointer" | "centre";
  /** Called on every camera change with the view size, to hold the camera inside the diagram. */
  constrain?: (
    camera: PanZoomCamera,
    size: { w: number; h: number },
  ) => PanZoomCamera;
  /** Pixels a pointer must travel before a press counts as a pan rather than a click. */
  panThreshold?: number;
  /** `false` leaves the wheel unbound, for a diagram that has nothing to zoom yet. */
  enabled?: boolean;
  /** Element that takes the gestures, when the caller already holds a ref to it (for a size measurement); otherwise the hook makes its own. */
  elementRef?: RefObject<HTMLDivElement | null>;
  /** Called whenever the operator moves the view by hand, so a caller following something can stop following or an eased move can stop. */
  onManualMove?: (kind: "pan" | "zoom" | "reset") => void;
}

/**
 * Everything a diagram element needs from {@link usePanZoom}: spread it on
 * the element that holds the drawing.
 *
 * @category Layout
 */
export interface PanZoomViewportProps {
  /** The element the wheel rule and the size measurement read. */
  ref: RefObject<HTMLDivElement | null>;
  /** Makes the diagram focusable, so the keyboard can pan and zoom it. */
  tabIndex: 0;
  /** A group, named by the label the diagram is given. */
  role: "group";
  /** Starts a drag, or a pinch on the second pointer. */
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Pans a drag and zooms a pinch. */
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Ends a drag, or one finger of a pinch. */
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Ends a drag or pinch the browser took over. */
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Shows the keyboard note when focus arrives by keyboard. */
  onFocus: (e: React.FocusEvent<HTMLDivElement>) => void;
  /** Hides the keyboard note when focus leaves the diagram. */
  onBlur: () => void;
  /** Arrow keys pan, plus and minus zoom and 0 resets. */
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Turns off the browser's own touch panning and shows the grab cursor. */
  style: { touchAction: "none"; cursor: "grab" | "grabbing" };
}

/**
 * What {@link usePanZoom} hands back.
 *
 * @category Layout
 */
export interface UsePanZoomResult {
  /** Where the diagram is looking now. */
  camera: PanZoomCamera;
  /** Puts the camera somewhere outright, for a caller that moves the view itself (an eased move, a follow). */
  setCamera: (
    next: PanZoomCamera | ((prev: PanZoomCamera) => PanZoomCamera),
  ) => void;
  /** Returns the camera to `home`. */
  reset: () => void;
  /** Zooms by a ratio about the middle of the view; for a zoom button. */
  zoomBy: (factor: number) => void;
  /** Spread on the diagram's element. */
  viewportProps: PanZoomViewportProps;
  /** True while a press has travelled past `panThreshold`; read it in a click handler to ignore the click that ends a drag. */
  didPan: () => boolean;
  /** True while a drag is in progress, for a grabbing cursor. */
  isDragging: boolean;
  /** The one-line note on operating the diagram from the keyboard, shown while it has keyboard focus; `null` otherwise. */
  hint: string | null;
}

const FOCUS_HINT = "Arrow keys pan, + and - zoom, 0 resets";
const KEY_PAN_FRACTION = 0.15;
const KEY_ZOOM = 1.25;

const ORIGIN: PanZoomCamera = { zoom: 1, panX: 0, panY: 0 };

/**
 * Pan, zoom, reset and keyboard operation for a diagram, with the wheel rule
 * of {@link useWheelGesture}: a turn of the wheel zooms only if it began with
 * the pointer inside the diagram. Drag pans, two fingers pinch, Ctrl plus
 * wheel always zooms, the arrow keys pan, plus and minus zoom and 0 resets
 * once the element has focus. Useful for letting an operator look closely at
 * part of a system diagram or a map without the diagram taking over the
 * dashboard's scrolling. Used by the system, map and ship diagrams.
 *
 * @category Layout
 */
export function usePanZoom(options: UsePanZoomOptions = {}): UsePanZoomResult {
  const {
    home = ORIGIN,
    zoomAbout = "pointer",
    panThreshold = 3,
    enabled = true,
  } = options;
  const [camera, setHeld] = useState<PanZoomCamera>(home);
  const live = useRef({ camera, options, home });
  live.current = { camera, options, home };
  const ownRef = useRef<HTMLDivElement | null>(null);
  const ref = options.elementRef ?? ownRef;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ref` is a ref object whose element is read at call time
  const sizeOf = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    return { w: rect?.width ?? 0, h: rect?.height ?? 0 };
  }, []);

  const apply = useCallback(
    (next: PanZoomCamera) => {
      const { constrain } = live.current.options;
      const size = sizeOf();
      const held =
        constrain && size.w > 0 && size.h > 0 ? constrain(next, size) : next;
      live.current.camera = held;
      setHeld(held);
      return held;
    },
    [sizeOf],
  );

  const setCamera = useCallback(
    (next: PanZoomCamera | ((prev: PanZoomCamera) => PanZoomCamera)) => {
      apply(typeof next === "function" ? next(live.current.camera) : next);
    },
    [apply],
  );

  const zoomAt = useCallback(
    (factor: number, mx: number, my: number): boolean => {
      const prev = live.current.camera;
      const { minZoom = 0.1, maxZoom = 50 } = live.current.options;
      const floor = typeof minZoom === "function" ? minZoom(prev) : minZoom;
      const zoom = Math.max(
        Math.min(floor, prev.zoom),
        Math.min(Math.max(maxZoom, prev.zoom), prev.zoom * factor),
      );
      if (zoom === prev.zoom) return false;
      const { w, h } = sizeOf();
      if (zoomAbout === "centre") {
        apply({ ...prev, zoom });
      } else {
        const wx = (mx - w / 2) / prev.zoom + prev.panX;
        const wy = (my - h / 2) / prev.zoom + prev.panY;
        apply({
          zoom,
          panX: wx - (mx - w / 2) / zoom,
          panY: wy - (my - h / 2) / zoom,
        });
      }
      live.current.options.onManualMove?.("zoom");
      return true;
    },
    [apply, sizeOf, zoomAbout],
  );

  useWheelGesture(
    ref,
    useMemo(() => (enabled ? zoomAt : null), [enabled, zoomAt]),
  );

  const reset = useCallback(() => {
    live.current.options.onManualMove?.("reset");
    apply(live.current.home);
  }, [apply]);

  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h } = sizeOf();
      zoomAt(factor, w / 2, h / 2);
    },
    [sizeOf, zoomAt],
  );

  const [hint, setHint] = useState<string | null>(null);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastPan = useRef<{ x: number; y: number } | null>(null);
  const lastPinch = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const panned = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      lastPan.current = null;
      lastPinch.current = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    panned.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    lastPan.current = { x: e.clientX, y: e.clientY };
    lastPinch.current = null;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ref` is a ref object whose element is read at call time
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const before = lastPinch.current;
        lastPinch.current = dist;
        if (before === null || before === 0) return;
        const rect = ref.current?.getBoundingClientRect();
        panned.current = true;
        zoomAt(
          dist / before,
          (a.x + b.x) / 2 - (rect?.left ?? 0),
          (a.y + b.y) / 2 - (rect?.top ?? 0),
        );
        return;
      }
      const start = pressStart.current;
      const last = lastPan.current;
      if (!start || !last) return;
      if (
        !panned.current &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) < panThreshold
      ) {
        return;
      }
      if (!panned.current) {
        panned.current = true;
        setIsDragging(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      lastPan.current = { x: e.clientX, y: e.clientY };
      const prev = live.current.camera;
      live.current.options.onManualMove?.("pan");
      apply({
        ...prev,
        panX: prev.panX - dx / prev.zoom,
        panY: prev.panY - dy / prev.zoom,
      });
    },
    [apply, panThreshold, zoomAt],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (pointers.current.size === 1) {
      const [remaining] = [...pointers.current.values()];
      lastPan.current = { ...remaining };
      pressStart.current = { ...remaining };
      lastPinch.current = null;
      return;
    }
    if (pointers.current.size === 0) {
      lastPan.current = null;
      pressStart.current = null;
      lastPinch.current = null;
      setIsDragging(false);
    }
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const prev = live.current.camera;
      const { w, h } = sizeOf();
      const step = (axis: "panX" | "panY", sign: number) => {
        const span = (axis === "panX" ? w : h) / prev.zoom;
        live.current.options.onManualMove?.("pan");
        apply({ ...prev, [axis]: prev[axis] + sign * span * KEY_PAN_FRACTION });
      };
      switch (e.key) {
        case "ArrowLeft":
          step("panX", -1);
          break;
        case "ArrowRight":
          step("panX", 1);
          break;
        case "ArrowUp":
          step("panY", -1);
          break;
        case "ArrowDown":
          step("panY", 1);
          break;
        case "+":
        case "=":
          zoomBy(KEY_ZOOM);
          break;
        case "-":
        case "_":
          zoomBy(1 / KEY_ZOOM);
          break;
        case "0":
          reset();
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [apply, reset, sizeOf, zoomBy],
  );

  const viewportProps: PanZoomViewportProps = {
    ref,
    tabIndex: 0,
    role: "group",
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onFocus: (e) => {
      if (
        e.target === e.currentTarget &&
        e.currentTarget.matches(":focus-visible")
      ) {
        setHint(FOCUS_HINT);
      }
    },
    onBlur: () => setHint(null),
    onKeyDown,
    style: { touchAction: "none", cursor: isDragging ? "grabbing" : "grab" },
  };

  return {
    camera,
    setCamera,
    reset,
    zoomBy,
    viewportProps,
    didPan: () => panned.current,
    isDragging,
    hint,
  };
}
