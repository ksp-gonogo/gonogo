/**
 * The Topics this client knows about because a client package SAID SO at
 * module load, as opposed to the ones a generated map or a hand-written list in
 * the gonogo repo names.
 *
 * An Uplink's Topics can never appear in a list written in this repo: it ships
 * separately, on its own schedule, and the first-party build has never heard of
 * it. What it does do, because narrowing and decode already require it, is call
 * `registerBarePrimitiveTopic` for each Topic id when its client package loads.
 * That call is the only runtime advertisement of an Uplink's Topics that
 * exists, so it is what everything downstream that needs "which Topics are real
 * right now" has to read.
 *
 * `registerTopicUnits` deliberately does NOT enrol a Topic here: a
 * client-derived channel declares its fields through it too, and nothing puts a
 * derived channel on the wire, so a units declaration is not evidence that
 * anything sends the Topic.
 *
 * Read by the field catalogue every value picker offers from, so an Uplink's
 * Topic reaches the pickers the moment its client package loads.
 *
 * Snapshot-shaped and subscribable because registration happens when the
 * Uplink's bundle loads, which is after the app has rendered. A consumer that
 * read this once at module load would be back to a fixed list, just a
 * differently-sourced one.
 */

const runtimeTopicIds = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: readonly string[] = Object.freeze([]);

function invalidate(): void {
  snapshot = Object.freeze([...runtimeTopicIds]);
  for (const listener of listeners) listener();
}

/**
 * Record that `id` is a real Topic on this client. Called by
 * `registerBarePrimitiveTopic`, never directly by an Uplink: an author
 * registers the way they already do and this follows.
 */
export function noteRuntimeTopic(id: string): void {
  if (runtimeTopicIds.has(id)) return;
  refuseIfAlreadySplit(id, (key) => key === id || key.startsWith(`${id}.`));
  runtimeTopicIds.add(id);
  invalidate();
}

/** Whether a client package has registered `id` as a Topic. */
export function isRuntimeRegisteredTopic(id: string): boolean {
  return runtimeTopicIds.has(id);
}

/**
 * Record that a registration changed what a Topic ENUMERATES without vouching
 * for a new Topic: `registerTopicUnits` and `registerTypeUnits`. The id list is
 * unchanged and the snapshot's identity still moves, because a catalogue built
 * between an Uplink's Topic registration and its unit registration would
 * otherwise hold that Topic's fields as empty until something else invalidated
 * it.
 */
export function noteRuntimeTopicMetadata(): void {
  invalidate();
}

/**
 * Every Topic id a client package has registered with
 * {@link registerBarePrimitiveTopic}, in registration order.
 *
 * The array is the same object until the next registration, so it can be a
 * `useSyncExternalStore` snapshot or a `useMemo` dependency. Pair it with
 * {@link subscribeRuntimeTopicRegistry}.
 *
 * @category Reading telemetry
 */
export function getRuntimeRegisteredTopicIds(): readonly string[] {
  return snapshot;
}

/**
 * Calls `listener` whenever a registration changes
 * {@link getRuntimeRegisteredTopicIds}, including a registration of units for
 * a Topic already listed. Returns a function that unsubscribes.
 *
 * @category Reading telemetry
 */
