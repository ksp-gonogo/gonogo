/** How many recent intervals the median is taken over. */
const STEP_HISTORY = 5;

/**
 * Measures how often the latest confirmed sample time advances, in wall-clock
 * seconds, as the median of the last few intervals between advances. A burst of
 * samples a frame apart does not shorten it, and a change of telemetry rate
 * shows in it after a few advances.
 */
export class SampleStepTracker {
  private lastValue = Number.NEGATIVE_INFINITY;
  private lastStepWall: number | null = null;
  private intervals: number[] = [];

  /** Call with the latest sample time on every update and the wall-clock time of it. */
  observe(maxSampleUt: number, nowWall: number): void {
    if (maxSampleUt <= this.lastValue) return;
    this.lastValue = maxSampleUt;
    if (this.lastStepWall !== null) {
      this.intervals.push(nowWall - this.lastStepWall);
      if (this.intervals.length > STEP_HISTORY) this.intervals.shift();
    }
    this.lastStepWall = nowWall;
  }

  /** The measured interval, or `undefined` until two advances have been seen. */
  stepSeconds(): number | undefined {
    if (this.intervals.length === 0) return undefined;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  reset(): void {
    this.lastValue = Number.NEGATIVE_INFINITY;
    this.lastStepWall = null;
    this.intervals = [];
  }
}
