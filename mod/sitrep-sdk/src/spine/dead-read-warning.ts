import { hasHost } from "../api/host";
import { logger } from "../api/logger";
import { getDataSource } from "../api/registry";
import type { GatedReadHook } from "./gated-read-warning";
import { isKnownTopic, resolveValueTopic } from "./map-topic";

/**
 * A legacy-shaped read that resolves to NOTHING: no topic to subscribe and no
 * source to ask, so it returns `undefined` for the life of the screen and the
 * widget holding it renders blank for ever.
 *
 * The sibling diagnostics each cover a read that reached SOMETHING and then
 * went quiet. `installUnownedTopicWarning` needs a subscribe to have been sent,
 * `warnChannelError` needs the mod to have answered one, and `warnGatedRead`
 * needs both candidate values in hand with the streamed one present. None of
 * them can see the read that never reached a channel at all, which is the one
 * that ships silent: a key the contract does not declare resolves to no topic,
 * so `useTelemetry` short-circuits its subscribe to a no-op, and if no
 * `DataSource` is registered under the id either then nothing anywhere has been
 * asked a question.
 *
 * ## Why the verdict is deferred and then re-derived
 *
 * "Nothing yet" and "nothing ever" are the same picture at mount. An Uplink
 * registers its Topics and its data source when its BUNDLE loads, which is
 * after the app has rendered (see `runtime-topic-registry.ts`'s header), so a
 * read that is dead on the first frame can be perfectly healthy on the tenth.
 * A warning that fired on that race would fire on every startup and be tuned
 * out, which is worse than no warning.
 *
 * So the report waits {@link DEAD_READ_SETTLE_MS} and then asks the registries
 * again, through {@link classifyDeadRead}, rather than trusting the values the
 * render that scheduled it was holding. Re-deriving costs nothing and means the
 * verdict does not depend on a re-render having happened to land in between: a
 * two-arg read subscribes to neither registry itself, and what re-renders it
 * today is incidental to both.
 */

/**
 * How long a read has to resolve to nothing before it is reported.
 *
 * Sized to outlast an Uplink bundle load (fetch, hash, `import()`) after the
 * dashboard has already rendered, and short enough that the line lands while
 * the developer who caused it is still looking at the screen.
 */
export const DEAD_READ_SETTLE_MS = 5000;

/**
 * Which of the several ways a read can resolve to nothing this one is. They
 * want different messages: the fix for a misspelt field path is not the fix for
 * an Uplink that never registered its data source, and one vague line covering
 * both is a line nobody acts on.
 */
export type DeadReadCause =
  /** The key names no declared field, and no source is registered under the id. */
  | { kind: "no-topic-no-source" }
  /**
   * The key names no declared field, and the registered source enumerates a
   * schema that does not contain it, so that source will never emit one either.
   */
  | {
      kind: "no-topic-key-not-in-schema";
      sourceName: string;
      schemaKeys: readonly string[];
    }
  /**
   * The key DOES resolve to a topic, but no `TelemetryProvider` is mounted to
   * stream it and no source is registered to answer instead.
   */
  | { kind: "no-provider-no-source"; topic: string };

/**
 * The verdict on `(dataSourceId, key)` as the registries stand RIGHT NOW.
 *
 * `undefined` means "not reportable", and it covers the healthy cases as well
 * as the ones another diagnostic owns:
 *
 * - a topic resolved AND a stream is mounted: the subscribe reached a channel,
 *   so `installUnownedTopicWarning` is the instrument that gets to speak
 * - a topic resolved and a source is registered: the legacy leg is live
 * - a source is registered and its schema is empty: an empty schema is a source
 *   that does not enumerate, not evidence that the key is absent from it, and
 *   several real sources return `[]`
 * - a source is registered and its schema DOES declare the key: it simply has
 *   not emitted yet, which resolves itself the moment the source speaks
 *
 * `keyMayNameWholeTopic` picks which key vocabulary to resolve against, and it
 * is a property of the CALLING HOOK rather than of the moment. A value read
 * reaches a field within a Topic, so a bare Topic id is not a key it can serve
 * and `resolveValueTopic` alone is the right question. A status read and a
 * plotted window are keyed by the whole Topic and pass the key through
 * untranslated for `isTopicCarried` to answer, so on those a bare Topic id
 * reaches a real channel. Asking the narrow question there accuses the read
 * that works: `useDataStreamStatus("data", "science.experimentBreakdown")`, the
 * one such call the app ships, would be told its Topic declares no such field.
 */
export function classifyDeadRead(
  dataSourceId: string,
  key: string,
  streamMounted: boolean,
  keyMayNameWholeTopic = false,
): DeadReadCause | undefined {
  const topic = keyMayNameWholeTopic
    ? (resolveValueTopic(dataSourceId, key) ??
      (isKnownTopic(key) ? key : undefined))
    : resolveValueTopic(dataSourceId, key);
  const source = getDataSource(dataSourceId);

  if (topic !== undefined) {
    if (streamMounted || source !== undefined) return undefined;
    return { kind: "no-provider-no-source", topic };
  }

  if (source === undefined) return { kind: "no-topic-no-source" };

  const schemaKeys = declaredKeys(source);
  if (schemaKeys.length === 0) return undefined;
  if (schemaKeys.includes(key)) return undefined;
  return {
    kind: "no-topic-key-not-in-schema",
    sourceName: source.name || dataSourceId,
    schemaKeys,
  };
}

