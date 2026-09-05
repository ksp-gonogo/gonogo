/**
 * What a rail entry IS, on three axes, so the rail stops assuming.
 *
 * Every entry the rail draws today is a command: a point event that expects an
 * ack, whose whole visual grammar is about waiting for one. That is one row of
 * a table with eight, and it was baked in as an assumption rather than stated.
 * Naming the axes is the same move as `CommsReachModels.Unknown`: it makes an
 * unstated default visible, and it lets the other rows exist.
 *
 * | direction | continuity | delivery         | a real example                  |
 * |-----------|------------|------------------|---------------------------------|
 * | command   | discrete   | acked            | every rail entry today          |
 * | command   | continuous | acked            | fly-by-wire, ack = the readback |
 * | telemetry | continuous | fire-and-forget  | radio voice                     |
 * | telemetry | discrete   | fire-and-forget  | a science result sent home      |
 *
 * The axes are orthogonal, and each drives exactly ONE visual property. That
 * one-to-one is asserted in `railTags.test.ts` rather than left as prose: an
 * accessor that started reading a second axis would be a special case wearing
 * the vocabulary of a model.
 */

/** Who is talking to whom. Drives the entry's flow direction and its tone. */
export type RailDirection = "command" | "telemetry";

/**
 * Whether the entry is a point in time or a span of it. Drives the MARK: a
 * discrete entry is a dot travelling the rail, a continuous one is a ribbon
 * lying along it.
 */
export type RailContinuity = "discrete" | "continuous";

/**
 * Whether anything answers. Drives whether a RETURN LEG is drawn at all: a
 * fire-and-forget entry reaches the far end and simply ends, and drawing it a
 * return leg would be the lie this vocabulary exists to remove.
 */
export type RailDelivery = "acked" | "fire-and-forget";

export interface RailTags {
  direction: RailDirection;
  continuity: RailContinuity;
  delivery: RailDelivery;
}

/**
 * What the rail assumed before it could say so: a discrete command awaiting an
 * ack. Every existing entry lands here with no change at its call site, which
 * is the point of writing the assumption down rather than replacing it.
 */
export const DEFAULT_RAIL_TAGS: RailTags = {
  direction: "command",
  continuity: "discrete",
  delivery: "acked",
};

/**
 * The operator's voice crossing the gap: telemetry, because nothing is being
 * asked of anyone; continuous, because it occupies a span; fire-and-forget,
 * because there is no readback channel to carry an ack back.
 */
export const VOICE_RAIL_TAGS: RailTags = {
  direction: "telemetry",
  continuity: "continuous",
  delivery: "fire-and-forget",
};

/** What `railTagsOf` reads: a handle's stream/discrete shape and its own tags. */
export interface RailTagSource {
  /** `commandShape(topic)`'s answer, when the entry is a command handle. */
  shape?: "discrete" | "stream";
  /** Per-axis overrides. Any axis left out keeps its derived value. */
  tags?: Partial<RailTags>;
}

/**
 * The three axes for one entry: the default assumption, then the handle's
 * `shape`, then whatever the entry states explicitly.
 *
 * **`shape: "stream"` moves the CONTINUITY axis and nothing else.** A
 * continuous command is ACKED, the ack being the confirmed readback and the
 * deviance expected-against-actual, which is exactly what `ControlDelayStream`
 * has drawn since it shipped: outgoing, then echo, then confirmed, with the
 * expected path dashed against the actual in that last zone. Fire-and-forget
 * is not a consequence of being continuous; radio is fire-and-forget because it
 * is telemetry with no readback channel, which is the DIRECTION axis doing the
 * work, not this one.
 */
export function railTagsOf(source: RailTagSource): RailTags {
  return {
    ...DEFAULT_RAIL_TAGS,
    ...(source.shape === "stream"
      ? { continuity: "continuous" as const }
      : null),
    ...source.tags,
  };
}

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
