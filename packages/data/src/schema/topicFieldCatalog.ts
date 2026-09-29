// `PRODUCTION_DERIVED_CHANNELS` comes through the client barrel rather than the
// SDK's: importing it here is also what LOADS those channel modules, and loading
// one is what registers its hand-declared field metadata. Without that side
// effect a derived channel's fields enumerate without units.
import {
  getContributedDerivedChannels,
  PRODUCTION_DERIVED_CHANNELS,
} from "@ksp-gonogo/sitrep-client";
import {
  type EnumEncoding,
  enumerateTopicFields,
  getAllKnownTopicIds,
  getRuntimeRegisteredTopicIds,
  isCollectionTopic,
  isCommandId,
  splitRawFieldSubtopic,
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
  /** How an `enum` field reads as a word, when its schema says. */
  enumEncoding?: EnumEncoding;
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
 * Whether a read of `<topic>.<fieldPath>` lands back on `topic`.
 *
 * Asked of the store's own split rather than of the key's shape: a raw field
 * subtopic resolves at the longest KNOWN Topic id the key starts with, so
 * `alarm.scet.fired.firedAtUt` reads off `alarm.scet.fired` while
 * `vessel.orbit.truth.position.x` reads off `vessel.orbit.truth` and not off
 * `vessel.orbit`, whose entry would be the one offering it. Offering a key
 * whose read lands somewhere else is silent: the picker shows it and nothing
 * ever fills it.
 *
 * A derived channel is exempt: its own field subtopics resolve through the
 * channel rather than through that split.
 */
function readLandsOnTopic(
  topic: string,
  fieldPath: string,
  derivedTopics: ReadonlySet<string>,
): boolean {
  if (derivedTopics.has(topic)) return true;
  const split = splitRawFieldSubtopic(`${topic}.${fieldPath}`);
  return split?.rawTopic === topic;
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
    ...(field.enumEncoding === undefined
      ? {}
      : { enumEncoding: field.enumEncoding }),
  };
}

interface BuiltCatalog {
  keys: TopicFieldKey[];
  undescribed: string[];
  collections: string[];
}

function buildTopicFieldCatalog(
  registered: readonly string[],
  derived: readonly string[],
): BuiltCatalog {
  const derivedTopics = new Set(derived);
  const topics = [
    ...new Set([...getAllKnownTopicIds(), ...registered, ...derived]),
  ]
    // A command shares the id namespace but carries no payload, so it has no field to offer and is not an undescribed reading either.
    .filter((topic) => !isCommandId(topic))
    .sort();

  const keys: TopicFieldKey[] = [];
  const undescribed: string[] = [];
  const collections: string[] = [];
  for (const topic of topics) {
    // The contract describes an ELEMENT of a collection Topic, so every field it
    // enumerates here is a property of one row, and a read of `<topic>.<field>`
    // walks into the array itself and finds nothing. Nothing in a key names an
    // element by identity (a numeric segment would name whichever row happens
    // to sit at that position), so no key under it is worth offering.
    if (isCollectionTopic(topic)) {
      collections.push(topic);
      continue;
    }
    const fields = enumerateTopicFields(topic).filter((field) =>
      readLandsOnTopic(topic, field.path, derivedTopics),
    );
    if (fields.length === 0) {
      undescribed.push(topic);
      continue;
    }
    for (const field of fields) keys.push(entryFor(topic, field));
  }
  return { keys, undescribed, collections };
}

/**
 * Every derived channel a store registers: the first-party list and every
 * uncontested Uplink contribution.
 */
export function getDerivedTopicIds(): string[] {
  return [
    ...PRODUCTION_DERIVED_CHANNELS.map((c) => c.topic),
    ...getContributedDerivedChannels().map((c) => c.topic),
  ];
}

/**
 * The catalogue is a pure function of what has registered, and that moves: an
 * Uplink registers its Topics and contributes its channels when its bundle
 * loads. So it is built on demand and cached against the pair.
 */
