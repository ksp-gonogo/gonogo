import type { EventOccurrence } from "../event-timeline";

/**
 * Mod-agnostic registry for the event occurrences an alarm's `event` trigger
 * fires on.
 *
 * <p><b>Why this exists.</b> The occurrences behind an `event` trigger are
 * produced by whichever Uplink owns the Topic, and the app used to reach for
 * one of them by name to build the reader it hands its alarm host. That put an
 * Uplink's package in the app's import graph for the sake of one function
 * call, and left every other Uplink unable to feed the same trigger at all: an
 * app that names one producer has no room for a second.</p>
 *
 * <p><b>Why a registry and not an augment slot.</b> A source contributes DATA,
 * not a renderable component, so it is a registry parallel to the augment one,
 * exactly as `./coverage-source.ts` is for coverage bytes.</p>
 *
 * <p><b>The view UT is a parameter, and that is the delay model.</b> Sources
 * are asked what has been revealed AS OF the operator's delayed view clock,
 * not what has happened. An occurrence stamped at its live capture UT reveals
 * only once the view catches up past it, so the signal delay is realised by
 * the read itself rather than by anything the source has to remember to do.</p>
 */
export interface RevealedEventSourceDefinition {
  /** Stable id, auto-namespaced to the Uplink when registered through its handle. */
  id: string;
  /** The Topic whose occurrences this source produces. */
  topic: string;
  /**
   * The occurrences revealed at `viewUt`, oldest first.
   *
   * <p>Called on the alarm host's evaluation path, so it must be a cheap read
   * of state the source already holds rather than anything that computes.</p>
   *
   * <p>`viewUt` is null when no stream is mounted and the operator's clock has
   * no value yet. Return nothing in that case: there is no instant to be
   * revealed as of, so anything returned would be revealed early.</p>
   */
  revealedEvents(viewUt: number | null | undefined): readonly EventOccurrence[];
}

/**
 * The single global slot the sources live in, keyed by a string rather than a
 * symbol so two different builds of this package still find the same state.
 * Same reasoning as `./coverage-source.ts`.
 */
const EVENT_REVEAL_REGISTRY_KEY = "__GONOGO_EVENT_REVEAL_SOURCES__" as const;

interface EventRevealRegistry {
  sources: Map<string, RevealedEventSourceDefinition>;
}

function registry(): EventRevealRegistry {
  const slot = globalThis as typeof globalThis & {
    [EVENT_REVEAL_REGISTRY_KEY]?: EventRevealRegistry;
  };
  slot[EVENT_REVEAL_REGISTRY_KEY] ??= { sources: new Map() };
  return slot[EVENT_REVEAL_REGISTRY_KEY];
}

export function registerRevealedEventSource(
  def: RevealedEventSourceDefinition,
): void {
  registry().sources.set(def.id, def);
}

export function getRevealedEventSources(): RevealedEventSourceDefinition[] {
  return [...registry().sources.values()];
}

/** Tests only: resets the registry so one file's registrations cannot leak. */
export function clearRevealedEventSources(): void {
  registry().sources.clear();
}

/**
 * Every source's occurrences for one Topic, concatenated in registration order.
 *
 * <p>Two Uplinks may both feed one Topic, so this concatenates rather than
 * picking a winner: an alarm fires on an occurrence, and dropping one because
 * something else also produces that Topic would silently lose an alarm.</p>
 */
export function readRevealedEvents(
  topic: string,
  viewUt: number | null | undefined,
): readonly EventOccurrence[] {
  const out: EventOccurrence[] = [];
  for (const source of getRevealedEventSources()) {
    if (source.topic === topic) out.push(...source.revealedEvents(viewUt));
  }
  return out;
}
