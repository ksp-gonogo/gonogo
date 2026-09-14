import { ScreenProvider } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { VantageControl } from "./VantageControl";

const KSC = "ground:Kerbal Space Center";

const ROSTER = [
  { id: KSC, displayName: "KSC", active: true, isHome: true },
  {
    id: "ground:gs1",
    displayName: "Woomera Station",
    active: true,
    isHome: false,
  },
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
  const emitRoster = (roster: unknown, vantage = KSC) => {
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
    fixture.emitRoster(ROSTER);

    fireEvent.click(screen.getByRole("button"));
    /* The listbox selects on pointerdown (so the input doesn't lose focus and dismiss the dropdown before the click lands), not on click. */
    fireEvent.pointerDown(
      screen.getByRole("option", { name: "Woomera Station" }),
    );

    const trigger = screen.getByRole("button");
    expect(trigger.querySelectorAll("svg")).toHaveLength(1);

    fixture.unmount();
  });

  it("marks the centre the mod flags as home, even when it is not listed first", () => {
    const fixture = mountPicker();
    fixture.emitRoster([
      {
        id: "ground:Woomerang Station",
        displayName: "Woomerang",
        active: true,
        isHome: false,
      },
      {
        id: "ground:Kerbal Space Center",
        displayName: "Kerbal Space Center",
        active: true,
        isHome: true,
      },
    ]);
    fireEvent.click(screen.getByRole("button"));

    expect(
      screen.getByRole("option", { name: /Kerbal Space Center.*Home/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Woomerang" }),
    ).toBeInTheDocument();

    fixture.unmount();
  });

  it("names the centre the frames are stamped with until this screen chooses one", () => {
    const fixture = mountPicker();
    fixture.emitRoster(ROSTER, "ground:gs1");

    expect(fixture.client.selectedVantage).toBeUndefined();
    expect(
      screen.getByRole("button", {
        name: "Command centre vantage: Woomera Station",
      }),
    ).toBeInTheDocument();

    fixture.unmount();
  });

  it("shows a fallback home with the ordinary home badge and no warning text", () => {
    const fixture = mountPicker();
    fixture.emitRoster(
      [
        {
          id: "ground:DSS 43 - Canberra",
          displayName: "Canberra",
          active: true,
          isHome: false,
          isHomeFallback: false,
        },
        {
          id: "ground:DSS 14 - Goldstone",
          displayName: "Goldstone",
          active: true,
          isHome: true,
          isHomeFallback: true,
        },
      ],
      "ground:DSS 14 - Goldstone",
    );

    const trigger = screen.getByRole("button", {
      name: "Command centre vantage: Goldstone (home)",
    });
    expect(trigger).not.toHaveTextContent(/identified/);
    expect(trigger.querySelectorAll("svg")).toHaveLength(2);
    fireEvent.click(trigger);
    expect(
      screen.getByRole("option", { name: /Goldstone.*Home/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Canberra" }),
    ).toBeInTheDocument();

    fixture.unmount();
  });

  it("carries no warning text when the roster holds no ground station to stand in as home", () => {
    const fixture = mountPicker();
    fixture.emitRoster(
      [
        {
          id: "vessel:abc",
          displayName: "Kerbal X",
          kind: "CrewedVessel",
          active: true,
          isHome: false,
          isHomeFallback: false,
        },
      ],
      "vessel:abc",
    );

    const trigger = screen.getByRole("button", {
      name: "Command centre vantage: Kerbal X",
    });
    expect(trigger).not.toHaveTextContent(/identified/);

    fixture.unmount();
  });

  it("has no a11y violations with the picker open", async () => {
    const fixture = mountOpenPicker();

    await expectNoA11yViolations(fixture.container);

    fixture.unmount();
  });
});
