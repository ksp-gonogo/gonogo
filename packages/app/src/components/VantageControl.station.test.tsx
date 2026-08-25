import { type Screen, ScreenProvider } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { VantageControl } from "./VantageControl";

const ROSTER = [
  { id: "ksc", displayName: "KSC", active: true },
  { id: "ground:gs1", displayName: "Woomera Station", active: true },
];

/**
 * Mounts the control on a station, over a transport that cannot carry a
 * vantage selection, which is what `PeerTransport` declares and therefore
 * what every real station runs on.
 */
function mountStation(screenRole: Screen = "station") {
  const fixture = setupStreamFixture({
    carriedChannels: ["commandCentre.roster"],
    pinnedUt: 10,
  });
  // The one thing that makes a station's stream a station's stream: frames are
  // relayed from a host session this client does not own, so it cannot select
  // the vantage they are delayed from.
  Object.defineProperty(fixture.transport, "carriesVantage", { value: false });
  const view = render(
    <fixture.Provider>
      <ScreenProvider value={screenRole}>
        <VantageControl />
      </ScreenProvider>
    </fixture.Provider>,
  );
  return {
    ...fixture,
    ...view,
    emitRoster: (roster: unknown, vantage = "ksc") => {
      act(() => {
        fixture.emit("commandCentre.roster", roster, { vantage });
        fixture.store.beginFrame();
      });
    },
  };
}

describe("VantageControl on a station", () => {
  it("offers no lever: no button, no listbox, no keyboard path into a selection", () => {
    const fixture = mountStation();
    fixture.emitRoster(ROSTER);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    fixture.unmount();
  });

  it("names the command centre the host's frames are stamped with, not its own default", () => {
    const fixture = mountStation();
    // The host is observing from Woomera. This client's OWN selectedVantage is
    // the constructor default "ksc" and can never move, so a readout sourced
    // from it would name the wrong centre.
    fixture.emitRoster(ROSTER, "ground:gs1");

    expect(fixture.client.selectedVantage).toBe("ksc");
    expect(screen.getByText("Woomera Station")).toBeInTheDocument();
    expect(screen.queryByText("KSC")).toBeNull();

    fixture.unmount();
  });

  it("does not claim a command centre before any frame has said which one", () => {
    const fixture = mountStation();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Command centre vantage: Unknown",
    );
    expect(screen.queryByText("KSC")).toBeNull();
    expect(screen.queryByText("ksc")).toBeNull();

    fixture.unmount();
  });

  it("marks the home centre, so the readout carries what the picker's badge did", () => {
    const fixture = mountStation();
    fixture.emitRoster(ROSTER, "ksc");

    const readout = screen.getByRole("status");
    expect(readout).toHaveTextContent("Command centre vantage:");
    expect(readout).toHaveTextContent("KSC");
    expect(readout).toHaveTextContent("Home");

    fixture.unmount();
  });

  it("keeps the picker on the main screen: same component, same lever", () => {
    const fixture = mountStation("main");
    fixture.emitRoster(ROSTER);

    expect(
      screen.getByRole("button", {
        name: "Command centre vantage: KSC (home)",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();

    fixture.unmount();
  });

  it("has no a11y violations as a readout", async () => {
    const fixture = mountStation();
    fixture.emitRoster(ROSTER, "ground:gs1");

    await expectNoA11yViolations(fixture.container);

    fixture.unmount();
  });
});
