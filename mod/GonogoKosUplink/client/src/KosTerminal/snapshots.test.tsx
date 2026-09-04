/**
 * DOM-snapshot regression tests for the kOS Terminal widget.
 *
 * Catches structural drift (rendered text, element order, attribute changes)
 * across every fixture x mode combination registered for the widget in
 * `scripts/widgets.ts`. These two fixtures and their modes came out of
 * `@ksp-gonogo/components`'s render catalogue, where the widget's pictures
 * used to be taken from even though its source has always lived here: the
 * pictures now come from the `_scene` fixtures beside this folder's `probe/`
 * subfolder, driven by `gonogo-uplink render`, and the structural half is
 * this file.
 *
 * The `char-mode-badges` scenario carries the one state no `_scene` fixture
 * reaches: char mode (so the delay reads as a standing badge rather than the
 * in-transit strip) with `comms.link.connected === false` under it, which is
 * what puts the NoPathBadge on screen. It is asserted by name below rather
 * than left to a snapshot, because a snapshot that silently loses a badge
 * still passes once it is regenerated.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/gonogo-kos-uplink exec vitest run src/KosTerminal/snapshots -u`.
 */
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import {
  flushProviderFrame,
  flushResizeObservers,
  installSizedResizeObserver,
  modePixels,
  replayStreamBlock,
  resolveStreamBlock,
  stripVolatile,
} from "../test/widgetDomSnapshot";
import basicSession from "./__fixtures__/probe/basic-session.json";
import charModeBadges from "./__fixtures__/probe/char-mode-badges.json";
// Side-effect import: the widget self-registers on module load, and
// `renderWidget` looks it up by id rather than importing the component.
import "./index";

const FIXTURES: Record<string, Record<string, unknown>> = {
  "basic-session": basicSession as Record<string, unknown>,
  "char-mode-badges": charModeBadges as Record<string, unknown>,
};

const config = getWidget("kos-terminal");
if (!config) throw new Error("kos-terminal missing from widgets.ts");

interface Mode {
  name: string;
  w: number;
  h: number;
  config?: Record<string, unknown>;
  forFixtures?: readonly string[];
}

/**
 * The carried set is the fixture's own, not the widget's registration: the
 * terminal frame topic is `kos.terminal.<coreId>`, addressed per CPU, so it
 * has no fixed member on `channels` for a registration-derived set to find.
 */
async function snapshotMode(
  fixture: Record<string, unknown>,
  mode: Mode,
): Promise<string> {
  const block = resolveStreamBlock(fixture);
  if (!block) throw new Error("fixture carries no _stream block");
  const stream = setupStreamFixture({
    carriedChannels: block.carriedChannels,
    pinnedUt: block.pinnedUt,
    delaySeconds: block.delaySeconds,
  });
  const restoreResizeObserver = installSizedResizeObserver(modePixels(mode));
  try {
    const { container } = renderWidget("kos-terminal", {
      instanceId: "snap",
      config: mode.config ?? {},
      w: mode.w,
      h: mode.h,
      wrapper: stream.Provider,
    });

    await replayStreamBlock(stream, block);
    await flushProviderFrame();
    await flushResizeObservers();

    return stripVolatile(container.innerHTML);
  } finally {
    restoreResizeObserver();
  }
}

function modesFor(name: string): Mode[] {
  return (config as { modes: Mode[] }).modes.filter(
    (m) => !m.forFixtures || m.forFixtures.includes(name),
  );
}

describe("KosTerminal DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of modesFor(name)) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotMode(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});

describe("KosTerminal delay chrome", () => {
  const charMode = modesFor("char-mode-badges").find((m) =>
    m.name.startsWith("char-mode-"),
  );
  if (!charMode) throw new Error("no char-mode mode in widgets.ts");

  it("shows the no-path warning and the standing delay badge in char mode", async () => {
    const html = await snapshotMode(FIXTURES["char-mode-badges"], charMode);
    expect(html).toContain("No path: commands are not being sent");
    expect(html).toContain("one-way");
  });
});
