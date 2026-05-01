export interface SlopeSample {
  x: number;
  y: number;
}

export interface SlopeFitResult {
  slope: number;
  /** Latest y value in the input — useful when projecting against a target. */
  latestY: number;
}

/**
 * Least-squares linear regression over `(x, y)` samples. Returns `null` when
 * there are too few points or the inputs are degenerate (zero spread on x).
 *
 * The x values are normalised against the first sample to keep precision when
 * the absolute magnitudes are large (e.g. KSP universal time in seconds).
 */
export function slopeFit(
  samples: readonly SlopeSample[],
): SlopeFitResult | null {
  if (samples.length < 2) return null;
  const x0 = samples[0].x;
  const n = samples.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const s of samples) {
    const x = s.x - x0;
    const y = s.y;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  return { slope, latestY: samples[samples.length - 1].y };
}
