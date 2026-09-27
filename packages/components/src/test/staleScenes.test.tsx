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
 * Every scene staged as no longer arriving, rendered beside its live twin and
 * read for what the widget does about it. Four outcomes: a held figure marked
 * through `Unit` announces with a `[data-unit-currency]` caption (an instrument
 * does it at the end of its accessible name and stamps `data-currency-in-name`);
 * one marked with neither is silent, which only a render can tell apart; a
 * widget can withdraw a judgement instead; or it can change nothing, which
 * leaves an operator no way to tell the link has gone.
 *
 * "Nothing" is judged on markup with style classes kept: a dimmed panel
 * differs only in a class. Live and stale mount in separate tests, since two
 * action-registering mounts in one test trip the perf gate.
 */

const FIXTURE_MODULES = import.meta.glob<{ default: Record<string, unknown> }>(
  [
    "../*/__fixtures__/*.json",
    "../*/__fixtures__/*/*.json",
    "../*/__render__/*.json",
  ],
  { eager: true },
);

const STALE_SUFFIX = "-stopped-arriving";

/** Stale scenes rendering byte-identical to their live twin. Shrink-only. */
const UNCHANGED_DEBT = new Set<string>([]);

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

/**
 * The accessible name an instrument says its currency in, or null where the kit
 * stamped no `data-currency-in-name`, which it sets only on a name it ended
 * with a caption.
 */
function instrumentCaption(mark: Element): string | null {
  return mark.hasAttribute("data-currency-in-name")
    ? mark.getAttribute("aria-label")
    : null;
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
    for (const mark of container.querySelectorAll("[data-held]")) {
      const caption =
        mark.querySelector("[data-unit-currency]")?.textContent ??
        instrumentCaption(mark);
      if (caption === null) silent++;
      else {
        announced++;
        if (!/as of/.test(caption)) noAsOf++;
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
  // After every scene, since the verdict needs both halves of each pair.
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
