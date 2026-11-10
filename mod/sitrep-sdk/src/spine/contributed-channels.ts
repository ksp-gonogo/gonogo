import type { DerivedChannelDefinition } from "./timeline-store";

/**
 * Derived channels contributed by an Uplink client, registered at module load
 * the same way a reckoner is and drained into every `TelemetryProvider`-built
 * store beside the first-party ones.
 *
 * ## Why this exists
 *
 * `PRODUCTION_DERIVED_CHANNELS` is a hardcoded array in core, so until now the
 * only way to add a derived channel was to edit core. That is fine for the
 * eight channels core owns and wrong for everything else, because a derived
 * channel is the only mechanism that can join two Topics, and the models that
 * need to join two Topics are exactly the ones core must not own.
 *
 * A consumable projection is the case that surfaced it. Integrating a resource
 * needs an amount, a capacity and a rate; `vessel.resources` carries the first
 * two and the Uplink that models the consumption carries the third, a split the
 * contract makes deliberately so the generic path keeps owning the amounts. A
 * per-topic reckoner is handed one point and cannot see across it, so the model
 * has to be a channel, and the channel has to belong to whoever knows the
 * physics.
 *
 * ## Ownership, and why it is a stamped field
 *
 * Same rule and same mechanics as `reckoners.ts`: keyed by (topic, owner), and
 * a topic two owners both claim is registered by neither. A derived channel
 * silently overwritten by import order is worse than an absent one, because a
 * widget goes on reading it and gets another Uplink's model of a quantity it
 * has never heard of.
 */
const contributed = new Map<
  string,
  Map<string, DerivedChannelDefinition<unknown>>
>();

/**
 * Adds the derived channel `def` on behalf of `owner`, so a Topic computed from
 * other Topics reads like any other. Useful for an Uplink that shows the
 * operator a value joined from two Topics. Used by the Uplink client handle's
 * `registerDerivedChannel`, which supplies the owner and is the call to prefer.
 *
 * It takes effect for stores built after this call, which is the ordinary case
 * because an Uplink client is imported before a provider mounts. A store
 * already built is left unchanged, so a Topic never changes meaning under a
 * mounted widget.
 */
export function contributeDerivedChannel<Payload>(
  def: DerivedChannelDefinition<Payload>,
  owner: string,
): void {
  const byOwner =
    contributed.get(def.topic) ??
    new Map<string, DerivedChannelDefinition<unknown>>();
  byOwner.set(owner, def as DerivedChannelDefinition<unknown>);
  contributed.set(def.topic, byOwner);
  for (const listener of listeners) listener();
}

const listeners = new Set<() => void>();

/**
 * Calls `listener` whenever the set of contributed channels changes, and returns
 * a function that stops it. Useful for a screen whose Uplink bundles load after
 * its store exists, as on a station, so that the Topics they add appear once
 * loaded. Used by the hook that lists a Topic's fields.
 */
export function onContributedChannelsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A Topic that two or more Uplinks both contribute a derived channel for, with
 * the owners that disagree. Useful for telling the operator which Uplinks
 * conflict. Returned by `getContributedChannelConflicts`.
 */
export interface ContributedChannelConflict {
  topic: string;
  /** The competing owners, sorted, all of them withheld. */
  owners: string[];
}

/**
 * Every Topic that more than one Uplink contributes a derived channel for.
 * Useful for telling the operator which Uplinks disagree. It works the same way
 * as `getReckonerConflicts`.
 */
export function getContributedChannelConflicts(): ContributedChannelConflict[] {
  const conflicts: ContributedChannelConflict[] = [];
  for (const [topic, byOwner] of contributed) {
    if (byOwner.size >= 2) {
      conflicts.push({ topic, owners: [...byOwner.keys()].sort() });
    }
  }
  return conflicts;
}

/**
 * The derived channels to register on a store: every uncontested contribution.
 * A contested Topic is registered by nobody, so reads of it stay `pending`.
 * Useful for building the store a `TelemetryProvider` reads from. Used when the
 * provider builds its default store.
 */
export function getContributedDerivedChannels(): DerivedChannelDefinition<unknown>[] {
  const out: DerivedChannelDefinition<unknown>[] = [];
  for (const byOwner of contributed.values()) {
    if (byOwner.size !== 1) continue;
    const [only] = byOwner.values();
    out.push(only);
  }
  return out;
}

/**
 * Every Topic anyone contributes a derived channel for, with its owners,
 * including the contested ones that {@link getContributedDerivedChannels}
 * withholds. Useful for listing which Topics Uplinks add. It works the same way
 * as `getReckonedTopics`.
 */
export function getContributedChannelTopics(): {
  topic: string;
  owners: string[];
}[] {
  return [...contributed.entries()]
    .map(([topic, byOwner]) => ({ topic, owners: [...byOwner.keys()].sort() }))
    .sort((a, b) => a.topic.localeCompare(b.topic));
}

/** Test-only: reset the registry to empty. */
export function clearContributedDerivedChannels(): void {
  contributed.clear();
  for (const listener of listeners) listener();
}
