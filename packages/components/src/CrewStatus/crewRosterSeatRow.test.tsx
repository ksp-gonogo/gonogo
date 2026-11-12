import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { renderRoster } from "./CrewRoster";

const seats = { capacity: 2, transferAvailable: true, isExternalSeat: false };
const part = (id: string, title: string) => ({
  id,
  title,
  name: title,
  resources: {},
  modules: [],
  moduleStates: [],
  actionBindings: [],
  seats,
});

function mountRoster(seatTitle: string) {
  const fixture = setupStreamFixture({ suspendFrames: true });
  render(
    <fixture.Provider>
      {renderRoster({
        known: true,
        outOfContact: false,
        crewCount: 1,
        names: ["Jeb"],
        seats: new Map([["Jeb", seatTitle]]),
        avatarSizePx: 40,
        avatarBound: false,
        rowToneByName: new Map(),
      })}
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.crew", {
      crew: [{ name: "Jeb", partId: "1", partTitle: seatTitle }],
      count: 1,
      capacity: 4,
    });
    fixture.emit("vessel.parts", {
      parts: [part("1", seatTitle), part("2", "Hitchhiker")],
      meta: { source: "" },
    });
  });
}

describe("CrewStatus seat row", () => {
  it("centres the Move button on the part name, so a one-line name has no second line under it", async () => {
    mountRoster("Mk1-3 Command Pod");
    const button = await screen.findByRole("button", { name: "Move Jeb" });
    const row = button.parentElement as HTMLElement;
    const style = getComputedStyle(row);
    expect(style.display).toBe("flex");
    expect(style.alignItems).toBe("center");
    expect(row).toContainElement(screen.getByText("Mk1-3 Command Pod"));
  });

  it("lets the button overhang the row's padding rather than make the row taller", async () => {
    mountRoster("Mk1-3 Command Pod");
    const row = (await screen.findByRole("button", { name: "Move Jeb" }))
      .parentElement as HTMLElement;
    expect(row.getAttribute("style")).toMatch(
      /margin-block:\s*calc\(-1 \* var\(--overhang-glyph-button\)\)/,
    );
  });

  it("keeps the button beside a part name long enough to wrap", async () => {
    mountRoster("Hitchhiker Storage Container Mk2 Long Name");
    const button = await screen.findByRole("button", { name: "Move Jeb" });
    expect(
      getComputedStyle(button.parentElement as HTMLElement).alignItems,
    ).toBe("center");
  });
});
