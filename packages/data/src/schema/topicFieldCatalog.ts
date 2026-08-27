// `PRODUCTION_DERIVED_CHANNELS` comes through the client barrel rather than the
// SDK's: importing it here is also what LOADS those channel modules, and loading
// `vessel.state`'s is what registers its hand-declared field metadata. Without
// that side effect the largest channel in the vocabulary enumerates as empty.
import {
  isTopicCarried,
  PRODUCTION_DERIVED_CHANNELS,
  redirectKinematicSubtopic,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  DEFAULT_SITREP_CARRIED_TOPICS,
  enumerateTopicFields,
  getRuntimeRegisteredTopicIds,
  type TopicField,
  type TopicFieldKind,
} from "@ksp-gonogo/sitrep-sdk";
import type { DataKeyMeta } from "../types";

/** A catalogue entry: a `DataKeyMeta` a picker can offer, plus what a read returns. */
export interface TopicFieldKey extends DataKeyMeta {
  kind: TopicFieldKind;
  /** The Topic the value is sampled from. */
  topic: string;
  /** Dotted path within the Topic's payload; empty for the Topic itself. */
  fieldPath: string;
}

/**
 * Short forms a split of the field name would otherwise mangle into something
 * an operator has to decode ("Altitude asl", "Twr"). Deliberately small: a
 * generated label cannot be editorial, and the moment this grows into a
 * per-field phrasebook it has become the hand-maintained table it replaced.
 */
const ACRONYMS: Readonly<Record<string, string>> = Object.freeze({
  ag: "AG",
  asl: "ASL",
  eva: "EVA",
  lan: "LAN",
  lat: "latitude",
  lon: "longitude",
  met: "MET",
  sas: "SAS",
  soi: "SOI",
  twr: "TWR",
  ut: "UT",
});

/**
 * A field path as a human reads it: `landingTimeToImpact` becomes
 * "Landing time to impact", `position.x` becomes "Position x".
 *
 * Derived from the field name rather than written per field. That loses the
 * editorial phrasing a hand-maintained catalogue can carry, and buys a label
 * that cannot go stale against the wire. A hand-written table drifts, and a
 * label describing a field that does not exist is worse than a plainer one
 * that does.
 */
export function humaniseFieldPath(path: string): string {
  const words = path
    .split(".")
    .flatMap((segment) => segment.split(/(?=[A-Z])/))
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0)
    .map((word) => ACRONYMS[word] ?? word);
  if (words.length === 0) return path;
  const [first, ...rest] = words;
  const head =
    first === first.toUpperCase()
      ? first
      : first[0].toUpperCase() + first.slice(1);
  return [head, ...rest].join(" ");
}

/**
 * A Topic whose payload a dotted field path can actually be sampled from.
 *
 * A raw field subtopic is split after the SECOND segment, so a field path hung
 * off a Topic that already has three would resolve against a two-segment parent
 * no channel publishes, and the subscription would resolve to that parent too.
 * A derived channel is exempt: its own field subtopics resolve through the
 * channel rather than through that split.
 *
 * No carried Topic with three segments declares a field today, so this guards a
 * gap rather than closing one. It is here because the failure it prevents is
 * silent: the picker would offer the key, and the read would return nothing.
 */
function canCarryFieldPaths(
  topic: string,
  derivedTopics: ReadonlySet<string>,
): boolean {
  return derivedTopics.has(topic) || topic.split(".").length === 2;
}

function entryFor(topic: string, field: TopicField): TopicFieldKey {
  return {
    key: `${topic}.${field.path}`,
    label: humaniseFieldPath(field.path),
    group: topic,
    unit: field.unit,
    kind: field.kind,
    topic,
    fieldPath: field.path,
  };
}

interface BuiltCatalog {
  keys: TopicFieldKey[];
  undescribed: string[];
}

/**
 * Whether a derived channel's own inputs are actually promoted to the stream.
 *
 * A derived channel's NAME never appears in the carried list; only the raw
 * Topics it computes from do. So a channel can be registered, enumerate a full
 * field set, and still resolve to nothing forever because one of its inputs was
 * never promoted. Offering its fields would put keys in front of an operator
 * that can never carry a value, which is the failure the retired catalogue's
 * mapped-AND-carried gate existed to prevent. That gate read the migration
 * table, so it retired with it; the failure it caught did not.
 *
 * The store exists only to run that judgement, exactly as the retired
 * catalogue's did: nothing is ever ingested into it.
 */
function carriedDerivedTopics(
  carried: ReadonlySet<string>,
): ReadonlySet<string> {
  const store = new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
  for (const channel of PRODUCTION_DERIVED_CHANNELS) {
    store.registerDerivedChannel(channel);
  }
  const out = new Set<string>();
  for (const channel of PRODUCTION_DERIVED_CHANNELS) {
    if (isTopicCarried(store, carried, channel.topic)) out.add(channel.topic);
  }
  return out;
}

