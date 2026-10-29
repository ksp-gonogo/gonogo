/**
 * Generated stress scenes for the render gate.
 *
 * Every widget's hand-written fixtures show one tidy shape of its data, so a
 * layout that breaks on a long name, a crowded legend or a state the game opens
 * in is never drawn. Each scene here is derived from the widget's own richest
 * fixture by one transformation, so a new widget is covered without anyone
 * writing a case, and the harness's detectors run on it unchanged.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_PALETTE } from "../src/shared/dataPalette";
import type {
  SceneFixture,
  SizeMode,
  WidgetRenderConfig,
} from "./widgetRenderHarness";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_TS = resolve(
  HERE,
  "../../../mod/sitrep-sdk/src/__generated__/contract.ts",
);

/** Scene names the gate generates, in the order it draws them. */
export const STRESS_KINDS = [
  "stress-no-craft",
  "stress-landed",
  "stress-long-labels",
  "stress-modded-label",
  "stress-many-series",
] as const;

/** The one widget whose series count is the operator's to choose. */
const GRAPH_WIDGET = "graph";

/** `Situation.Landed` in the contract's vessel situation enum. */
const SITUATION_LANDED = 0;

/** Distinct sizes a stress config renders: the smallest tile, a middle one and the largest. */
const STRESS_SIZES = 3;

/** How many of the contract's longest vocabulary words a long label is built from. */
const LONG_LABEL_WORDS = 4;

/**
 * Keys whose string value is a name an operator reads, so the one place a
 * label's length can reach a layout. A body's name is left alone: widgets look
 * a body up by it.
 */
const LABEL_KEYS: ReadonlySet<string> = new Set([
  "name",
  "label",
  "title",
  "vesselName",
  "displayName",
  "partName",
  "callsign",
  "tag",
  "guiName",
]);

/** Channels whose `name` is a lookup key rather than a label. */
const LOOKUP_CHANNELS: ReadonlySet<string> = new Set([
  "trackingStation.bodies",
]);

/**
 * The longest words in the contract's own vocabulary (enum member names), split
 * into words and joined, so "the longest label" is whatever the contract can
 * say today rather than a string someone typed.
 */
export function longestContractLabel(
  source: string = readFileSync(CONTRACT_TS, "utf8"),
): string {
  const members = new Set<string>();
  for (const m of source.matchAll(/^\t([A-Z][A-Za-z0-9]{6,}) = /gm)) {
    members.add(m[1]);
  }
  const longest = [...members]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, LONG_LABEL_WORDS);
  return longest.map((w) => w.replace(/([a-z0-9])([A-Z])/g, "$1 $2")).join(" ");
}

/** A label as a part menu shows it when a mod leaves its markup and localisation tags in. */
export const MODDED_LABEL =
  "#MOD_GROUP_PROCESSING_PLANTS <b>Waste</b> <color=#ff8800>Recycler</color> <size=14>(Stage 2)</size>";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The same value with every label-key string run through `relabel`. */
function relabelValue(
  value: unknown,
  relabel: (s: string) => string,
  hit: { count: number },
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => relabelValue(v, relabel, hit));
  }
  return isObject(value) ? relabelNames(value, relabel, hit) : value;
}

function relabelNames(
  value: Json,
  relabel: (s: string) => string,
  hit: { count: number },
): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && LABEL_KEYS.has(k) && v.trim() !== "") {
      out[k] = relabel(v);
      hit.count++;
    } else {
      out[k] = relabelValue(v, relabel, hit);
    }
  }
  return out;
}

function emitsOf(fixture: Json): Json[] | undefined {
  const stream = fixture._stream;
  if (!isObject(stream) || !Array.isArray(stream.emits)) return undefined;
  return stream.emits.filter(isObject);
}

function withEmits(fixture: Json, emits: Json[]): Json {
  const stream = isObject(fixture._stream) ? fixture._stream : {};
  return { ...fixture, _stream: { ...stream, emits } };
}

function channelOf(emit: Json): string {
  const c = emit.channel ?? emit.topic;
  return typeof c === "string" ? c : "";
}

function noCraft(fixture: Json): Json | undefined {
  const emits = emitsOf(fixture);
  const meta = { _meta: fixture._meta };
  if (!emits) return meta;
  const kept = emits.filter((e) => !channelOf(e).startsWith("vessel."));
  const series = isObject(fixture._series)
    ? Object.fromEntries(
        Object.entries(fixture._series).filter(
          ([k]) => !k.startsWith("vessel."),
        ),
      )
    : undefined;
  if (kept.length === emits.length && !series) return undefined;
  return {
    ...withEmits(fixture, kept),
    ...(series ? { _series: series } : {}),
  };
}

