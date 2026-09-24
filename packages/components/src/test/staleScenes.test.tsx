import { getComponent } from "@ksp-gonogo/core";
import { act } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { listWidgets } from "../../scripts/widgets";
// Importing the package index self-registers every built-in component.
import "../index";
import {
  normaliseReactIds,
  renderWidgetMode,
  type WidgetSnapshotMode,
} from "./widgetDomSnapshot";

/**
 * Every scene staged as no longer arriving, rendered beside the live scene it
 * was taken from, and read for what the widget does about it.
 *
 * Four outcomes, because two would force a wrong answer. A held figure marked
 * through `Unit` ANNOUNCES: its `[data-not-current]` quantity carries a
 * `[data-unit-currency]` caption. One marked without that caption is SILENT,
 * which only a render can tell apart from the first, since in source the two
 * are the same attribute. A widget can also mark nothing and still change,
 * withdrawing a judgement where it would otherwise hold a figure. And it can
 * change nothing at all, which is the one outcome that leaves an operator with
 * no way to tell the link has gone.
 *
 * "Nothing" is judged on the markup with its style classes kept, not on the
 * text alone: a dimmed panel differs from a lit one only in a class, and within
 * one run an identical style always hashes to the identical class.
 *
 * Live and stale mount in separate tests. A widget that registers actions does
 * so on every mount, and two in one test is a rate the perf gate reads as a
 * regression.
 */

const FIXTURE_MODULES = import.meta.glob<{ default: Record<string, unknown> }>(
  ["../*/__fixtures__/*.json", "../*/__render__/*.json"],
  { eager: true },
);

const STALE_SUFFIX = "-stopped-arriving";

/**
 * Stale scenes that render byte-identical to their live twin: widgets that give
 * an operator no way to tell the link has gone. Shrink-only. A scene that
 * starts to differ must come off, and a new one may not go on.
 */
const UNCHANGED_DEBT = new Set([
  "contract-manager / multiple-active-contracts-stopped-arriving",
  "experiments / instruments-holding-data-stopped-arriving",
  "power-systems / 02-battery-draining-high-load-stopped-arriving",
  "system-view / kerbin-orbit-comms-active-stopped-arriving",
]);

interface Scene {
  name: string;
  stale: Record<string, unknown>;
  live: Record<string, unknown> | undefined;
}

/** Whether a fixture's `_stream` block stages the link dropping. */
function stopsArriving(stream: unknown): boolean {
  return (
    typeof stream === "object" &&
    stream !== null &&
    "stopsArriving" in stream &&
    stream.stopsArriving === true
  );
}

function staleScenes(fixturesPath: string): Scene[] {
  const needle = `../${fixturesPath}/`;
  const inDir = new Map(
    Object.entries(FIXTURE_MODULES)
      .filter(
        ([path]) =>
          path.startsWith(needle) && !path.slice(needle.length).includes("/"),
      )
      .map(([path, mod]) => [
        path.slice(needle.length).replace(/\.json$/, ""),
        mod.default,
      ]),
  );
  return [...inDir]
    .filter(([, fixture]) => stopsArriving(fixture._stream))
    .map(([name, stale]) => ({
      name,
      stale,
      live: name.endsWith(STALE_SUFFIX)
        ? inDir.get(name.slice(0, -STALE_SUFFIX.length))
        : undefined,
    }));
}

/** The biggest mode that does not override config, so the widget draws the most it can. */
function roomiest(modes: readonly WidgetSnapshotMode[]): WidgetSnapshotMode {
  const plain = modes.filter((m) => m.config === undefined);
  const pool = plain.length > 0 ? plain : modes;
  return pool.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  });
}

type Widget = Parameters<typeof renderWidgetMode>[0]["Widget"];

interface Rendered {
  text: string;
  html: string;
  announced: number;
  silent: number;
  noAsOf: number;
}

