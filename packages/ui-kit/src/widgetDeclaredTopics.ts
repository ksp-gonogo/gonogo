/**
 * The declaration shape this module reads. Structural rather than the
 * `ComponentDefinition` import, because the app and the SDK each hold their own
 * copy of that interface and both need the same answer out of this.
 */
export interface WidgetTopicDeclaration {
  channels?: readonly string[];
  optionalChannels?: readonly string[];
  fields?: readonly string[];
  dataRequirements?: readonly string[];
}

/**
 * Every CHANNEL a widget declares it mounts on, across both vocabularies.
 *
 * `channels` / `optionalChannels` are typed. `dataRequirements` is the untyped
 * predecessor, still carrying whatever a widget has not migrated yet.
 *
 * The two are unioned rather than one preferred over the other. A widget
 * part-way through the migration declares its wire topics as `channels` and
 * keeps the remainder in `dataRequirements`, so preferring either list alone
 * would silently drop half of what that widget mounts on, and the stream-status
 * badge derived from this would go quiet: the silent-miss failure the
 * declaration mechanism exists to prevent.
 *
 * Optional channels are included because the widget renders them when present,
 * so a stale one is worth badging. An absent one resolves to nothing and is
 * skipped downstream, so it cannot badge a widget for data it never had.
 *
 * When `dataRequirements` retires, delete its spread here and every caller keeps
 * working unchanged.
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
 * The two are different questions and `dataRequirements` was answering both with
 * one array. A widget mounts on the whole of `vessel.state` and draws a handful
 * of its fifty fields. Alarm attribution matches by containment, so answering
 * with the channel makes that widget claim all fifty and lights its panel for
 * every other widget's alarm on the same channel. Measured before `fields`
 * existed: 20 of the 23 widgets declaring field paths would have falsely claimed
 * a field another widget draws.
 *
 * Falls back to the mounted channels when a widget declares no `fields`, which
 * is the honest reading of silence: a widget that named only channels draws what
 * it named. That fallback is also what keeps every unmigrated widget behaving
 * exactly as it did.
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
