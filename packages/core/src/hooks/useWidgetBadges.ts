/**
 * `useWidgetBadges` moved to `@ksp-gonogo/ui-kit`.
 *
 * It reads the widget's automatic `<id>.badges` slot off the same aggregation store
 * `ContributionsProvider` writes, and returns `BadgeEntry` rows that only `Panel`
 * renders, so both ends were already ui-kit's.
 *
 * Re-exported so this package's importers keep their import site.
 */
export { useWidgetBadges } from "@ksp-gonogo/ui-kit";
