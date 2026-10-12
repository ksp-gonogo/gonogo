export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const norm = (v: number, min: number, max: number) =>
  clamp01((v - min) / (max - min));

const rgb = (r: number, g: number, b: number) => [r, g, b] as const;

const blend = (a: readonly number[], b: readonly number[], t: number) =>
  rgb(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));

export const getTrajectoryStyle = ({
  alt,
  maxAtmosphere,
  hasAtmosphere,
  q,
  mach,
  speed,
  vSpeed: _vSpeed,
}: {
  alt: number;
  maxAtmosphere: number;
  hasAtmosphere: boolean;
  /** Dynamic pressure, kPa. */
  q?: number;
  mach?: number;
  speed?: number;
  vSpeed?: number;
}) => {
  const atmT = norm(alt, 0, maxAtmosphere);
  const orbT = norm(alt, maxAtmosphere, maxAtmosphere * 1.3);

  // A figure the record did not carry adds nothing to the style, which is not the same claim as a measured zero.
  const qT = q === undefined ? 0 : norm(q, 0, 50);
  const machT = mach === undefined ? 0 : norm(mach, 0, 5);
  const speedT = speed === undefined ? 0 : norm(speed, 0, 2500);

  const base = !hasAtmosphere
    ? blend(rgb(0, 0, 255), rgb(0, 255, 0), orbT)
    : alt < maxAtmosphere
      ? blend(rgb(255, 80, 0), rgb(0, 0, 255), atmT)
      : blend(rgb(0, 0, 255), rgb(0, 255, 0), orbT);

  const pressure = blend(base, rgb(255, 120, 0), qT * 0.5);
  const machFx = blend(pressure, rgb(255, 255, 255), machT * 0.25);

  const alpha = lerp(0.2, 0.7, qT + (1 - atmT));
  const width = lerp(1, 5.5, atmT * atmT) + speedT * 1.5 + qT;

  return { color: machFx, alpha, width };
};
