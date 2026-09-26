import type { ComponentDefinition, Seat } from "@ksp-gonogo/core";

/** Domains describing the ground establishment, which a pilot aboard cannot act on. */
const GROUND_DOMAINS: ReadonlySet<string> = new Set([
  "spaceCenter",
  "career",
  "commandCentre",
  "recovery",
]);

/** Ground topics a crew needs to address the ground at all, so reading them keeps a widget aboard. */
const ADDRESSING_TOPICS: ReadonlySet<string> = new Set([
  "commandCentre.roster",
  "commandCentre.separation",
]);

/** Every topic domain a widget declares, including through `dataRequirements`, which carries the same prefixes. */
export function declaredDomains(
  def: Pick<
    ComponentDefinition,
    "channels" | "optionalChannels" | "dataRequirements"
  >,
): ReadonlySet<string> {
  return domainsOf(declaredTopics(def));
}

function declaredTopics(
  def: Pick<
    ComponentDefinition,
    "channels" | "optionalChannels" | "dataRequirements"
  >,
): readonly string[] {
  return [
    ...(def.channels ?? []),
    ...(def.optionalChannels ?? []),
    ...(def.dataRequirements ?? []),
  ];
}

function domainsOf(topics: readonly string[]): ReadonlySet<string> {
  const domains = new Set<string>();
  for (const topic of topics) {
    const dot = topic.indexOf(".");
    domains.add(dot === -1 ? topic : topic.slice(0, dot));
  }
  return domains;
}

/**
 * An explicit `seats` wins; otherwise derived from what the widget reads,
 * failing closed for the known ground domains and open for every other,
 * including any an Uplink invents. Optional channels count: a widget that would
 * draw ground data when it arrives is still a ground instrument.
 */
export function availableAtSeat(
  def: Pick<
    ComponentDefinition,
    "channels" | "optionalChannels" | "dataRequirements" | "seats"
  >,
  seat: Seat,
): boolean {
  if (def.seats) return def.seats.includes(seat);
  if (seat !== "pilot") return true;
  return groundDomainsOf(def).length === 0;
}

/** Which of a widget's declared domains keep it off the pilot's screen. */
export function groundDomainsOf(
  def: Pick<
    ComponentDefinition,
    "channels" | "optionalChannels" | "dataRequirements"
  >,
): readonly string[] {
  const topics = declaredTopics(def).filter((t) => !ADDRESSING_TOPICS.has(t));
  return [...domainsOf(topics)].filter((d) => GROUND_DOMAINS.has(d)).sort();
}
