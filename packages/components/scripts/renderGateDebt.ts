/**
 * What the render gate's newer checks find in the tree today, so they can gate
 * from the day they land without going red on widgets nobody has touched.
 *
 * Shrink-only: an entry is a (widget, scene kind, check) that is known to
 * report, and a run that finds it no longer reporting says to delete it. Adding
 * an entry means a widget got worse, so it goes through the same review as the
 * bug it records.
 */

/**
 * Key: `<widgetId>|<scene>|<findings list>` for a generated stress scene,
 * `<widgetId>|<findings list>` for the newer checks on an authored scene.
 */
export const RENDER_GATE_DEBT: ReadonlySet<string> = new Set<string>([
  "administration-building|hitTargets",
  "administration-building|stress-long-labels|hitTargets",
  "administration-building|stress-modded-label|hitTargets",
  "astronaut-complex|hitTargets",
  "astronaut-complex|stress-long-labels|hitTargets",
  "astronaut-complex|stress-modded-label|hitTargets",
  "atmosphere-profile|svgHtmlOverlaps",
  "contract-manager|hitTargets",
  "crew-status|hitTargets",
  "experiments|hitTargets",
  "experiments|stress-long-labels|hitTargets",
  "experiments|stress-modded-label|hitTargets",
  "graph|stress-many-series|svgHtmlOverlaps",
  "ground-track|hitTargets",
  "ground-track|stress-landed|hitTargets",
  "ground-track|stress-long-labels|hitTargets",
  "ground-track|stress-modded-label|hitTargets",
  "maneuver-planner|hitTargets",
  "navball|hitTargets",
  "navball|stress-landed|hitTargets",
  "navball|stress-landed|svgHtmlOverlaps",
  "navball|stress-long-labels|hitTargets",
  "navball|stress-long-labels|svgHtmlOverlaps",
  "navball|stress-modded-label|hitTargets",
  "navball|stress-modded-label|svgHtmlOverlaps",
  "navball|stress-no-craft|hitTargets",
  "navball|svgHtmlOverlaps",
  "objectives|hitTargets",
  "objectives|stress-long-labels|hitTargets",
  "objectives|stress-modded-label|hitTargets",
  "orbital-ascent|stress-no-craft|svgHtmlOverlaps",
  "power-systems|hitTargets",
  "power-systems|stress-long-labels|hitTargets",
  "power-systems|stress-modded-label|hitTargets",
  "research-and-development|hitTargets",
  "target-picker|hitTargets",
  "target-picker|stress-long-labels|hitTargets",
  "target-picker|stress-modded-label|hitTargets",
  "tracking-station|hitTargets",
  "tracking-station|stress-landed|hitTargets",
  "tracking-station|stress-long-labels|hitTargets",
  "tracking-station|stress-modded-label|hitTargets",
  "tracking-station|stress-no-craft|hitTargets",
  "tracking-station|svgHtmlOverlaps",
  "vessel-catalog|hitTargets",
  "warp-control|hitTargets",
  "warp-control|stress-landed|hitTargets",
  "warp-control|stress-long-labels|hitTargets",
  "warp-control|stress-modded-label|hitTargets",
  "warp-control|stress-no-craft|hitTargets",
]);

/** Findings are `<widgetId> @ <mode> (<scene>): <what>`. */
const FINDING_HEAD = /^(\S+) @ .+? \((.+?)\): /;

const STRESS_PREFIX = "stress-";

/** Lists the newer checks write to, which are measured against debt on authored scenes too. */
export const NEW_CHECK_LISTS: ReadonlySet<string> = new Set([
  "svgHtmlOverlaps",
  "hitTargets",
  "actionShifts",
]);

/** The debt key a finding falls under, or undefined when no debt can cover it. */
export function debtKey(list: string, finding: string): string | undefined {
  const head = FINDING_HEAD.exec(finding);
  if (!head) return undefined;
  const [, widgetId, scene] = head;
  if (scene.startsWith(STRESS_PREFIX)) {
    return `${widgetId}|${scene.split(" @ ")[0]}|${list}`;
  }
  return NEW_CHECK_LISTS.has(list) ? `${widgetId}|${list}` : undefined;
}

/**
 * Removes every finding the debt covers, in place, and says which debt entries
 * reported nothing so they can be deleted. An entry is only judged when its
 * widget rendered in this run, since a scoped run says nothing about the rest.
 */
export function settleDebt(
  findings: ReadonlyArray<readonly [string, string[]]>,
  renderedWidgets: ReadonlySet<string>,
  debt: ReadonlySet<string> = RENDER_GATE_DEBT,
): { covered: number; stale: string[] } {
  const used = new Set<string>();
  let covered = 0;
  for (const [list, lines] of findings) {
    const kept = lines.filter((line) => {
      const key = debtKey(list, line);
      if (key === undefined || !debt.has(key)) return true;
      used.add(key);
      covered++;
      return false;
    });
    lines.splice(0, lines.length, ...kept);
  }
  const stale = [...debt].filter(
    (key) => renderedWidgets.has(key.split("|")[0]) && !used.has(key),
  );
  return { covered, stale };
}
