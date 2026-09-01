/**
 * Widget files that still give their `Panel` a body (children) instead of
 * `sections`, with how many such panels each has.
 *
 * SHRINK-ONLY. Entries may be lowered or removed, never added or raised. A new
 * entry means new code just wrote a body, which is the thing the gate exists to
 * stop; pass `sections` instead.
 *
 * Unlike most debt lists in this repo, THIS ONE HAS A REAL ZERO TO AIM AT. Every
 * entry here is a widget that can be converted, and the conversion is mechanical:
 * wrap each group in a `Section` with its `title`, hand the list to
 * `sections`, close the tag. What the widget gets back is Panel deciding how
 * those sections flow, so a landscape tile runs them in columns instead of
 * wasting its width on one.
 *
 * Regenerate after a conversion with:
 *
 *   node scripts/panel-body-debt.mjs --update
 *
 * See `styleguide-panel-body.test.ts` for what counts and `panel-body.scan.ts`
 * for the matcher itself.
 */
export const PANEL_BODY_DEBT: Record<string, number> = {};

/**
 * The instrument check. Every other assertion in the gate is
 * `expect(offenders).toEqual([])`, and a scan that walks zero files satisfies
 * all of them: a wrong cwd, a scan root that no longer exists or a
 * `git ls-files` that errored into an empty string each look exactly like a
 * clean repo.
 *
 * Neither number counts the DEBT, on purpose. This list has a real zero to aim
 * at, and a floor under the debt population would be one the work has to walk
 * through: the shrink-only guard refuses to lower a floor, so clearing the last
 * widgets would have meant fighting the gate. `tags` counts every `<Panel>`
 * opening tag, the converted self-closing ones included, so it holds steady
 * while the debt falls and still fails if the walk stops finding panels.
 */
export const SCAN_FLOORS = {
  files: 184,
  tags: 48,
} as const;
