import type { EventOccurrence } from "../event-timeline";

/**
 * A source of the occurrences an alarm with an `event` trigger fires on, for
 * one Topic. The Uplink that owns the Topic registers it with
 * {@link registerRevealedEventSource}.
 *
 * A source returns what the player may see at the view UT it is given, not
 * everything that has happened, so the signal delay applies without the source
 * tracking it.
 *
 * @category Delay and vantage
 */
export interface RevealedEventSourceDefinition {
  /** A stable id. Registered through an Uplink's client handle, it is prefixed with the Uplink's id. */
  id: string;
  /** The Topic whose occurrences this source produces. */
  topic: string;
  /**
   * Returns the occurrences the player may see at `viewUt`, oldest first, for
   * example from {@link EventTimeline.revealed}. Alarms call it often, so
   * return what the source already holds rather than computing anything.
   *
   * `viewUt` is `null` or `undefined` when the screen has no view time yet.
   * Return an empty array then, since anything returned would show early.
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

/**
 * Adds a source of events that are revealed after the signal delay, replacing
 * any registered under the same id.
 *
 * @category Delay and vantage
 */
export function registerRevealedEventSource(
  def: RevealedEventSourceDefinition,
): void {
  registry().sources.set(def.id, def);
}

/**
 * Returns every registered {@link RevealedEventSourceDefinition}.
 *
 * @category Delay and vantage
 */
export function getRevealedEventSources(): RevealedEventSourceDefinition[] {
  return [...registry().sources.values()];
}

/**
 * Removes every registered source. For tests, so one test file's
 * registrations do not reach another.
 *
 * @category Delay and vantage
 */
export function clearRevealedEventSources(): void {
  registry().sources.clear();
}

/**
 * Returns the occurrences every source for `topic` reveals at `viewUt`, in
 * the order the sources were registered. Where two Uplinks feed one Topic,
 * both are included.
 *
 * @category Delay and vantage
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
