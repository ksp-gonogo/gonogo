/**
 * How the rail DRAWS an entry, given what the entry says it is.
 *
 * The three axes and the derivations that fill them in live in the SDK
 * (`@ksp-gonogo/sitrep-sdk`'s `rail-tags.ts`), because they are read off what
 * the mod declares. This file is the other half: one accessor per axis, and a
 * TABLE saying which combination each renderer draws.
 *
 * | direction | continuity | delivery         | a real example                  | drawn by           |
 * |-----------|------------|------------------|---------------------------------|--------------------|
 * | command   | discrete   | acked            | staging, an action group        | `in-flight-row`    |
 * | command   | continuous | acked            | fly-by-wire, ack = the readback | `continuous-strip` |
 * | telemetry | continuous | fire-and-forget  | radio voice                     | `continuous-strip` |
 * | telemetry | discrete   | fire-and-forget  | a science result sent home      | `in-flight-row`    |
 *
 * The table names a RENDERER (a component). WHICH MARK it draws follows from
 * the data: both continuous rows share one strip, lines for a value against a
 * readback, a trace for an amplitude history.
 *
 * A combination with no renderer reads as `null`, `unrepresentedRailTags()`
 * names it, and an entry carrying it is reported rather than silently omitted
 * or drawn wrongly. A new row costs an entry here plus the renderer it names.
 *
 * Each axis drives exactly ONE visual property.
 */

import type {
  RailContinuity,
  RailDelivery,
  RailDirection,
  RailTags,
} from "@ksp-gonogo/sitrep-sdk";
import { hasHost, logger } from "@ksp-gonogo/sitrep-sdk";

export type {
  RailContinuity,
  RailDelivery,
  RailDirection,
  RailTags,
} from "@ksp-gonogo/sitrep-sdk";

/** The CONTINUITY axis, and only it: a point travelling, or a span lying along. */
export function railMark(tags: RailTags): "dot" | "ribbon" {
  return tags.continuity === "continuous" ? "ribbon" : "dot";
}

/** The DELIVERY axis, and only it: whether anything is drawn coming back. */
export function railDrawsReturnLeg(tags: RailTags): boolean {
  return tags.delivery === "acked";
}

/** The DIRECTION axis, and only it: which way along the rail the entry runs. */
export function railFlow(tags: RailTags): "outbound" | "inbound" {
  return tags.direction === "command" ? "outbound" : "inbound";
}

/**
 * The DIRECTION axis, and only it, as a theme token NAME (no `var()` wrapper):
 * accent for orders leaving, info for news arriving.
 */
export function railToneToken(tags: RailTags): string {
  return tags.direction === "command"
    ? "--color-accent-fg"
    : "--color-info-mark";
}

/** Every value of each axis, in the order the table above reads. */
const DIRECTIONS: readonly RailDirection[] = ["command", "telemetry"];
const CONTINUITIES: readonly RailContinuity[] = ["discrete", "continuous"];
const DELIVERIES: readonly RailDelivery[] = ["acked", "fire-and-forget"];

/** One combination, spelled as the table's key; a template-literal type, so the table cannot hold a typo. */
export type RailTagKey = `${RailDirection}/${RailContinuity}/${RailDelivery}`;

export function railTagKey(tags: RailTags): RailTagKey {
  return `${tags.direction}/${tags.continuity}/${tags.delivery}`;
}

/**
 * What actually draws an entry. Two components, and there are only two:
 *
 * - `in-flight-row`: a row in `InFlightList`, the discrete queue
 * - `continuous-strip`: `ControlDelayStream`, the three-zone graph, whichever
 *   mark the entry's data calls for inside it
 */
export type RailRenderer = "in-flight-row" | "continuous-strip";

/** Which renderer draws which combination. `Partial`: an absent combination has NO renderer, never a fallback. */
const RAIL_RENDERERS: Partial<Record<RailTagKey, RailRenderer>> = {
  "command/discrete/acked": "in-flight-row",
  "command/continuous/acked": "continuous-strip",
  "telemetry/continuous/fire-and-forget": "continuous-strip",
  "telemetry/discrete/fire-and-forget": "in-flight-row",
};

/**
 * The renderer for an entry, or `null` when nothing draws that combination. A
 * caller handed `null` reports it ({@link reportUnrepresentedRail}) rather than
 * rendering nothing quietly.
 */
export function railRendererFor(tags: RailTags): RailRenderer | null {
  return RAIL_RENDERERS[railTagKey(tags)] ?? null;
}

/** Every combination of the three axes: the whole product, eight of them. */
export function allRailTags(): RailTags[] {
  const out: RailTags[] = [];
  for (const direction of DIRECTIONS)
    for (const continuity of CONTINUITIES)
      for (const delivery of DELIVERIES)
        out.push({ direction, continuity, delivery });
  return out;
}

/** The combinations nothing can draw, as a value the tree can assert on. */
export function unrepresentedRailTags(): RailTags[] {
  return allRailTags().filter((tags) => railRendererFor(tags) === null);
}

/** Combinations already reported, keyed by combination rather than entry, so a frame-rate re-render says it once. */
const reportedUnrepresented = new Set<RailTagKey>();

/**
 * Reports that an entry declared something the rail cannot draw, naming the
 * combination and who declared it. Never throws, so the widget survives. Falls
 * back to `console.error` without a host, because the sdk's `logger` throws
 * when none is installed.
 */
export function reportUnrepresentedRail(tags: RailTags, who: string): void {
  const key = railTagKey(tags);
  if (reportedUnrepresented.has(key)) return;
  reportedUnrepresented.add(key);
  const message =
    `Delay rail entry "${who}" is tagged ${key}, and no renderer draws that ` +
    `combination, so it will not appear on the rail. Declare a renderer for it ` +
    `in ui-kit's railTags.ts, or correct the entry's tags.`;
  if (hasHost()) logger.error(message);
  else console.error(message);
}

/** Test-only: forget what has been reported. Not on the published barrel. */
export function resetUnrepresentedRailReports(): void {
  reportedUnrepresented.clear();
}
