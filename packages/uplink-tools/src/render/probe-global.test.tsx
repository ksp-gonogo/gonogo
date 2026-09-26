// @vitest-environment jsdom
import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { Dial, Gauge, Tape, Unit } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { announcesHeld } from "./probe-global";

const HELD: Reading<Value<"rpm">> = {
  state: "stale",
  reckoning: { status: "none" },
  value: value("rpm", 240),
  asOfUt: value("ut", 12_000),
  grade: "held-stale",
};

const SCALE = { min: value("rpm", 0), max: value("rpm", 460) } as const;

function marked(container: HTMLElement): Element {
  const el = container.querySelector("[data-not-current]");
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
      <svg role="img" aria-label="Rotor: 240 rpm" data-not-current="" />,
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
