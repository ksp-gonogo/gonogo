/**
 * The declaration shape this module reads. Structural rather than the
 * `ComponentDefinition` import, because the app and the SDK each hold their own
 * copy of that interface and both need the same answer out of this.
 */
export interface WidgetTopicDeclaration {
  channels?: readonly string[];
  optionalChannels?: readonly string[];
  dataRequirements?: readonly string[];
}

/**
 * Every topic a widget declares it reads, across both declaration vocabularies.
 *
 * `channels` / `optionalChannels` are typed `TopicId`s. `dataRequirements` is the
 * untyped predecessor, and it still carries the declarations no `TopicId` can
 * express: the derived channels (`vessel.state`, `spaceCenter.state`, the `dv.`
 * scalars) and the field paths beneath them.
 *
 * The two are unioned rather than one preferred over the other. A widget part-way
 * through the migration declares its wire topics as `channels` and keeps the
 * inexpressible remainder in `dataRequirements`, so preferring either list alone
 * would silently drop half of what that widget reads, and the two things derived
 * from this, its stream-status badge and its alarm attribution, would both go
 * quiet: the silent-miss failure the declaration mechanism exists to prevent.
 *
 * Optional channels are included because the widget renders them when they are
 * present, so a stale one is worth badging. An absent one resolves to nothing and
 * is skipped downstream, so it cannot badge a widget for data it never had.
 *
 * When `dataRequirements` retires, delete its spread here and every caller keeps
 * working unchanged.
 */
export function widgetDeclaredTopics(
  def: WidgetTopicDeclaration | undefined,
): readonly string[] {
  if (!def) return [];
  const seen = new Set<string>();
  for (const topic of [
    ...(def.channels ?? []),
    ...(def.optionalChannels ?? []),
    ...(def.dataRequirements ?? []),
  ]) {
    seen.add(topic);
  }
  return [...seen];
}
