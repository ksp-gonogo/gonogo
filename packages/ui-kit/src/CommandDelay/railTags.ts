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
 * | telemetry | discrete   | fire-and-forget  | a science result sent home      | NOTHING YET        |
 *
 * The table names a RENDERER, which is a component, and stops there. WHICH MARK
 * that component draws is `railMark`'s answer and the data's: two continuous
 * entries share one strip, and a control axis reporting a value against a
 * readback is drawn as lines while a microphone reporting how loud each 20 ms
 * chunk was is drawn as a trace. That is a difference in the DATA and not in
 * what the entry is, which is why both rows point at the same renderer. A table
 * that gave them separate renderers would be back to a component per row, which
 * is how the voice ribbon got its own strip.
 *
 * **The table is the whole point, and the fourth row is why.** Three of the four
 * rows an operator can name have a renderer; the fourth is declarable today and
 * nothing can draw it, so it reads as `null` here, `unrepresentedRailTags()`
 * names it, and an entry that arrives carrying it is reported rather than
 * silently omitted. A rail that grew a new component per row is how the voice
 * ribbon ended up on a second strip with its boundary at 98% of the widget; a
 * rail that quietly drew nothing is how a declared entry would vanish. The
 * table's job is to make both impossible: a new row costs an entry here plus the
 * renderer it names, and until it has one it is visibly missing rather than
 * absent.
 *
 * Each axis drives exactly ONE visual property, and `railTags.test.ts` asserts
 * that one-to-one rather than leaving it as prose: an accessor that started
 * reading a second axis would be a special case wearing the vocabulary of a
 * model.
 */

import type {
  RailContinuity,
  RailDelivery,
  RailDirection,
  RailTags,
} from "@ksp-gonogo/sitrep-sdk";
import { hasHost, logger } from "@ksp-gonogo/sitrep-sdk";

/*
 * Re-exported, not re-declared. An identical copy of a published type in a
 * second published package is the shape that drifts silently, and this one has
 * two audiences that must agree: an Uplink declares a rail entry against the
 * SDK's vocabulary and hands it to this kit to draw.
 */
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
 * The DIRECTION axis, and only it, as a theme token NAME (no `var()` wrapper,
 * so a caller can put it in a custom property as easily as in a fill).
 *
 * Both tokens are ones the rail already speaks: accent is the colour an
 * in-flight command wears in `InFlightList`, and the info token is what the
 * rail's found-summary uses for news arriving rather than orders leaving.
 */
export function railToneToken(tags: RailTags): string {
  return tags.direction === "command"
    ? "--color-accent-fg"
    : "--color-status-info-fg";
}

/** Every value of each axis, in the order the table above reads. */
const DIRECTIONS: readonly RailDirection[] = ["command", "telemetry"];
const CONTINUITIES: readonly RailContinuity[] = ["discrete", "continuous"];
const DELIVERIES: readonly RailDelivery[] = ["acked", "fire-and-forget"];

/**
 * One combination, spelled as the table's key. A template-literal type rather
 * than `string`, so the renderer table below cannot hold a key that is not a
 * real combination and cannot miss one by a typo.
 */
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

/**
 * Which renderer draws which combination. `Partial`, deliberately: a
 * combination absent here has NO renderer, which is a fact about the rail worth
 * being able to state rather than a hole to be filled with a fallback.
 *
 * A fallback is what the rail had. Every entry was drawn as a discrete acked
 * command because that was the only picture, so an entry that was something else
 * was drawn wrongly instead of not at all.
 */
const RAIL_RENDERERS: Partial<Record<RailTagKey, RailRenderer>> = {
  "command/discrete/acked": "in-flight-row",
  "command/continuous/acked": "continuous-strip",
  "telemetry/continuous/fire-and-forget": "continuous-strip",
};

/**
 * The renderer for an entry, or `null` when nothing draws that combination.
 *
 * `null` is not an error to swallow. A caller handed one should say so
 * ({@link reportUnrepresentedRail}) rather than render nothing quietly, because
 * a declared entry that draws nothing looks exactly like a widget whose data
 * went missing.
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

/**
 * The combinations nothing can draw. Exists so the gap is a value the tree can
 * assert on and print, rather than something a reader has to work out by
 * subtracting a table from a product in their head.
 */
export function unrepresentedRailTags(): RailTags[] {
  return allRailTags().filter((tags) => railRendererFor(tags) === null);
}

/**
 * Combinations already reported, so an entry re-rendering at frame rate says it
 * once. Keyed by combination and not by entry: the fact worth reporting is that
 * the rail cannot draw this KIND of thing, and it does not become truer for
 * being said about a second entry.
 */
const reportedUnrepresented = new Set<RailTagKey>();

/**
 * Say out loud that an entry declared something the rail cannot draw, naming the
 * combination and who declared it.
 *
 * Reports and returns; it does not throw. The entry is already going to be
 * missing from the picture, and taking the widget down with it would turn a
 * declaration the rail has not caught up with into a blank panel.
 *
 * Via the host `logger` where there is one (so it reaches Axiom, which is the
 * only place a report from a deployed session can be read) and `console.error`
 * otherwise, the same fallback `augments.ts` uses and for the same reason: the
 * sdk's `logger` throws with no host installed, which is exactly the setting an
 * Uplink's own test runs in.
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

/**
 * Test-only: forget what has been reported, so a case can be exercised twice.
 * Deliberately NOT on the published barrel, unlike the reporter beside it: an
 * Uplink drawing its own surface has reason to report a gap and none to reset
 * the record of one.
 */
export function resetUnrepresentedRailReports(): void {
  reportedUnrepresented.clear();
}
