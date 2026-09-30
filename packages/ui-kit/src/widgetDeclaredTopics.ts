/**
 * The Topic-declaring fields of a widget definition that
 * {@link widgetDeclaredTopics} and {@link widgetDrawnFields} read. Any
 * `ComponentDefinition` satisfies it.
 *
 * @category Extensions
 */
export interface WidgetTopicDeclaration {
  channels?: readonly string[];
  optionalChannels?: readonly string[];
  fields?: readonly string[];
  dataRequirements?: readonly string[];
}

/**
 * Every channel a widget declares it mounts on: its `channels`,
 * `optionalChannels` and `dataRequirements` joined, without duplicates. The
 * dashboard derives a widget's blackout badge from these. Empty for an
 * undefined definition.
 *
 * @category Extensions
 */
export function widgetDeclaredTopics(
  def: WidgetTopicDeclaration | undefined,
): readonly string[] {
  if (!def) return [];
  return dedupe([
    ...(def.channels ?? []),
    ...(def.optionalChannels ?? []),
    ...(def.dataRequirements ?? []),
  ]);
}

/**
 * Every field a widget declares it draws, as opposed to the channels it needs
 * live to render at all: its `fields` without duplicates, or, when it
 * declares none, its {@link widgetDeclaredTopics}. The dashboard matches alarms
 * to widgets against this list.
 *
 * @category Extensions
 */
export function widgetDrawnFields(
  def: WidgetTopicDeclaration | undefined,
): readonly string[] {
  if (!def) return [];
  if (def.fields && def.fields.length > 0) return dedupe(def.fields);
  return widgetDeclaredTopics(def);
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
