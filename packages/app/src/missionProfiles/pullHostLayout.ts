import type { DashboardItem } from "../components/Dashboard";
import type { HostLayout } from "../peer/protocol";

const SUFFIX = " (main screen)";

/**
 * The name a pulled layout is saved under: its own when no layout here has it,
 * otherwise marked as the main screen's, and numbered if that is taken too.
 */
export function pulledLayoutName(
  name: string,
  taken: readonly string[],
): string {
  const has = (candidate: string) =>
    taken.some((t) => t.trim().toLowerCase() === candidate.toLowerCase());
  if (!has(name)) return name;
  const marked = `${name}${SUFFIX}`;
  if (!has(marked)) return marked;
  for (let n = 2; ; n++) {
    const numbered = `${name}${SUFFIX} ${n}`;
    if (!has(numbered)) return numbered;
  }
}

/**
 * The pulled layout's items with this station's key and device bindings put
 * back: each item takes the bindings of the first still-unused station item of
 * the same widget, and keeps the main screen's own where there is none.
 */
export function withStationBindings(
  pulled: readonly DashboardItem[],
  stationItems: readonly DashboardItem[],
): DashboardItem[] {
  const unused = stationItems.filter(
    (item) => item.inputMappings !== undefined,
  );
  return pulled.map((item) => {
    const at = unused.findIndex((s) => s.componentId === item.componentId);
    if (at < 0) return item;
    const [match] = unused.splice(at, 1);
    return { ...item, inputMappings: match.inputMappings };
  });
}

export function pulledLayoutContent(
  layout: HostLayout,
  stationItems: readonly DashboardItem[],
) {
  return {
    items: withStationBindings(layout.items, stationItems),
    layout: layout.layout,
  };
}
