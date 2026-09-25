import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ComponentProps } from "@ksp-gonogo/core";
import { getComponents } from "@ksp-gonogo/core";
import type { ComponentType } from "react";
import { describe, it } from "vitest";
import "../index";
import { withoutChannel } from "./absenceScene";
import { snapshotWidgetMode } from "./widgetDomSnapshot";

/**
 * Which declared inputs have a VISIBLE consequence, measured rather than
 * reasoned about.
 *
 * For every widget with render fixtures, every fixture that declares a wire,
 * and every declared channel that fixture emits, this renders the widget twice
 * at its own `defaultSize`: once whole, once with that one channel never
 * arriving. A pair that comes back byte-identical means the widget draws the
 * same picture whether or not the input reached it, which is either a figure
 * drawn with no reading behind it or a declaration that overstates what the
 * widget consumes. It cannot tell those apart, and is not meant to: it narrows
 * hundreds of pairs to a list short enough to read one at a time.
 *
 * OPT-IN, because it takes minutes rather than seconds and answers a survey
 * question rather than a pass/fail one. The scenes in `absenceScenes.ts` are
 * the standing checks; this is how the next batch of them gets chosen.
 *
 *   ABSENCE_PROBE=1 ABSENCE_PROBE_OUT=/tmp/probe.json \
 *     pnpm --filter @ksp-gonogo/components exec vitest run absenceConsequence
 *
 * Two things it cannot see, both worth knowing before reading its output. A
 * widget still on legacy `dataRequirements` declares no channels at all, so it
 * is absent from the run entirely. And a control that renders only once
 * something has been clicked (a tech node expanded, a tab selected) is in
 * neither half of the pair, so an input gating ONLY such a control reads as
 * having no consequence when it has the sharpest one there is.
 */
const SRC = resolve(import.meta.dirname, "..");

const PAIRS: Array<[string, string]> = readFileSync(
  resolve(import.meta.dirname, "../../scripts/widgets.ts"),
  "utf8",
)
  .split("{")
  .flatMap((chunk) => {
    const id = /widgetId:\s*"([^"]+)"/.exec(chunk)?.[1];
    const path = /fixturesPath:\s*"([^"]+)"/.exec(chunk)?.[1];
    return id && path?.includes("__fixtures__")
      ? [[id, path] as [string, string]]
      : [];
  });

const OUT = process.env.ABSENCE_PROBE_OUT ?? "/tmp/absence-probe.json";
const ONLY = process.env.ABSENCE_PROBE_ONLY?.split(",");

interface Row {
  widget: string;
  fixture: string;
  channel: string;
  required: boolean;
  identical: boolean;
  /**
   * Legacy flat keys the fixture also carries, which the harness feeds through
   * a `MockDataSource` beside the wire. A widget still reading one of those is
   * fed twice, so its row says less than a row from a wire-only fixture.
   */
  legacyKeys: number;
  error?: string;
}

describe.runIf(process.env.ABSENCE_PROBE === "1")("absence consequence", () => {
  const rows: Row[] = [];
  const defs = getComponents();
  const seen = new Set<string>();
  for (const [id, path] of PAIRS) {
    if (seen.has(id + path)) continue;
    seen.add(id + path);
    if (ONLY && !ONLY.includes(id)) continue;
    const def = defs.find((d) => d.id === id);
    if (!def) continue;
    const declared = new Set<string>([
      ...(def.channels ?? []),
      ...(def.optionalChannels ?? []),
    ]);
    const dir = join(SRC, path);
    let names: string[];
    try {
      names = readdirSync(dir)
        .filter((n) => n.endsWith(".json"))
        .sort();
    } catch {
      continue;
    }
    const mode = {
      name: "declared",
      w: def.defaultSize?.w ?? 6,
      h: def.defaultSize?.h ?? 6,
    };
    for (const name of names) {
      const fixture = JSON.parse(readFileSync(join(dir, name), "utf8"));
      const stream = fixture._stream;
      if (!stream || !Array.isArray(stream.emits) || stream.emits.length === 0)
        continue;
      // A scene already staged as held is a different question, and
      // `stopsArriving` is where it is asked.
      if (stream.stopsArriving === true) continue;
      const channels = (
        [
          ...new Set(stream.emits.map((e: { channel: string }) => e.channel)),
        ] as string[]
      ).filter((c) => declared.has(c));
      if (channels.length === 0) continue;
      const legacyKeys = Object.keys(fixture).filter(
        (k) => !k.startsWith("_"),
      ).length;
      it(`${id} ${name}`, async () => {
        const healthy = await snapshotWidgetMode({
          Widget: def.component as ComponentType<
            ComponentProps<Record<string, unknown>>
          >,
          fixture,
          mode,
        });
        for (const channel of channels) {
          try {
            const degraded = await snapshotWidgetMode({
              Widget: def.component as ComponentType<
                ComponentProps<Record<string, unknown>>
              >,
              fixture: withoutChannel(fixture, channel),
              mode,
            });
            rows.push({
              widget: id,
              fixture: name,
              channel,
              required: (def.channels ?? []).some((c) => c === channel),
              identical: healthy === degraded,
              legacyKeys,
            });
          } catch (err) {
            rows.push({
              widget: id,
              fixture: name,
              channel,
              required: false,
              identical: false,
              legacyKeys,
              error: String(err).slice(0, 160),
            });
          }
        }
        writeFileSync(OUT, JSON.stringify(rows, null, 1));
      }, 300_000);
    }
  }
});