let cache: { key: string; built: BuiltCatalog } | undefined;

function builtFor(
  registered: readonly string[],
  derived: readonly string[],
): BuiltCatalog {
  const key = `${registered.join(",")}|${derived.join(",")}`;
  if (cache?.key === key) return cache.built;
  const built = buildTopicFieldCatalog(registered, derived);
  cache = { key, built };
  return built;
}

/**
 * The vocabulary an operator picks from: every field of every Topic the
 * contract declares, every Topic an Uplink has registered, and every derived
 * channel, keyed by the path a read actually samples.
 *
 * Read from the contract's own generated unit and shape metadata plus the SDK's
 * runtime registry, so a field appears here because it EXISTS rather than
 * because somebody listed it. Which of these a picker offers is decided by the
 * field's kind, never by a list of Topics: see {@link isNumericField} and
 * {@link isPrintableField}.
 *
 * `registered` and `derived` are taken as arguments so a React caller can hold
 * them as dependencies rather than re-reading moving globals inside a memo.
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
  registered: readonly string[] = getRuntimeRegisteredTopicIds(),
  derived: readonly string[] = getDerivedTopicIds(),
): TopicFieldKey[] {
  return builtFor(registered, derived).keys;
}

/**
 * Whether a catalogue entry is a number: something a threshold, a graph axis or
 * any other ordering comparison can be built on.
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
export function isNumericField(entry: DataKeyMeta): boolean {
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
 * Whether a catalogue entry prints as a word or a number when interpolated
 * into text: a quantity, a name, a flag, or an enum its schema can name.
 *
 * An enum with no {@link TopicFieldKey.enumEncoding} would print as a bare
 * ordinal that names nothing, and a collection would print as a whole array.
 */
export function isPrintableField(entry: TopicFieldKey): boolean {
  if (entry.kind === "enum") return entry.enumEncoding !== undefined;
  return (
    entry.kind === "quantity" || entry.kind === "text" || entry.kind === "flag"
  );
}

/**
 * A field's value as text prints it: an enum carried by its ordinal becomes
 * the member's name. An ordinal with no member passes through, since there is
 * no word for it.
 */
export function withEnumName(
  entry: TopicFieldKey | undefined,
  value: unknown,
): unknown {
  const encoding = entry?.enumEncoding;
  if (encoding?.by !== "ordinal" || typeof value !== "number") return value;
  return encoding.names[value] ?? value;
}

/**
 * Topics this catalogue can say nothing about, so the gap is visible
 * rather than looking like a Topic with nothing worth offering.
 *
 * A Topic lands here for one of two reasons: nothing has annotated its fields
 * (a bare primitive channel, or an Uplink Topic whose client package has not
 * loaded), or every field it declares would be read off some OTHER Topic
 * (`readLandsOnTopic`). Pinned
 * by a test, so a Topic that arrives unannotated is a failure rather than a
 * silent absence from every picker in the app.
 *
 * Never a COMMAND: see the filter in `buildTopicFieldCatalog`.
 */
export function getUndescribedTopics(
  registered: readonly string[] = getRuntimeRegisteredTopicIds(),
  derived: readonly string[] = getDerivedTopicIds(),
): readonly string[] {
  return builtFor(registered, derived).undescribed;
}

/**
 * Topics whose payload is a collection, which the catalogue offers
 * nothing under: the contract describes their elements, and a key can name a
 * field of the Topic but not of one of its rows.
 *
 * Reported rather than dropped for the same reason as
 * {@link getUndescribedTopics}: a Topic missing from every picker should be
 * missing for a stated reason. The two lists never overlap.
 */
export function getCollectionTopics(
  registered: readonly string[] = getRuntimeRegisteredTopicIds(),
  derived: readonly string[] = getDerivedTopicIds(),
): readonly string[] {
  return builtFor(registered, derived).collections;
}
