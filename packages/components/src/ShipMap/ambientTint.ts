/**
 * Ambient external temperature (kelvin) to a background tint, blue when cold
 * through clear to amber and red. `null` with no signal. Alpha capped at 0.25
 * so per-part heat tints stay visible.
 */
export function externalTempTint(temperatureK: number | null): string | null {
  if (temperatureK === null) return null;
  // Anchor points: 200 K = deep cold (subtle blue), 290 K = ambient (clear), 600 K = warning amber, 1500+ K = reentry red.
  if (temperatureK <= 250) {
    const alpha = Math.min(0.18, (290 - temperatureK) / 600);
    return `rgba(80, 140, 220, ${alpha.toFixed(3)})`;
  }
  if (temperatureK <= 320) return null;
  if (temperatureK <= 1500) {
    const t = (temperatureK - 320) / (1500 - 320);
    // Blend amber → red across the band.
    const r = Math.round(255);
    const g = Math.round(170 - 130 * t);
    const b = Math.round(60 - 40 * t);
    const alpha = (0.08 + 0.17 * t).toFixed(3);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return "rgba(255, 40, 20, 0.25)";
}
