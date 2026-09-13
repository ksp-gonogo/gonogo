import { ScreenProvider } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { VantageControl } from "./VantageControl";

const ROSTER = [
  { id: "ksc", displayName: "KSC", active: true },
  { id: "ground:gs1", displayName: "Woomera Station", active: true },
];

/** Mounts the picker (main screen). */
function mountPicker() {
  const fixture = setupStreamFixture({
    carriedChannels: ["commandCentre.roster"],
    pinnedUt: 10,
  });
  const view = render(
    <fixture.Provider>
      <ScreenProvider value="main">
        <VantageControl />
      </ScreenProvider>
    </fixture.Provider>,
  );
  const emitRoster = (roster: unknown, vantage = "ksc") => {
    act(() => {
      fixture.emit("commandCentre.roster", roster, { vantage });
      fixture.store.beginFrame();
    });
  };
  emitRoster(ROSTER);
  return { ...fixture, ...view, emitRoster };
}

/** Mounts the picker and opens its dropdown so option rows are in the tree. */
function mountOpenPicker() {
  const picker = mountPicker();
  fireEvent.click(screen.getByRole("button"));
  return picker;
}

describe("VantagePicker's home badge carries an icon, not the word 'Home'", () => {
  it("announces the home centre's option as home, and leaves a non-home option unmarked", () => {
    const fixture = mountOpenPicker();

    const homeOption = screen.getByRole("option", { name: /KSC.*Home/ });
    const otherOption = screen.getByRole("option", {
      name: "Woomera Station",
    });

    expect(homeOption).toBeInTheDocument();
    expect(otherOption).toBeInTheDocument();
    /* The glyph inside the badge is aria-hidden; a visually hidden "Home" beside it is what actually carries the word into the accessible name, so a non-home option must not pick it up from anywhere else. */
    expect(
      screen.queryByRole("option", { name: "Woomera Station Home" }),
    ).toBeNull();

    fixture.unmount();
  });

  it("draws the home glyph only on the home row", () => {
    const fixture = mountOpenPicker();

    const homeOption = screen.getByRole("option", { name: /KSC.*Home/ });
    const otherOption = screen.getByRole("option", {
      name: "Woomera Station",
    });

    expect(homeOption.querySelector("svg")).not.toBeNull();
    expect(otherOption.querySelector("svg")).toBeNull();

    fixture.unmount();
  });

  it("shows the home glyph on the closed trigger for the home centre", () => {
    const fixture = mountPicker();

    /* Two svgs on a home trigger (the home glyph plus the chevron that is always there), against one on a non-home selection: see the next test. */
    const trigger = screen.getByRole("button");
    expect(trigger.querySelectorAll("svg")).toHaveLength(2);

    fixture.unmount();
  });

  it("draws only the chevron on the closed trigger for a non-home selection", () => {
    const fixture = mountPicker();
    fixture.emitRoster([
      { id: "ksc", displayName: "KSC", active: true },
      { id: "ground:gs1", displayName: "Woomera Station", active: true },
    ]);

    fireEvent.click(screen.getByRole("button"));
    /* The listbox selects on pointerdown (so the input doesn't lose focus and dismiss the dropdown before the click lands), not on click. */
    fireEvent.pointerDown(
      screen.getByRole("option", { name: "Woomera Station" }),
    );

    const trigger = screen.getByRole("button");
    expect(trigger.querySelectorAll("svg")).toHaveLength(1);

    fixture.unmount();
  });

  it("has no a11y violations with the picker open", async () => {
    const fixture = mountOpenPicker();

    await expectNoA11yViolations(fixture.container);

    fixture.unmount();
  });
});
