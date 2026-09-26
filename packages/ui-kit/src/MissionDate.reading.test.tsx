import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { MissionDate } from "./MissionDate";

/**
 * The reckoning slot: what `<MissionDate>` draws when handed a whole
 * `Reading`.
 *
 * Less than a figure needs, and deliberately. A stale INSTANT stays true: a
 * date does not drift while nobody is looking, so nothing is withheld, nothing
 * is recomputed, and no band is placed. What a held reading adds is the mark,
 * and the grade behind it on hover.
 */

const AT = value("ut", 9_201_600);

function held(instant: Value<"ut">): Reading<Value<"ut">> {
  return {
    state: "stale",
    reckoning: { status: "none" },
    value: instant,
    asOfUt: AT,
    grade: "held-stale",
  };
}

function observed(instant: Value<"ut">): Reading<Value<"ut">> {
  return {
    state: "observed",
    value: instant,
    atUt: AT,
    reckoning: { status: "none" },
  };
}

describe("MissionDate, handed a Reading", () => {
  it("draws an observed reading exactly as it draws the bare instant", () => {
    const asReading = render(<MissionDate value={observed(AT)} />);
    const asValue = render(<MissionDate value={AT} />);
    expect(asReading.container.innerHTML).toBe(asValue.container.innerHTML);
  });

  it("still draws the date itself when it is no longer current", () => {
    const bare = render(<MissionDate value={AT} />).container.textContent;
    const { container } = render(<MissionDate value={held(AT)} />);
    // A stale instant stays true, so the date is unchanged; only the mark and
    // its spoken caption are added. This is the whole difference from a figure.
    expect(container.textContent?.startsWith(bare ?? "")).toBe(true);
  });

  it("marks a held instant the way a Unit does", () => {
    const { container } = render(<MissionDate value={held(AT)} />);
    expect(container.querySelector("[data-not-current]")).not.toBeNull();
    expect(container.querySelector("[data-not-current-mark]")).not.toBeNull();
  });

  it("says the grade and the last-valid instant on hover", () => {
    const { container } = render(<MissionDate value={held(AT)} />);
    expect(
      container.querySelector("[data-not-current]")?.getAttribute("title"),
    ).toMatch(/^STALE/);
  });

  it("adds no mark at all while the instant is a reading of now", () => {
    const { container } = render(<MissionDate value={observed(AT)} />);
    expect(container.querySelector("[data-not-current-mark]")).toBeNull();
  });

  it("keeps the clock qualifier working beside the mark", () => {
    const { container } = render(
      <MissionDate value={held(AT)} context={{ frame: "scet" }} />,
    );
    expect(container.textContent).toContain("SCET");
    expect(container.querySelector("[data-not-current-mark]")).not.toBeNull();
  });

  it("has no axe violations with the mark drawn", async () => {
    const { container } = render(
      <MissionDate value={held(AT)} context={{ frame: "scet" }} />,
    );
    await expectNoA11yViolations(container);
  });
});

describe("MissionDate's held caption", () => {
  it("reaches the accessibility tree, not only the hover", () => {
    const { container } = render(<MissionDate value={held(AT)} />);
    const caption = container
      .querySelector("[data-not-current]")
      ?.getAttribute("title");
    expect(caption).toBeTruthy();
    expect(container.textContent).toContain(`, ${caption}`);
  });
});
