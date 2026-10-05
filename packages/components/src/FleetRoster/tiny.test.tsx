import { act, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

function essentialTexts(): string[] {
  return [...document.querySelectorAll("[data-tiny-essential]")].map(
    (e) => e.textContent ?? "",
  );
}

describe("FleetRoster tiny mode", () => {
  it("counts the fleet and how much of it is linked, and counts nothing before the roster arrives", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    renderWidget("fleet-roster", {
      w: 4,
      h: 4,
      wrapper: fixture.Provider,
    });

    await waitFor(() => expect(essentialTexts()).toHaveLength(3));
    for (const text of essentialTexts()) {
      expect(text).toContain(NULL_DISPLAY);
    }

    act(() => {
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "a",
            name: "A",
            vesselType: 1,
            commsConnected: true,
            commsControlSource: 2,
          },
          {
            vesselId: "b",
            name: "B",
            vesselType: 1,
            commsConnected: false,
            commsControlSource: 0,
          },
          {
            vesselId: "c",
            name: "C",
            vesselType: 1,
            commsConnected: true,
            commsControlSource: 2,
          },
        ],
      });
    });

    await waitFor(() => expect(essentialTexts()[0]).toContain("3"));
    const [vessels, linked, noLink] = essentialTexts();
    expect(vessels).toContain("Vessels");
    expect(linked).toContain("Linked");
    expect(linked).toContain("2");
    expect(noLink).toContain("No link");
    expect(noLink).toContain("1");
    await act(async () => {});
  });
});