/**
 * `schema()` is third-party code called from a diagnostic, and a diagnostic
 * must never be the thing that breaks the run it is diagnosing. A source that
 * throws, or answers with something that is not a list of keys, is treated as
 * one that does not enumerate.
 */
function declaredKeys(
  source: NonNullable<ReturnType<typeof getDataSource>>,
): readonly string[] {
  try {
    return source
      .schema()
      .map((entry) => entry.key)
      .filter((key) => typeof key === "string");
  } catch {
    return [];
  }
}

const warned = new Set<string>();

/**
 * Report `(dataSourceId, key)` once per distinct read for the session.
 *
 * Once, because the read is re-evaluated on every render of every widget
 * holding it: an ungated line would print thousands of times a minute and bury
 * itself. Per distinct read rather than per topic, because the thing an author
 * has to go and change is the call they wrote.
 */
export function warnDeadRead(
  hook: GatedReadHook,
  dataSourceId: string,
  key: string,
  cause: DeadReadCause,
): void {
  const id = `${hook} ${dataSourceId} ${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  // The logger is host-injected and fails loud when no host is installed, the
  // ordinary state of a unit test. A diagnostic must never be the thing that
  // breaks the run it is diagnosing.
  if (!hasHost()) return;
  logger.warn(deadReadMessage(hook, dataSourceId, key, cause), {
    hook,
    dataSourceId,
    key,
    cause: cause.kind,
    ...(cause.kind === "no-provider-no-source" ? { topic: cause.topic } : {}),
  });
}

/** Reset between tests. Not part of the published surface. */
export function resetDeadReadWarnings(): void {
  warned.clear();
}

/**
 * The message text, separately so a test can assert on it without a host.
 *
 * Written for someone who does not know the migration shim exists. Every arm
 * says the same three things in the same order: what was observed, why it can
 * never resolve on its own, and what to change. The waited-for interval is
 * stated because a reader's first instinct on a blank widget is that it has not
 * loaded yet, and this line has to be able to say that it has.
 */
export function deadReadMessage(
  hook: GatedReadHook,
  dataSourceId: string,
  key: string,
  cause: DeadReadCause,
): string {
  const call = `${hook}("${dataSourceId}", "${key}")`;
  const waited = `Still nothing ${DEAD_READ_SETTLE_MS}ms after the read first ran, so this is not a slow start.`;

  if (cause.kind === "no-provider-no-source") {
    return (
      `[dead read] ${call} will never resolve. The key does resolve to the ` +
      `topic "${cause.topic}", but no TelemetryProvider is mounted on this ` +
      `screen, so nothing is streaming it, and no data source is registered ` +
      `under the id "${dataSourceId}" to answer instead. ${waited} Every ` +
      `telemetry read on this screen is in the same state: mount a ` +
      `TelemetryProvider above the tree that holds this widget (the app does ` +
      `this in SitrepTelemetryProvider).`
    );
  }

  const unknownKey =
    `[dead read] ${call} will never resolve. "${key}" names no field that any ` +
    `registered contract Topic declares and falls under no dynamic topic ` +
    `namespace, so there is no stream channel to subscribe to.`;

  if (cause.kind === "no-topic-key-not-in-schema") {
    return (
      `${unknownKey} The data source "${cause.sourceName}" IS registered under ` +
      `"${dataSourceId}", but "${key}" is not one of the ` +
      `${cause.schemaKeys.length} keys its schema declares, so it will never ` +
      `emit one. ${waited} ${nearest(key, cause.schemaKeys)}`
    );
  }

  return (
    `${unknownKey} No data source is registered under the id ` +
    `"${dataSourceId}" either, so nothing anywhere has been asked a question ` +
    `and the widget holding this read renders blank rather than failing. ` +
    `${waited} Check the field path against the Topic that declares it, and ` +
    `prefer the canonical one-arg useTelemetry("<topic>"), which reads the ` +
    `whole payload and is a compile error when the Topic does not exist. If ` +
    `the Topic belongs to an Uplink, check that the Uplink is installed and ` +
    `enabled and that its Register did not throw on load (the system.uplinks ` +
    `roster carries available:false and a reason).`
  );
}

/**
 * The handful of declared keys closest to the one that was asked for.
 *
 * A misspelt or half-remembered field path is the commonest cause of this arm,
 * and a list of what the source actually offers turns the line from a verdict
 * into a fix. Ranked by shared prefix so `vessel.control.thruttle` surfaces
 * `vessel.control.throttle` rather than five unrelated keys.
 */
function nearest(key: string, schemaKeys: readonly string[]): string {
  const ranked = [...schemaKeys]
    .map((candidate) => ({ candidate, score: sharedPrefix(key, candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ candidate }) => `"${candidate}"`);
  return `Nearest keys it does declare: ${ranked.join(", ")}.`;
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
