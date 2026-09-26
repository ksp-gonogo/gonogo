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
 * Which declared inputs have a visible consequence, measured. Every widget
 * with render fixtures, every declared channel its fixtures emit, rendered
 * whole and with that one channel never arriving at `defaultSize`. A
 * byte-identical pair is either a figure with no reading behind it or an
 * overstated declaration; this narrows the list, it does not tell which.
 *
 * Opt-in, since it takes minutes and answers a survey question:
 *
 *   ABSENCE_PROBE=1 ABSENCE_PROBE_OUT=/tmp/probe.json \
 *     pnpm --filter @ksp-gonogo/components exec vitest run absenceConsequence
 *
 * Blind to widgets on legacy `dataRequirements` (no channels declared) and to
 * controls that render only after a click.
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
  /** Legacy flat keys the fixture also carries, fed through a `MockDataSource`, which weakens the row. */
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
      // A scene staged as held is `stopsArriving`'s question.
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
