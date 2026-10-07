/**
 * The environment variable that turns {@link installActGateStretch} on. Set it
 * to the number of animation frames to hold each test's tree mounted, a
 * positive whole number such as `3`. There is no default: while it is unset,
 * nothing is held.
 *
 * @category Test hosts
 */
export const ACT_GATE_STRETCH_ENV = "GONOGO_ACT_GATE_STRETCH_FRAMES";

type AfterEach = (fn: () => Promise<void>) => void;

const FRAME_MS = 1000 / 60;

/**
 * Keeps each test's component tree mounted for a set number of animation
 * frames after the test body returns, so an update scheduled shortly after the
 * body is caught on every machine, fast or slow. Such an update is one React
 * warns about as "not wrapped in act(...)": the test finished while the
 * component was still changing, and on a fast machine the tree is gone before
 * the warning can be raised. You turn it on for a run by
 * setting {@link ACT_GATE_STRETCH_ENV} to the number of frames; it does nothing
 * while the variable is unset, and throws when it is set to anything but a
 * positive whole number.
 *
 * Call it last in a vitest setup file, after Testing Library is imported, and
 * await it.
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
