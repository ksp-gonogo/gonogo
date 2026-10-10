/**
 * The Topic-declaring fields of a widget definition that
 * {@link widgetDeclaredTopics} and {@link widgetDrawnFields} read. Any
 * `ComponentDefinition` satisfies it.
 *
 * @category Extensions
 */
export interface WidgetTopicDeclaration {
  /** The Topics the widget cannot draw without. */
  channels?: readonly string[];
  /** The Topics the widget reads when they are published. */
  optionalChannels?: readonly string[];
  /** Families of Topics the widget cannot draw without, as patterns such as `fleet.<vessel>.contact`. */
  channelFamilies?: readonly string[];
  /** Families of Topics the widget reads when they are published. */
  optionalChannelFamilies?: readonly string[];
  /** The Topics a widget reads that depend on its settings. */
  channelsFromConfig?: (config: never) => readonly string[];
  /** The fields the widget draws, when that is fewer than its Topics carry. */
  fields?: readonly string[];
  /** The legacy flat keys the widget reads. */
  dataRequirements?: readonly string[];
}

/**
 * Every concrete channel a widget declares it mounts on: its `channels`,
 * `optionalChannels` and `dataRequirements` joined, plus the Topics its
 * `channelsFromConfig` names for `config`, without duplicates. The dashboard
 * derives a widget's blackout badge from these. Empty for an undefined
 * definition.
 *
 * Families (`channelFamilies`, `optionalChannelFamilies`) are left out on
 * purpose: blackout is per craft and a family has no single craft, so see
 * {@link widgetDrawnFamilies} for them.
 *
 * @category Extensions
 */
export function widgetDeclaredTopics(
  def: WidgetTopicDeclaration | undefined,
  config?: unknown,
): readonly string[] {
  if (!def) return [];
  return dedupe([
    ...(def.channels ?? []),
    ...(def.optionalChannels ?? []),
    ...(def.dataRequirements ?? []),
    ...configTopics(def, config),
  ]);
}

/**
 * Every field a widget declares it draws, as opposed to the channels it needs
 * live to render at all: its `fields` without duplicates, or, when it
 * declares none, its {@link widgetDeclaredTopics}. Topics from
 * `channelsFromConfig` are always included. The dashboard matches alarms to
 * widgets against this list.
 *
 * @category Extensions
 */
export function widgetDrawnFields(
  def: WidgetTopicDeclaration | undefined,
  config?: unknown,
): readonly string[] {
  if (!def) return [];
  if (def.fields && def.fields.length > 0) {
    return dedupe([...def.fields, ...configTopics(def, config)]);
  }
  return widgetDeclaredTopics(def, config);
}

/**
 * Every family of runtime-built Topic ids a widget declares, required and
 * optional joined, without duplicates, such as `"fleet.<vessel>.contact"`. The
 * dashboard matches alarms against these with `topicMatchesFamily`.
 *
 * @category Extensions
 */
export function widgetDrawnFamilies(
  def: WidgetTopicDeclaration | undefined,
): readonly string[] {
  if (!def) return [];
  return dedupe([
    ...(def.channelFamilies ?? []),
    ...(def.optionalChannelFamilies ?? []),
  ]);
}

function configTopics(
  def: WidgetTopicDeclaration,
  config: unknown,
): readonly string[] {
  if (!def.channelsFromConfig || config === undefined) return [];
  return def.channelsFromConfig(config as never);
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