async function rendered(
  Widget: Widget,
  fixture: Record<string, unknown>,
  mode: WidgetSnapshotMode,
): Promise<Rendered> {
  const { container, teardown } = await renderWidgetMode({
    Widget,
    fixture,
    mode,
  });
  try {
    await settle();
    let announced = 0;
    let silent = 0;
    let noAsOf = 0;
    for (const mark of container.querySelectorAll("[data-not-current]")) {
      const caption = mark.querySelector("[data-unit-currency]");
      if (caption === null) silent++;
      else {
        announced++;
        if (!/as of/.test(caption.textContent ?? "")) noAsOf++;
      }
    }
    return {
      text: visibleText(container),
      html: normaliseReactIds(container.innerHTML),
      announced,
      silent,
      noAsOf,
    };
  } finally {
    teardown();
  }
}

/** What the stale text says that the live text does not, word by word, trimmed. */
function added(live: string, stale: string): string {
  const had = new Set(live.split(/\s+/));
  const extra = stale.split(/\s+/).filter((word) => word && !had.has(word));
  const said = extra.join(" ");
  return said.length > 90 ? `${said.slice(0, 87)}...` : said;
}

function outcome(stale: Rendered, live: Rendered | undefined): string {
  if (stale.silent > 0) return "SILENT";
  if (stale.announced > 0) return "announces";
  if (live === undefined) return "marks nothing";
  if (live.html === stale.html) return "UNCHANGED";
  if (live.text === stale.text) return "restyled only";
  return "marks nothing, says";
}

const results = new Map<
  string,
  { live?: Rendered; stale?: Rendered; note: string; id: string }
>();

describe("every stale scene says the link has gone", () => {
  for (const widget of listWidgets()) {
    const scenes = staleScenes(widget.fixturesPath);
    if (scenes.length === 0) continue;
    const def = getComponent(widget.widgetId);
    const label = widget.label ?? widget.widgetId;
    const mode = roomiest(
      widget.modes.length > 0
        ? widget.modes
        : [{ name: "default", w: 6, h: 6 }],
    );
    for (const scene of scenes) {
      const key = `${label.padEnd(26)} ${scene.name}`;
      results.set(key, {
        note: scene.live ? "" : " (no live twin)",
        id: `${label} / ${scene.name}`,
      });
      it(`${label} / ${scene.name} stale`, async () => {
        expect(def, `${widget.widgetId} is registered`).toBeDefined();
        if (!def) return;
        const stale = await rendered(
          def.component as Widget,
          scene.stale,
          mode,
        );
        const entry = results.get(key);
        if (entry) entry.stale = stale;
        expect(stale.silent).toBe(0);
      });
      if (scene.live) {
        const live = scene.live;
        it(`${label} / ${scene.name} live`, async () => {
          if (!def) return;
          const entry = results.get(key);
          if (entry)
            entry.live = await rendered(def.component as Widget, live, mode);
        });
      }
    }
  }
  /*
   * After every scene has rendered, because the verdict needs both halves of a
   * pair and they mount in separate tests.
   */
  it("changes something in every stale scene, beyond the debt it already carries", () => {
    const unchanged = [...results.values()]
      .filter(
        ({ live, stale }) =>
          live !== undefined && stale !== undefined && live.html === stale.html,
      )
      .map(({ id }) => id)
      .sort();
    expect(unchanged).toEqual([...UNCHANGED_DEBT].sort());
  });

  it("reports", () => {
    const rows = [...results].map(([key, { live, stale, note }]) => {
      if (!stale) return `${key}  NOT RENDERED`;
      const verdict = outcome(stale, live);
      const says =
        verdict === "marks nothing, says" && live
          ? `  "${added(live.text, stale.text)}"`
          : "";
      return `${key.padEnd(80)} ${verdict.padEnd(20)} announced=${stale.announced} no-as-of=${stale.noAsOf}${note}${says}`;
    });
    console.info(`\n${rows.join("\n")}\n`);
  });
});
