import { getComponent } from "@ksp-gonogo/core";
import { act } from "@ksp-gonogo/test-utils";
import { unannouncedHeldMarks, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { listWidgets } from "../../scripts/widgets";
// Importing the package index self-registers every built-in component.
import "../index";
import { type Figure, figuresIn, unmarkedStaleFigures } from "./staleFigures";
import {
  normaliseReactIds,
  renderWidgetMode,
  type WidgetSnapshotMode,
} from "./widgetDomSnapshot";

/**
 * Every scene staged as no longer arriving, rendered beside its live twin and
 * read for what the widget does about it. Four outcomes: every held mark
 * announces its grade aloud and on hover (`unannouncedHeldMarks`); a mark that
 * does not is silent, which only a render can tell apart; a widget can
 * withdraw a judgement instead; or it can change nothing, which leaves an
 * operator no way to tell the link has gone.
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

/**
 * Per stale scene, how many figures it draws identical to its live twin while
 * marked as neither held nor static: a number that stopped arriving shown as if
 * it were current. Exact, so a fix has to lower the entry it cleared. Never add
 * one: a figure that cannot go stale is declared `[SitrepStatic]` on the
 * contract, and every other figure is marked.
 */
const UNMARKED_FIGURE_DEBT: Readonly<Record<string, number>> = {
  "astronaut-complex / active-crew-multi-situation-stopped-arriving": 2,
  "libration-points / mun-l2-drifting-stopped-arriving": 2,
  "libration-points / mun-l2-path-withheld-stopped-arriving": 2,
  "strategies / one-active-room-for-more-stopped-arriving": 1,
  "targeting / approach-closing-stopped-arriving": 1,
  "transfer-window / earth-mars-go-stopped-arriving": 8,
  "transfer-window / earth-mars-reach-band-stopped-arriving": 8,
};

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
  unannounced: string[];
  noAsOf: number;
  figures: Figure[];
}

/** What a held mark's host or instrument says around it, for the "as of" count. */
function spokenNear(mark: Element): string {
  const host = mark.parentElement;
  return (
    host?.querySelector("[data-unit-currency]")?.textContent ??
    mark.closest("[aria-label]")?.getAttribute("aria-label") ??
    ""
  );
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
    const marks = Array.from(container.querySelectorAll("[data-held-mark]"));
    const faults = unannouncedHeldMarks(container);
    const unannounced = faults.map((f) => `${f.fault}: ${f.where}`);
    const announced = marks.filter((m) => !faults.some((f) => f.mark === m));
    const noAsOf = announced.filter((m) => !/as of/.test(spokenNear(m))).length;
    return {
      text: visibleText(container),
      html: normaliseReactIds(container.innerHTML),
      announced: announced.length,
      unannounced,
      noAsOf,
      figures: figuresIn(container),
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
  if (stale.unannounced.length > 0) return "UNANNOUNCED";
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
        expect(stale.unannounced).toEqual([]);
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

  it("draws no held figure as current, beyond the debt it already carries", () => {
    const counts: Record<string, number> = {};
    const drawn: string[] = [];
    for (const { live, stale, id } of results.values()) {
      if (live === undefined || stale === undefined) continue;
      const unmarked = unmarkedStaleFigures(live.figures, stale.figures);
      if (unmarked.length === 0) continue;
      counts[id] = unmarked.length;
      drawn.push(`${id}: ${unmarked.join(" | ")}`);
    }
    expect(counts, `Drawn as current:\n${drawn.join("\n")}`).toEqual(
      UNMARKED_FIGURE_DEBT,
    );
  });

  it("reports", () => {
    const rows = [...results].map(([key, { live, stale, note }]) => {
      if (!stale) return `${key}  NOT RENDERED`;
      const verdict = outcome(stale, live);
      const says =
        verdict === "marks nothing, says" && live
          ? `  "${added(live.text, stale.text)}"`
          : "";
      const facts = stale.figures.filter((f) => f.isStatic).length;
      return `${key.padEnd(80)} ${verdict.padEnd(20)} announced=${stale.announced} no-as-of=${stale.noAsOf} static=${facts}${note}${says}`;
    });
    console.info(`\n${rows.join("\n")}\n`);
  });
});