function landed(fixture: Json): Json | undefined {
  const emits = emitsOf(fixture);
  if (!emits) return undefined;
  let changed = false;
  const next = emits.map((e) => {
    if (channelOf(e) !== "vessel.identity" || !isObject(e.value)) return e;
    changed = true;
    return { ...e, value: { ...e.value, situation: SITUATION_LANDED } };
  });
  return changed ? withEmits(fixture, next) : undefined;
}

function relabelled(fixture: Json, relabel: (s: string) => string) {
  const emits = emitsOf(fixture);
  if (!emits) return undefined;
  const hit = { count: 0 };
  const next = emits.map((e) =>
    LOOKUP_CHANNELS.has(channelOf(e)) ? e : relabelNames(e, relabel, hit),
  );
  return hit.count > 0 ? withEmits(fixture, next) : undefined;
}

/**
 * A Graph with every colour in its palette in use, each series carrying the
 * longest label the contract can say. Reuses the fixture's own plotted keys,
 * cycled, since the layout under test is the legend and the axes and not the
 * data.
 */
function manySeries(
  fixture: Json,
  longLabel: string,
): { data: Json; modeConfig: Json } | undefined {
  const series = fixture._series;
  if (!isObject(series)) return undefined;
  const keys = Object.keys(series);
  if (keys.length === 0) return undefined;
  const count = DATA_PALETTE.length;
  return {
    data: fixture,
    modeConfig: {
      series: Array.from({ length: count }, (_, i) => ({
        id: `stress-${i}`,
        key: keys[i % keys.length],
        label: `${longLabel} ${i + 1}`,
        type: "line",
        axis: i % 2 === 0 ? "primary" : "secondary",
      })),
    },
  };
}

/** The scene richest in wire emits, or the first one when no scene has a wire. */
function richestScene(scenes: readonly SceneFixture[]): SceneFixture {
  return [...scenes].sort(
    (a, b) => (emitsOf(b.data)?.length ?? 0) - (emitsOf(a.data)?.length ?? 0),
  )[0];
}

/** Every stress scene `base` supports, one per kind that changes it. */
export function stressScenes(
  widgetId: string,
  base: readonly SceneFixture[],
  longLabel: string = longestContractLabel(),
): SceneFixture[] {
  if (base.length === 0) return [];
  const source = richestScene(base);
  const make = (
    kind: (typeof STRESS_KINDS)[number],
    data: Json | undefined,
    modeConfig?: Json,
  ): SceneFixture[] =>
    data
      ? [{ name: kind, file: source.file, data, modeConfig, stress: true }]
      : [];
  const many =
    widgetId === GRAPH_WIDGET ? manySeries(source.data, longLabel) : undefined;
  return [
    ...make("stress-no-craft", noCraft(source.data)),
    ...make("stress-landed", landed(source.data)),
    ...make(
      "stress-long-labels",
      relabelled(source.data, () => longLabel),
    ),
    ...make(
      "stress-modded-label",
      relabelled(source.data, () => MODDED_LABEL),
    ),
    ...make("stress-many-series", many?.data, many?.modeConfig),
  ];
}

/** True when a mode reaches its state through synthetic input, which a generated scene's DOM may not have. */
function interactive(mode: SizeMode): boolean {
  return Boolean(
    mode.clicks?.length ||
      mode.fills?.length ||
      mode.hovers?.length ||
      mode.zooms?.length ||
      mode.focuses?.length,
  );
}

/** The sizes a stress config renders: static modes only, a few distinct tiles spread from smallest to largest. */
export function stressModes(modes: readonly SizeMode[]): SizeMode[] {
  const seen = new Set<string>();
  const distinct = modes
    .filter((m) => !interactive(m) && !m.name.startsWith("warmup"))
    .map(({ forFixtures: _drop, ...m }) => m)
    .filter((m) => {
      const key = `${m.w}x${m.h}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.w * a.h - b.w * b.h);
  if (distinct.length <= STRESS_SIZES) return distinct;
  const picks = new Set([
    0,
    Math.floor((distinct.length - 1) / 2),
    distinct.length - 1,
  ]);
  return distinct.filter((_, i) => picks.has(i));
}

/**
 * One stress config per widget id, taken from the first config that can mount
 * at all. A widget with a dozen showcase configs is stressed once: the scenes
 * come from its own fixtures, and the showcase modes add sizes, not data.
 */
export function stressConfigs(
  configs: readonly WidgetRenderConfig[],
): WidgetRenderConfig[] {
  const seen = new Set<string>();
  const out: WidgetRenderConfig[] = [];
  for (const config of configs) {
    if (seen.has(config.widgetId)) continue;
    const modes = stressModes(config.modes);
    if (modes.length === 0) continue;
    seen.add(config.widgetId);
    out.push({ ...config, modes, stress: true });
  }
  return out;
}
