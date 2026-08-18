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
 * channel is the ONLY mechanism that can join two Topics, and the models that
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
 * a topic two owners both claim is registered by NEITHER. A derived channel
 * silently overwritten by import order is worse than an absent one, because a
 * widget goes on reading it and gets another Uplink's model of a quantity it
 * has never heard of.
 */
const contributed = new Map<
  string,
  Map<string, DerivedChannelDefinition<unknown>>
>();

/**
 * Contribute `owner`'s derived channel. Prefer the bound
 * `defineUplinkClient(...).registerDerivedChannel`, which supplies the owner.
 *
 * Takes effect for stores built AFTER this call, which is the ordinary case:
 * an Uplink client's module graph is imported before a provider mounts. A
 * store already built is not retrofitted, because a channel appearing
 * mid-session would change what a topic means underneath a mounted widget.
 */
export function contributeDerivedChannel<T>(
  def: DerivedChannelDefinition<T>,
  owner: string,
): void {
  const byOwner =
    contributed.get(def.topic) ??
    new Map<string, DerivedChannelDefinition<unknown>>();
  byOwner.set(owner, def as DerivedChannelDefinition<unknown>);
  contributed.set(def.topic, byOwner);
}

/** A topic two or more Uplinks both contribute a channel for. */
export interface ContributedChannelConflict {
  topic: string;
  /** The competing owners, sorted, all of them withheld. */
  owners: string[];
}

/**
 * Every contested topic, for a host that wants to tell the operator which
 * Uplinks disagree. Mirrors `getReckonerConflicts` exactly.
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
 * The channels to actually register: every uncontested contribution. A
 * contested topic is registered by nobody, so reads of it stay `pending`
 * rather than resolving through a model chosen by import order.
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

/** Test-only: reset the registry to empty. */
export function clearContributedDerivedChannels(): void {
  contributed.clear();
}
