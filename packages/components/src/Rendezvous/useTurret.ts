import { useEffect, useRef, useState } from "react";
import { LEVELS_FOR, type RendezvousLevel, type TargetClass } from "./levels";

/** How long one step of the turret takes, milliseconds. */
export const STEP_MS = 900;

/**
 * How long after the view appears its channels may still be arriving one after
 * the other, so a level change inside it lands at once instead of being
 * turned through.
 */
export const SETTLE_MS = 1500;

/** The levels passed through, one at a time, from `from` to `to` in the order a target's kind zooms through them. */
export function stepsBetween(
  target: TargetClass,
  from: RendezvousLevel,
  to: RendezvousLevel,
): RendezvousLevel[] {
  const order = LEVELS_FOR[target];
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return [];
  const dir = b > a ? 1 : -1;
  const out: RendezvousLevel[] = [];
  for (let i = a + dir; ; i += dir) {
    out.push(order[i]);
    if (i === b) break;
  }
  return out;
}

/** A step in progress: the lower level of the pair, how far it has turned (0 to 1 as it goes in) and which way. */
export interface Step {
  lower: RendezvousLevel;
  upper: RendezvousLevel;
  /** 0 with the lower level large, 1 with the upper level large. Runs 0 to 1 going in, 1 to 0 coming out. */
  u: number;
  goingIn: boolean;
}

/** Whether the operator has asked for less motion. Read once per mount. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Walks the large circle to the wanted level one step at a time, animating
 * each as a turn of the turret. With reduced motion, or no animation frames,
 * it lands on the wanted level at once and no step is ever in progress.
 */
export function useTurret(
  target: TargetClass,
  wanted: RendezvousLevel,
): { shown: RendezvousLevel; step: Step | null } {
  const [shown, setShown] = useState(wanted);
  const [step, setStep] = useState<Step | null>(null);
  const frame = useRef<number | null>(null);
  const settled = useRef(false);

  // A step requested while the widget is only just mounting lands at once: the circles are still being worked out.
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function" || prefersReducedMotion()) {
      settled.current = true;
      return;
    }
    let first: number | null = null;
    let id = 0;
    const watch = (now: number) => {
      first ??= now;
      if (now - first >= SETTLE_MS) {
        settled.current = true;
        return;
      }
      id = requestAnimationFrame(watch);
    };
    id = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (step !== null || shown === wanted) return;
    const path = stepsBetween(target, shown, wanted);
    const next = path[0];
    const settling = !settled.current;
    if (
      next === undefined ||
      settling ||
      prefersReducedMotion() ||
      typeof requestAnimationFrame !== "function"
    ) {
      setShown(wanted);
      return;
    }
    const order = LEVELS_FOR[target];
    const goingIn = order.indexOf(next) > order.indexOf(shown);
    const lower = goingIn ? shown : next;
    const upper = goingIn ? next : shown;
    let started: number | null = null;
    const tick = (now: number) => {
      started ??= now;
      const t = Math.max(0, Math.min(1, (now - started) / STEP_MS));
      setStep({ lower, upper, u: goingIn ? t : 1 - t, goingIn });
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        frame.current = null;
        setStep(null);
        setShown(next);
      }
    };
    setStep({ lower, upper, u: goingIn ? 0 : 1, goingIn });
    frame.current = requestAnimationFrame(tick);
  }, [target, shown, wanted, step]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { shown, step };
}
