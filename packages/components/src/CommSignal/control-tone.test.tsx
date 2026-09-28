import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * Every `ControlState` ordinal paints the right tone in both the signal bars
 * and the Control row, which are separate code paths reading one tone. A probe
 * with no control must never paint green in either.
 */

// Bar fills and text colours per tone, copied from the widget's own tables so a test failure names the tone that was painted rather than a hex string.
const BAR_FILL = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  lost: "var(--color-status-nogo-bg)",
  neutral: "var(--color-text-muted)",
} as const;
const TEXT_COLOR = {
  ok: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-fg-muted)",
  lost: "var(--color-status-nogo-fg)",
  neutral: "var(--color-text-primary)",
} as const;
const UNLIT_FILL = "var(--color-border-subtle)";

type Tone = keyof typeof BAR_FILL;

// `Unknown` (11) carries no verdict, so it reads neutral rather than lost.

const CASES: ReadonlyArray<{ ordinal: number; name: string; tone: Tone }> = [
  { ordinal: 0, name: "None", tone: "lost" },
  { ordinal: 1, name: "Probe", tone: "ok" },
  { ordinal: 2, name: "Kerbal", tone: "ok" },
  { ordinal: 3, name: "Partial", tone: "warn" },
  { ordinal: 4, name: "Full", tone: "ok" },
  { ordinal: 5, name: "ProbeNone", tone: "lost" },
  { ordinal: 6, name: "ProbePartial", tone: "warn" },
  { ordinal: 7, name: "ProbeFull", tone: "ok" },
  { ordinal: 8, name: "KerbalNone", tone: "lost" },
  { ordinal: 9, name: "KerbalPartial", tone: "warn" },
  { ordinal: 10, name: "KerbalFull", tone: "ok" },
  { ordinal: 11, name: "Unknown", tone: "neutral" },
];

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderComm(fixture: ReturnType<typeof newFixture>) {
  const { unmount } = render(
    <fixture.Provider>
      <CommSignalComponent config={{}} id="comm" />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

/** Inline styles of the bars the chart actually lit, unlit ones excluded. */
function litBarStyles(): string[] {
  const chart = screen.getByRole("img", { name: /^Signal \d of 4$/ });
  return Array.from(chart.children)
    .map((bar) => bar.getAttribute("style") ?? "")
    .filter((style) => !style.includes(UNLIT_FILL));
}

// Found via its label: an absent delay renders NULL_DISPLAY too, so the text alone is ambiguous.

function controlValueCell(): HTMLElement {
  const cell = screen.getByText("Control").nextElementSibling;
  if (!(cell instanceof HTMLElement)) {
    throw new Error("the Control label has no value cell beside it");
  }
  return cell;
}

function controlValueStyle(): string {
  return controlValueCell().getAttribute("style") ?? "";
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("CommSignal control tone", () => {
  for (const { ordinal, name, tone } of CASES) {
    it(`paints ${name} (${ordinal}) as ${tone} in both the bars and the Control row`, async () => {
      const fixture = newFixture();
      renderComm(fixture);
      act(() => {
        fixture.emit("comms.link", { connected: true });
        // A live strength lights the bars, since an unlit bar hides its tone.
        fixture.emit("vessel.comms", {
          connected: true,
          signalStrength: 0.82,
          controlState: ordinal,
        });
      });

      await waitFor(() => expect(controlValueCell()).toHaveTextContent(name));

      // Soft, so one run names both surfaces that got it wrong.
      expect.soft(controlValueStyle()).toContain(TEXT_COLOR[tone]);
      for (const other of Object.keys(TEXT_COLOR) as Tone[]) {
        if (TEXT_COLOR[other] === TEXT_COLOR[tone]) continue;
        expect.soft(controlValueStyle()).not.toContain(TEXT_COLOR[other]);
      }

      const lit = litBarStyles();
      expect.soft(lit).toHaveLength(4);
      for (const style of lit) {
        expect.soft(style).toContain(BAR_FILL[tone]);
        for (const other of Object.keys(BAR_FILL) as Tone[]) {
          if (BAR_FILL[other] === BAR_FILL[tone]) continue;
          expect.soft(style).not.toContain(BAR_FILL[other]);
        }
      }
    });
  }

  // A channel that has not arrived reported nothing, so it is not a link failure.
  it("reads neutral, not lost, when the control channel has not arrived", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: true });
    });

    await waitFor(() =>
      expect(controlValueCell()).toHaveTextContent(NULL_DISPLAY),
    );

    const style = controlValueStyle();
    expect(style).toContain(TEXT_COLOR.neutral);
    expect(style).not.toContain(TEXT_COLOR.lost);
    expect(style).not.toContain(TEXT_COLOR.ok);
    expect(style).not.toContain(TEXT_COLOR.warn);
  });
});
