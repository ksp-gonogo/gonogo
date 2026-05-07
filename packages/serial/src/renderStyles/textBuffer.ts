import { logger } from "@gonogo/logger";
import { registerSerialRenderStyle } from "../registry";
import type { DeviceRenderStyle } from "../types";

const DEFAULT_WIDTH = 21;
const DEFAULT_HEIGHT = 8;

function formatValue(value: unknown): string {
  if (value === true) return "ON";
  if (value === false) return "OFF";
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  if (typeof value === "string") return value;
  // Objects / arrays: explicit JSON rather than Object's default
  // "[object Object]" stringify (S6551).
  return JSON.stringify(value);
}

function padLine(line: string, width: number): string {
  if (line.length > width) return line.slice(0, width);
  return line.padEnd(width, " ");
}

function coerceDim(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return fallback;
}

/**
 * Fixed-width ASCII grid, joined by `\n` (no trailing newline). Dimensions
 * are read from `config.w` / `config.h` — defaults 21×8 for the canonical
 * small LCD. Each entry in `merged` becomes one line formatted as
 * `KEY VALUE`; entries are sorted by key for deterministic output. Extra
 * entries beyond `h` are dropped, empty rows are all-space.
 */
export const textBuffer: DeviceRenderStyle = {
  id: "text-buffer",
  name: "Text Buffer",
  description:
    "Fixed-width ASCII grid. Takes {w, h} from renderStyleConfig; defaults 21×8.",
  render(merged, config) {
    const width = coerceDim(config?.w, DEFAULT_WIDTH);
    const height = coerceDim(config?.h, DEFAULT_HEIGHT);

    const entries = Object.entries(merged)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, height);

    const lines: string[] = [];
    for (const [key, value] of entries) {
      const formatted = formatValue(value);
      lines.push(padLine(formatted ? `${key} ${formatted}` : key, width));
    }
    while (lines.length < height) {
      lines.push(" ".repeat(width));
    }
    logger.info(lines.join(""));
    return `${lines.join("")}\n`;
  },
};

/**
 * Backward-compat alias for the original 21×8 style id — any DeviceType
 * saved with `renderStyleId: "text-buffer-168"` continues to render at
 * 21×8 without needing a migration. New code should reference "text-buffer"
 * with a `{ w, h }` config instead.
 */
export const textBuffer168: DeviceRenderStyle = {
  id: "text-buffer-168",
  name: "Text Buffer (21×8)",
  description:
    "Eight 21-character lines — the canonical small LCD panel. Alias for the generalised text-buffer style.",
  render: (merged) =>
    textBuffer.render(merged, { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }),
};

registerSerialRenderStyle(textBuffer);
registerSerialRenderStyle(textBuffer168);