export function subscribeRuntimeTopicRegistry(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The prefixes, each ending in `.`, under which Topic ids are built at runtime
 * from something such as a vessel id or a part's flight id:
 * `fleet.<vessel id>.orbit`. A key under one of them is read as a Topic of its
 * own, never as a field of a shorter Topic.
 *
 * Gonogo's own prefixes are listed here, and an Uplink adds its own with
 * {@link registerDynamicTopicPrefix} when its client package loads. The array
 * always holds every prefix registered so far.
 *
 * @category Reading telemetry
 */
export const DYNAMIC_WHOLE_TOPIC_PREFIXES: readonly string[] = [
  /*
   * fleet.<guid>.orbit, fleet.<guid>.delay and fleet.<guid>.contact. One prefix
   * carries the whole per-vessel namespace, so the store timelines each vessel's
   * delayed elements, link and core-contact facts and useStream samples them
   * into a dead-reckoned fleet position and FleetRoster's per-row delay.
   */
  "fleet.",
  /*
   * silence.<guid>.state, the comms-owned SilenceTracker reckoning for one
   * vessel. A namespace of its own rather than joining fleet. above because the
   * core fleet facts and the comms model's opinion of them are separately owned
   * (see mod/Sitrep.Host/ChannelEngine.cs's SilenceEventPrefix).
   */
  "silence.",
  /*
   * currency.<guid>.science (+ .reputation): source-attributed currency events,
   * revealed at their source vessel's own light-time.
   */
  "currency.",
  /*
   * vessel.partActions.<flightId>: the per-part PAW action lists (the mod's
   * PartActionsViewProvider.TopicPrefix). The keys are per-part and only ever
   * computed at interaction time, and the mod only produces a part's channel
   * while that part is subscribed, so covering the whole prefix costs nothing
   * for parts nobody has open.
   */
  "vessel.partActions.",
];

const dynamicPrefixes = DYNAMIC_WHOLE_TOPIC_PREFIXES as string[];

/** The registered dynamic prefix `topic` sits under, or undefined. */
export function dynamicPrefixOf(topic: string): string | undefined {
  return dynamicPrefixes.find(
    (prefix) => topic.startsWith(prefix) && topic.length > prefix.length,
  );
}

/**
 * Registers a prefix under which an Uplink builds Topic ids at runtime, so
 * every key under it is read as a Topic of its own. Call it when the client
 * package loads, with the same prefix the Uplink's mod passes to
 * `IUplinkHost.RegisterDynamicNamespace`. Registering a prefix twice does
 * nothing.
 *
 * Without it, a Topic such as `myuplink.forecast.250000` is read as the field
 * `250000` of a Topic `myuplink.forecast` that nothing publishes, and its
 * reading never arrives.
 *
 * Throws for a prefix that does not end in `.`, has an empty segment, or has
 * fewer than two segments before the trailing dot (which would swallow a whole
 * domain), and for one registered after something has already been read
 * under it.
 *
 * @category Reading telemetry
 */
export function registerDynamicTopicPrefix(prefix: string): void {
  if (dynamicPrefixes.includes(prefix)) return;
  const segments = prefix.split(".");
  if (
    !prefix.endsWith(".") ||
    segments.length < 3 ||
    segments.slice(0, -1).some((segment) => segment.length === 0)
  ) {
    throw new Error(
      `registerDynamicTopicPrefix("${prefix}"): a dynamic prefix is at least two segments ending in ".", such as "myuplink.forecast."`,
    );
  }
  refuseIfAlreadySplit(prefix, (key) => key.startsWith(prefix));
  dynamicPrefixes.push(prefix);
  invalidate();
}

/**
 * Every key the splitter has already cut into a Topic and a field path, with
 * the Topic it chose. A registration that would now cut one of them elsewhere
 * is refused rather than left to resolve the same key two ways in one session.
 */
const splitsHandedOut = new Map<string, string>();

/** Record that `key` was split with `rawTopic` as its Topic. */
export function noteSplitHandedOut(key: string, rawTopic: string): void {
  splitsHandedOut.set(key, rawTopic);
}

function refuseIfAlreadySplit(
  registered: string,
  wouldChange: (key: string) => boolean,
): void {
  for (const [key, rawTopic] of splitsHandedOut) {
    if (rawTopic.length >= registered.length || !wouldChange(key)) continue;
    throw new Error(
      `"${registered}" was registered after "${key}" had already been read as a field of "${rawTopic}". A client package registers its Topics and dynamic prefixes when it loads, before anything reads them.`,
    );
  }
}
