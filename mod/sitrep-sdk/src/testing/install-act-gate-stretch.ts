/**
 * The variable the act-warning gate sets to the number of frames it wants held.
 *
 * @category Test hosts
 */
export const ACT_GATE_STRETCH_ENV = "GONOGO_ACT_GATE_STRETCH_FRAMES";

type AfterEach = (fn: () => Promise<void>) => void;

const FRAME_MS = 1000 / 60;

/**
 * Holds every test's component tree mounted for a fixed number of animation frames
 * after its body returns, when the act-warning gate asks for it. Inert otherwise:
 * with `GONOGO_ACT_GATE_STRETCH_FRAMES` unset it registers nothing and imports
 * nothing.
 *
 * An update scheduled on a timer or an animation frame after the body lands only
 * if the tree is still mounted when it fires. Unstretched, that depends on how long
 * the runner takes to get from the body to Testing Library's auto-cleanup, so a slow
 * machine counts the warning and a fast one unmounts first and counts nothing.
 *
 * The hold is counted in frames rather than milliseconds so the number it produces
 * is exact: a clock that ticks on every frame ticks once per held frame, on any
 * machine. Frame callbacks run in the order they were requested, so a clock already
 * mounted runs ahead of the hold in each frame and every one of its ticks lands
 * before the unmount. Where there is no `requestAnimationFrame` (a `node`
 * environment), the hold is the same number of frame intervals on a timer.
 *
 * The hook has to run BEFORE the auto-cleanup, and vitest runs `afterEach` hooks in
 * reverse registration order. So Testing Library is imported first, which registers
 * its cleanup, and the hold is registered after it. That is a hook-ordering
 * dependency, and it is accepted here because a broken order makes the gate
 * under-provoke rather than hide anything: the gate plants a test that updates one
 * frame after its body in every package it measures, and fails as BLIND if that
 * plant is not counted.
 *
 * Call it last in a vitest setup file, and await it.
 *
 * @category Test hosts
 */
export async function installActGateStretch(): Promise<void> {
  const raw =
    typeof process === "undefined"
      ? undefined
      : process.env[ACT_GATE_STRETCH_ENV];
  if (raw === undefined || raw === "") return;

  const frames = Number(raw);
  if (!Number.isInteger(frames) || frames <= 0) {
    throw new Error(
      `${ACT_GATE_STRETCH_ENV} must be a positive whole number of frames, got "${raw}".`,
    );
  }

  const afterEach = (globalThis as { afterEach?: AfterEach }).afterEach;
  if (typeof afterEach !== "function") {
    throw new Error(
      `${ACT_GATE_STRETCH_ENV} is set but no global afterEach exists. Testing ` +
        "Library only auto-cleans under vitest's `globals: true`, and the hold " +
        "has to be ordered against that cleanup.",
    );
  }

  await import("@testing-library/react");

  // Captured now, so a test that installs fake timers cannot freeze the hold.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const realFrame =
    typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : null;

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        if (!realFrame) {
          realSetTimeout(resolve, frames * FRAME_MS);
          return;
        }
        // A test that leaves fake timers installed can stall the frame clock, and a stalled clock has nothing left to deliver, so the hold ends on a timer.
        const cap = realSetTimeout(resolve, frames * FRAME_MS * 10);
        let held = 0;
        const next = () => {
          held += 1;
          if (held < frames) {
            realFrame(next);
            return;
          }
          realClearTimeout(cap);
          resolve();
        };
        realFrame(next);
      }),
  );
}
