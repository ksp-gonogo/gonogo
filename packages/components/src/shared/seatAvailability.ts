import type { ComponentDefinition, Seat } from "@ksp-gonogo/core";

/**
 * The domains that describe the GROUND ESTABLISHMENT rather than a craft.
 *
 * A topic's domain already says where the thing it describes physically lives,
 * which is what makes the availability rule derivable at all: nobody has to
 * annotate a widget for the answer to be right. A pilot four light-minutes out
 * cannot act on the VAB, cannot hire a kerbal, and cannot approve a contract,
 * so a widget that reads any of these has no business on their screen.
 *
 * Four of the twenty-one domains on the wire. The other seventeen describe the
 * craft, its surroundings, or the stream itself, and every one of them is as
 * meaningful aboard as it is at KSC.
 */
const GROUND_DOMAINS: ReadonlySet<string> = new Set([
  "spaceCenter",
  "career",
  "commandCentre",
  "recovery",
]);

/**
 * Every topic domain a widget declares, across BOTH declaration forms.
 *
 * `dataRequirements` is the legacy flat-key form and carries the same domain
 * prefixes as the manifest form (`"career.status.economy.funds"`), so the two
 * answer this question identically and both must be read: a widget that
 * declared only the legacy form would otherwise look topic-less and sail
 * through.
 */
export function declaredDomains(
  def: Pick<
    ComponentDefinition,
    "channels" | "optionalChannels" | "dataRequirements"
  >,
): ReadonlySet<string> {
  const domains = new Set<string>();
  for (const topic of [
    ...(def.channels ?? []),
    ...(def.optionalChannels ?? []),
    ...(def.dataRequirements ?? []),
  ]) {
    const dot = topic.indexOf(".");
    domains.add(dot === -1 ? topic : topic.slice(0, dot));
  }
  return domains;
}

/**
 * May this widget be placed at this seat?
 *
 * An explicit `seats` declaration wins outright. Otherwise the answer is
 * DERIVED from what the widget already says it reads, and the direction is the
 * whole point: it fails CLOSED for the known ground domains and OPEN for every
 * other, including every domain an Uplink invents. A third-party widget reading
 * only `vessel.*` works aboard with no annotation, and one reading `career.*`
 * is absent aboard without its author having heard of the pilot seat. Nothing
 * that never heard of the seat can wrongly appear on it, and nothing innocent
 * disappears.
 *
 * `optionalChannels` counts here, unlike in `RequiresGuard`'s health check. The
 * two ask different questions: a widget renders through an optional channel it
 * cannot read, but a widget that would draw the VAB's contents WHEN they are
 * available is still a ground instrument.
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
  for (const domain of declaredDomains(def)) {
    if (GROUND_DOMAINS.has(domain)) return false;
  }
  return true;
}

/** Which of a widget's declared domains keep it off the pilot's screen. */
export function groundDomainsOf(
  def: Pick<
    ComponentDefinition,
    "channels" | "optionalChannels" | "dataRequirements"
  >,
): readonly string[] {
  return [...declaredDomains(def)].filter((d) => GROUND_DOMAINS.has(d)).sort();
}