function buildTopicFieldCatalog(
  carried: ReadonlySet<string>,
  registered: readonly string[],
): BuiltCatalog {
  const derivedTopics = carriedDerivedTopics(carried);
  const topics = [
    ...new Set([
      // A trailing dot is a carried NAMESPACE rather than a Topic (see
      // `carried-channels.ts`), and the members under it are keyed by
      // something the contract never names, so there is nothing to enumerate.
      ...[...carried].filter((topic) => !topic.endsWith(".")),
      // Every Topic a client package registered at runtime. This is the whole
      // of an Uplink's vocabulary, and the only way it can reach a picker: the
      // carried set above is seeded from a list written in this repo, which an
      // Uplink shipping on its own schedule can never appear on.
      ...registered,
      ...PRODUCTION_DERIVED_CHANNELS.map((c) => c.topic),
    ]),
  ].sort();

  const keys: TopicFieldKey[] = [];
  const undescribed: string[] = [];
  for (const topic of topics) {
    const fields = enumerateTopicFields(topic);
    if (fields.length === 0) {
      undescribed.push(topic);
      continue;
    }
    if (!canCarryFieldPaths(topic, derivedTopics)) {
      undescribed.push(topic);
      continue;
    }
    for (const field of fields) {
      const key = `${topic}.${field.path}`;
      // A kinematic field that reads from somewhere else is not offered under
      // both names. `vessel.flight.altitudeAsl` exists on the wire and resolves
      // perfectly well, and offering it beside `vessel.state.altitudeAsl` puts
      // two names for one altitude in front of the operator, which is the
      // dual-altitude wart the redirect exists to contain. The canonical name is
      // in the catalogue already, on the Topic the redirect points at.
      if (redirectKinematicSubtopic(key) !== key) continue;
      keys.push(entryFor(topic, field));
    }
  }
  return { keys, undescribed };
}

/**
 * The catalogue is a pure function of (what is carried, what has registered),
 * and both move: an Uplink registers when its bundle loads, and the carried set
 * grows as the provider folds those registrations in. So it is built on demand
 * and cached against the pair, rather than being a module-load constant.
 *
 * One entry per carried set, keyed weakly so a set the provider has replaced is
 * collectable. The registration snapshot's identity is what invalidates an
 * entry when an Uplink registers without the carried set itself changing.
 */
const DEFAULT_CARRIED: ReadonlySet<string> = new Set(
  DEFAULT_SITREP_CARRIED_TOPICS,
);
const cache = new WeakMap<
  ReadonlySet<string>,
  { registered: readonly string[]; built: BuiltCatalog }
>();

function builtFor(
  carried: ReadonlySet<string> | undefined,
  registered: readonly string[],
): BuiltCatalog {
  const key = carried ?? DEFAULT_CARRIED;
  const cached = cache.get(key);
  if (cached !== undefined && cached.registered === registered) {
    return cached.built;
  }
  const built = buildTopicFieldCatalog(key, registered);
  cache.set(key, { registered, built });
  return built;
}

/**
 * The vocabulary an operator picks from: every field of every carried Topic,
 * every Topic an Uplink has registered, and every client-derived channel, keyed
 * by the path a read actually samples.
 *
 * Read from the contract's own generated unit and shape metadata plus the SDK's
 * runtime registry, so a field appears here because it EXISTS rather than
 * because somebody listed it: a first-party field on the next codegen, an
 * Uplink's field the moment its client package loads. That is the whole point:
 * the catalogue this replaced was hand-written, and it drifted, and the list it
 * was rebuilt on could not name a third party's Topic at all.
 *
 * `carried` is the live allowlist from the mounted `TelemetryProvider`. Omit it
 * and the first-party default stands in, which is the honest answer for a
 * caller with no provider in reach. `registered` is the SDK's registration
 * snapshot, taken as an argument so a React caller can hold it as a dependency
 * rather than re-reading a moving global inside a memo.
 *
 * The returned array is shared and must not be mutated. Its identity is stable
 * while the answer is, so it can be a `useMemo` dependency.
 *
 * Grouped by Topic rather than by an editorial category. An operator choosing a
 * threshold subject is better served knowing which Topic a value comes from
 * (whether it is a measurement, a derivation, or a career fact) than by a
 * grouping that hides it.
 */
export function getTopicFieldCatalog(
  carried?: ReadonlySet<string>,
  registered: readonly string[] = getRuntimeRegisteredTopicIds(),
): TopicFieldKey[] {
  return builtFor(carried, registered).keys;
}

/**
 * Whether a catalogue entry names something a threshold, a graph axis or any
 * other ordering comparison can be built on: a field with a magnitude.
 *
 * Reads the field's KIND, which the contract's unit token decides. A name, a
 * flag, an enum ordinal and a whole collection are all real values an operator
 * may want to READ, and none of them can be ordered, so none belongs in a
 * picker that exists to choose a comparison subject.
 *
 * An entry with no `kind` at all comes from a live `DataSource`'s own
 * `schema()` rather than from this catalogue. Those are admitted on their unit
 * hint, which is the only thing they carry.
 */
export function isThresholdSubject(entry: DataKeyMeta): boolean {
  const kind = (entry as Partial<TopicFieldKey>).kind;
  if (kind !== undefined) return kind === "quantity";
  return entry.unit !== undefined && !NON_ORDERABLE_UNIT_HINTS.has(entry.unit);
}

/**
 * The unit hints a `DataSource`-supplied key uses for something with no
 * magnitude. Only reached for a source that answers `schema()` itself, which is
 * `kos` today.
 */
const NON_ORDERABLE_UNIT_HINTS: ReadonlySet<string> = new Set([
  "bool",
  "enum",
  "flag",
  "id",
  "raw",
  "text",
]);

/**
 * Carried Topics this catalogue can say nothing about, so the gap is visible
 * rather than looking like a Topic with nothing worth offering.
 *
 * A Topic lands here for one of two reasons: nothing has annotated its fields
 * (a bare primitive channel, or an Uplink Topic whose client package has not
 * loaded), or it carries too many segments for a field path to resolve. Pinned
 * by a test, so a Topic that arrives unannotated is a failure rather than a
 * silent absence from every picker in the app.
 */
export function getUndescribedCarriedTopics(
  carried?: ReadonlySet<string>,
  registered: readonly string[] = getRuntimeRegisteredTopicIds(),
): readonly string[] {
  return builtFor(carried, registered).undescribed;
}
