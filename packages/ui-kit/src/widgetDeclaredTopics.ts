/**
 * The declaration shape this module reads. Structural, because the app and the
 * SDK each hold their own copy of `ComponentDefinition`.
 */
export interface WidgetTopicDeclaration {
  channels?: readonly string[];
  optionalChannels?: readonly string[];
  fields?: readonly string[];
  dataRequirements?: readonly string[];
}

/**
 * Every CHANNEL a widget declares it mounts on, across both vocabularies:
 * the typed `channels` and `optionalChannels`, and the untyped
 * `dataRequirements`.
 *
 * The lists are unioned, since a widget can split its topics across both and
 * preferring either would silently drop the other half from the blackout badge.
 * Optional channels are included because a stale one is worth badging; an
 * absent one resolves to nothing downstream.
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
 * Every FIELD a widget declares it draws: what belongs on screen, as opposed to
 * what has to be live for the widget to render at all.
 *
 * Alarm attribution matches by containment, so a widget answering with its
 * whole channel would claim every other widget's alarm on that channel.
 *
 * Falls back to the mounted channels when a widget declares no `fields`: a
 * widget that named only channels draws what it named.
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
