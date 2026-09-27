import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Countdown } from "./Countdown";
import { NULL_DISPLAY } from "./NullValue";

/**
 * Which number a clock draws: it advances only where a model is carrying the
 * value, freezes otherwise, and marks a held reading either way. The
 * difference is invisible in a single render.
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
      atUt: value("ut", 0),
      beyondReceived: false,
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
    // The observation is 90s and the model says 42s; drawing 90 would count down to an instant already passed.
    const { container } = render(
      <Countdown value={reckoned(value("s", 90), value("s", 42))} />,
    );
    expect(container.textContent).toContain("42s");
    expect(container.textContent).not.toContain("1min 30s");
  });

  it("FREEZES on the last observation where nothing is carrying it", () => {
    const { container } = render(<Countdown value={frozen(value("s", 90))} />);
    // The OBSERVATION, not a model's later answer.
    expect(container.textContent).toContain("1min 30s");
  });

  it("marks a held reading, whether it froze or advanced", () => {
    const held = render(<Countdown value={frozen(value("s", 90))} />);
    expect(held.container.querySelector("[data-held-mark]")).not.toBeNull();

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
    expect(carried.container.querySelector("[data-held-mark]")).not.toBeNull();
    // Still the model's number: staleness marks it, it does not freeze it.
    expect(carried.container.textContent).toContain("42");
  });

  it("adds no mark while the reading is current", () => {
    const { container } = render(
      <Countdown value={reckoned(value("s", 90), value("s", 42))} />,
    );
    expect(container.querySelector("[data-held-mark]")).toBeNull();
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

describe("Countdown under signal delay", () => {
  /** Current, and carried by a model across the light-time to the craft's present. */
  function carriedToScet(
    observed: Value<"s">,
    modelled: Value<"s">,
  ): Reading<Value<"s">> {
    const reading = reckoned(observed, modelled);
    if (reading.reckoning.status !== "available") return reading;
    return {
      ...reading,
      reckoning: { ...reading.reckoning, beyondReceived: true },
    };
  }

  it("marks a current reading whose figure the model carried beyond the received edge", () => {
    const { container } = render(
      <Countdown value={carriedToScet(value("s", 90), value("s", 42))} />,
    );
    expect(container.textContent).toContain("42s");
    const host = container.querySelector("[data-held]");
    expect(host).not.toBeNull();
    expect(host?.querySelector("[data-held-mark]")).not.toBeNull();
    expect(host?.getAttribute("title")).toBeTruthy();
  });

  it.each([
    "pending",
    "unowned",
    "absent",
  ] as const)("draws nothing modelled for a %s reading", (state) => {
    const withModel = {
      state,
      reckoning: {
        status: "available",
        atUt: value("ut", 0),
        beyondReceived: true,
        modelled: value("s", 42),
        basis: "linear-dead-reckoning",
      },
    } as const satisfies Reading<Value<"s">>;
    const { container } = render(<Countdown value={withModel} />);
    expect(container.textContent).toBe(NULL_DISPLAY);
  });
});

describe("Countdown's held caption", () => {
  it("reaches the accessibility tree, not only the hover", () => {
    const { container } = render(<Countdown value={frozen(value("s", 90))} />);
    const host = container.querySelector("[data-held]");
    const caption = host?.getAttribute("title");
    expect(caption).toBeTruthy();
    expect(container.textContent).toContain(`, ${caption}`);
  });
});
