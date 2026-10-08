/**
 * Which render configs a widget-surveying gate (`overlap-gate`, `font-gate`)
 * runs over, and whether the set it was left with is one it may report on.
 *
 * Whole, a gate must see at least `minWidgets` configs: below that it iterates
 * over whatever survived and a clean verdict means nothing. Scoped with
 * `--widget`, the set is meant to be small, so the floor gives way, but only
 * once at least one config matched: a scope that matches nothing is a typo or
 * a stale directory name, and reporting it clean would be a green over no
 * renders at all.
 */
import type { WidgetRenderConfig } from "./widgetRenderHarness";

/**
 * The directories named by `--widget <dir>[,<dir>]` or `--widget=<dir>[,<dir>]`,
 * each a folder under `packages/components/src`; `undefined` when the flag is absent.
 */
export function widgetFlag(argv: readonly string[]): string[] | undefined {
  const at = argv.findIndex(
    (a) => a === "--widget" || a.startsWith("--widget="),
  );
  if (at === -1) return undefined;
  const raw = argv[at].startsWith("--widget=")
    ? argv[at].slice("--widget=".length)
    : (argv[at + 1] ?? "");
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

export interface GateScope {
  widgets: readonly WidgetRenderConfig[];
  /** Why the gate must not report on this set, or `null` when it may. */
  refusal: string | null;
}

export function scopeWidgets(
  all: readonly WidgetRenderConfig[],
  dirs: readonly string[] | undefined,
  gate: string,
  minWidgets: number,
): GateScope {
  if (dirs === undefined) {
    return {
      widgets: all,
      refusal:
        all.length < minWidgets
          ? `\n${gate}: only ${all.length} widget config(s) found, expected at ` +
            `least ${minWidgets}. Refusing to report a clean run over a set this small.`
          : null,
    };
  }
  const widgets = all.filter((w) =>
    dirs.some((d) => w.fixturesPath.startsWith(`${d}/`)),
  );
  return {
    widgets,
    refusal:
      widgets.length === 0
        ? `\n${gate}: no render config has fixtures under ${dirs.length === 0 ? "(no directory given)" : dirs.map((d) => `"${d}/"`).join(" or ")}. ` +
          "Refusing to report a clean run over nothing; --widget takes a directory under packages/components/src."
        : null,
  };
}
