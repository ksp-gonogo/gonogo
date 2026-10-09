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

/** One slice of a gate's widget set: `--shard 2/4` is the second of four. */
export interface Shard {
  index: number;
  count: number;
}

/**
 * The slice named by `--shard <i>/<n>` or `--shard=<i>/<n>`; `undefined` when
 * the flag is absent. A malformed value throws rather than reading as absent,
 * since a gate that silently ran the whole set (or none of it) under a typo
 * would report on the wrong thing.
 */
export function shardFlag(argv: readonly string[]): Shard | undefined {
  const at = argv.findIndex((a) => a === "--shard" || a.startsWith("--shard="));
  if (at === -1) return undefined;
  const raw = argv[at].startsWith("--shard=")
    ? argv[at].slice("--shard=".length)
    : (argv[at + 1] ?? "");
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  const index = m ? Number(m[1]) : 0;
  const count = m ? Number(m[2]) : 0;
  if (!m || index < 1 || index > count) {
    throw new Error(
      `--shard takes <index>/<count> with 1 <= index <= count, got "${raw}".`,
    );
  }
  return { index, count };
}

export interface GateScope {
  widgets: readonly WidgetRenderConfig[];
  /** Why the gate must not report on this set, or `null` when it may. */
  refusal: string | null;
}

/**
 * Every `count`th config starting at `index - 1`, so the shards partition the
 * set: each config lands in exactly one. The floor is checked on the whole set
 * before slicing, so a shard of a healthy set is not refused for being small,
 * while a shrunken set is refused in every shard.
 */
function sliceShard(
  widgets: readonly WidgetRenderConfig[],
  shard: Shard | undefined,
): readonly WidgetRenderConfig[] {
  if (shard === undefined) return widgets;
  return widgets.filter((_, i) => i % shard.count === shard.index - 1);
}

export function scopeWidgets(
  all: readonly WidgetRenderConfig[],
  dirs: readonly string[] | undefined,
  gate: string,
  minWidgets: number,
  shard?: Shard,
): GateScope {
  if (dirs === undefined) {
    if (all.length < minWidgets) {
      return {
        widgets: all,
        refusal:
          `\n${gate}: only ${all.length} widget config(s) found, expected at ` +
          `least ${minWidgets}. Refusing to report a clean run over a set this small.`,
      };
    }
    const widgets = sliceShard(all, shard);
    return {
      widgets,
      refusal:
        widgets.length === 0
          ? `\n${gate}: shard ${shard?.index}/${shard?.count} holds no render config. ` +
            "Refusing to report a clean run over nothing."
          : null,
    };
  }
  const widgets = sliceShard(
    all.filter((w) => dirs.some((d) => w.fixturesPath.startsWith(`${d}/`))),
    shard,
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
