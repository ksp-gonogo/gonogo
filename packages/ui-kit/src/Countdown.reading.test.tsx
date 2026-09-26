import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Countdown } from "./Countdown";
import { NULL_DISPLAY } from "./NullValue";

/**
 * The reckoning slot: which number a clock draws, and when it moves.
 *
 * The ruled behaviour is that `Countdown` does NOT choose. It advances only
 * where a model is carrying the value, freezes otherwise, and marks a held
 * reading either way. These pin all three, because the difference between a
 * countdown that advances and one that does not is invisible in a single
 * render and is the whole point of the ticket.
 */

const AT = value("ut", 1_000);

/** Observed, with a model that has carried the value on to `modelled`. */
function reckoned(
  observed: Value<"s">,
  modelled: Value<"s">,
): Reading<Value<"s">> {
  return {
    state: "observed",
    value: observed,
    atUt: AT,
    reckoning: {
      status: "available",
      modelled,
      basis: "linear-dead-reckoning",
    },
  };
}

/** Held, and nothing is carrying it. */
function frozen(observed: Value<"s">): Reading<Value<"s">> {
  return {
    state: "stale",
    value: observed,
    asOfUt: AT,
    grade: "held-stale",
    reckoning: { status: "none" },
  };
}

describe("Countdown, handed a Reading", () => {
  it("draws a bare duration exactly as it always did", () => {
    const asReading = render(
      <Countdown
        value={{
          state: "observed",
          value: value("s", 90),
          atUt: AT,
          reckoning: { status: "none" },
        }}
      />,
    );
    const asValue = render(<Countdown value={value("s", 90)} />);
    expect(asReading.container.innerHTML).toBe(asValue.container.innerHTML);
  });

  it("ADVANCES on the model's answer where one is carrying it", () => {
    // The observation is 90s; the model says 42s at this frame's view time.
    // A clock that drew the observation here would be counting down to an
    // instant the model has already moved past.
    const { container } = render(
      <Countdown value={reckoned(value("s", 90), value("s", 42))} />,
    );
    expect(container.textContent).toContain("42s");
    expect(container.textContent).not.toContain("1min 30s");
  });

  it("FREEZES on the last observation where nothing is carrying it", () => {
    const { container } = render(<Countdown value={frozen(value("s", 90))} />);
    // 90 seconds reads as "1min 30s"; what matters is that it is the
    // OBSERVATION and not a model's later answer.
    expect(container.textContent).toContain("1min 30s");
  });

  it("marks a held reading, whether it froze or advanced", () => {
    const held = render(<Countdown value={frozen(value("s", 90))} />);
    expect(
      held.container.querySelector("[data-not-current-mark]"),
    ).not.toBeNull();

    const carried = render(
      <Countdown
        value={{
          ...reckoned(value("s", 90), value("s", 42)),
          state: "stale",
          asOfUt: AT,
          grade: "held-stale",
        }}
      />,
    );
    expect(
      carried.container.querySelector("[data-not-current-mark]"),
    ).not.toBeNull();
    // Still the model's number: staleness marks it, it does not freeze it.
    expect(carried.container.textContent).toContain("42");
  });

  it("adds no mark while the reading is current", () => {
    const { container } = render(
      <Countdown value={reckoned(value("s", 90), value("s", 42))} />,
    );
    expect(container.querySelector("[data-not-current-mark]")).toBeNull();
  });

  it("keeps the clock prefix and the sub-second rung working", () => {
    const { container } = render(
      <Countdown value={frozen(value("s", 90))} clock />,
    );
    expect(container.textContent).toMatch(/T[−-]/);
  });

  it("renders the null token for a reading carrying no duration", () => {
    const { container } = render(
      <Countdown value={{ state: "pending", reckoning: { status: "none" } }} />,
    );
    expect(container.textContent).toBe(NULL_DISPLAY);
  });

  it("has no axe violations with the mark drawn", async () => {
    const { container } = render(<Countdown value={frozen(value("s", 90))} />);
    await expectNoA11yViolations(container);
  });
});

describe("Countdown's held caption", () => {
  it("reaches the accessibility tree, not only the hover", () => {
    const { container } = render(<Countdown value={frozen(value("s", 90))} />);
    const host = container.querySelector("[data-not-current]");
    const caption = host?.getAttribute("title");
    expect(caption).toBeTruthy();
    expect(container.textContent).toContain(`, ${caption}`);
  });
});
