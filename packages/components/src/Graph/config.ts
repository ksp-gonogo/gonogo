import type { GraphVariant } from "./types";

export function parseDomain(
  minStr: string,
  maxStr: string,
): [number, number] | undefined {
  if (minStr.trim() === "" || maxStr.trim() === "") return undefined;
  const min = Number(minStr);
  const max = Number(maxStr);
  if (Number.isNaN(min) || Number.isNaN(max) || min >= max) return undefined;
  return [min, max];
}

export function resolveVariantHint(
  variant: GraphVariant,
  seriesCount: number,
): string | undefined {
  if (variant === "readout" && seriesCount !== 1) {
    return "Readout requires exactly one series, falls back to chart until configured.";
  }
  if (variant === "auto") {
    return "Shows the latest number + sparkline when the widget is tiny and a single series is configured. Otherwise renders the chart.";
  }
  return undefined;
}
