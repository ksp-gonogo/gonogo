import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * The control-state tone: which colour the Control readout and the signal bars
 * are painted, given a `Sitrep.Contract.ControlState` ordinal off the wire.
 *
 * Both surfaces read the SAME tone through two separate code paths (the bar
 * fill and the grid value's text colour), so each case asserts both. A probe
 * with no control that paints green in one of them is the bug this file exists
 * for: an operator reads "healthy link" off a vessel that cannot be commanded.
 */

// `deriveVesselState` yields no record until `vessel.orbit` is whole, and the
// derived commsControlState fields hang off that record.
const ORBIT = {
  sma: 682500,
  ecc: 0.00367,
  inc: 0.3,
  argPe: 12.5,
  mu: 3.5316e12,
  meanAnomalyAtEpoch: 0,
  epoch: 10,
  referenceBodyIndex: 1,
};

// Bar fills and text colours per tone, copied from the widget's own tables so a
// test failure names the tone that was painted rather than a hex string.
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

/**
 * Every `ControlState` ordinal, its enum NAME, and the tone the readout owes it.
 *
 * `Unknown` (11) is the one ordinal that carries no verdict: it collapses to an
 * `undefined` level BY DESIGN, so it must read neutral. Painting it `lost`
 * would assert a link failure the wire never reported.
 */
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
    carriedChannels: [
      "comms.link",
      "vessel.comms",
      "comms.delay",
      "vessel.state",
    ],
    pinnedUt: 10,
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

/**
 * The Control row's VALUE cell, found via its label rather than its text: an
 * absent delay renders NULL_DISPLAY too, so matching on the text alone is
 * ambiguous in exactly the not-yet-arrived case this file cares most about.
 */
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
        // A live signal strength alongside the control state, so the bars are
        // LIT and their tone is observable: an unlit bar is border-subtle
        // whatever the tone, which would hide the bug on this path entirely.
        fixture.emit("vessel.comms", {
          connected: true,
          signalStrength: 0.82,
          controlState: ordinal,
        });
        fixture.emit("vessel.orbit", ORBIT);
      });

      await waitFor(() => expect(controlValueCell()).toHaveTextContent(name));

      // Soft, so one run names BOTH surfaces that got it wrong. The text
      // colour and the bar fill are separate code paths reading one tone, and
      // a hard assert on the first would hide whatever the second did.
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

  /**
   * The arm most likely to be lost to a later "undefined means no control"
   * simplification. A channel that has not arrived reported nothing, so the
   * readout owes the operator neutral, not a link failure.
   */
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
