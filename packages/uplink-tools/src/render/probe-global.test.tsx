// @vitest-environment jsdom
import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { Dial, Gauge, Tape, Unit } from "@ksp-gonogo/ui-kit";
import { useId } from "react";
import { describe, expect, it } from "vitest";
import { announcesHeld, describeElements } from "./probe-global";

const HELD: Reading<Value<"rpm">> = {
  state: "stale",
  reckoning: { status: "none" },
  value: value("rpm", 240),
  asOfUt: value("ut", 12_000),
  grade: "held-stale",
};

const SCALE = { min: value("rpm", 0), max: value("rpm", 460) } as const;

function marked(container: HTMLElement): Element {
  const el = container.querySelector("[data-held]");
  if (el === null) throw new Error("nothing was drawn held");
  return el;
}

describe("announcesHeld, on what the kit draws", () => {
  it("hears a held Unit through its caption", () => {
    const { container } = render(<Unit value={HELD} />);
    expect(announcesHeld(marked(container))).toBe(true);
  });

  it.each([
    [
      "Gauge",
      <Gauge key="g" value={HELD} {...SCALE} width={160} height={90} />,
    ],
    ["Tape", <Tape key="t" value={HELD} {...SCALE} width={60} height={200} />],
    ["Dial", <Dial key="d" value={HELD} {...SCALE} width={120} height={120} />],
  ])("hears a held %s through its accessible name", (_, instrument) => {
    const { container } = render(instrument);
    const el = marked(container);
    expect(el.getAttribute("aria-label")).toMatch(/, [A-Z]+/);
    expect(announcesHeld(el)).toBe(true);
  });

  it("calls a held mark with neither caption nor marker silent", () => {
    const { container } = render(
      <svg role="img" aria-label="Rotor: 240 rpm" data-held="" />,
    );
    expect(announcesHeld(marked(container))).toBe(false);
  });

  it("does not stamp a current instrument", () => {
    const { container } = render(
      <Gauge value={value("rpm", 240)} {...SCALE} width={160} height={90} />,
    );
    expect(container.querySelector("[data-currency-in-name]")).toBeNull();
  });
});

/** An SVG clip keyed on a useId with its colons stripped, which `url(#...)` needs. */
function ClippedDial({ label }: { label?: string }) {
  const clipId = `dial-clip-${useId().replace(/:/g, "")}`;
  return (
    <svg role="img" aria-label={label ?? "Dial"} data-part="r1">
      <clipPath id={clipId}>
        <circle r={10} />
      </clipPath>
      <g
        clipPath={`url(#${clipId})`}
        aria-labelledby={`${clipId} dial-caption`}
      />
      <text id="dial-caption">r1</text>
    </svg>
  );
}

describe("describeElements, across two renders of one state", () => {
  it("folds a colon-stripped useId in an id and in every reference to it", () => {
    const first = describeElements(render(<ClippedDial />).container);
    const second = describeElements(render(<ClippedDial />).container);
    expect(second).toEqual(first);
  });

  it("keeps a genuine difference, and a lookalike outside an id position", () => {
    const plain = describeElements(render(<ClippedDial />).container);
    const renamed = describeElements(
      render(<ClippedDial label="Rotor" />).container,
    );
    expect(renamed).not.toEqual(plain);
    expect(plain.join("\n")).toContain('data-part="r1"');
    expect(plain.join("\n")).toContain("> r1");
  });
});

describe("describeElements, on a library's per-instance class token", () => {
  const terminal = (owner: number, extra = "") =>
    describeElements(
      render(
        <div
          className={`terminal xterm xterm-dom-renderer-owner-${owner}${extra}`}
        >
          $
        </div>,
      ).container,
    );

  it("folds xterm's renderer owner counter", () => {
    expect(terminal(3)).toEqual(terminal(1));
  });

  it("compares a numbered class no library is listed for as written", () => {
    expect(terminal(1, " chart-owner-1")).not.toEqual(
      terminal(1, " chart-owner-3"),
    );
  });
});
