import { act, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

function contract(id: string, dateDeadline: number) {
  return {
    id,
    title: `Contract ${id}`,
    state: "Active",
    fundsAdvance: 0,
    fundsCompletion: 1000,
    dateDeadline,
    parameters: [],
  };
}

function essentialTexts(): string[] {
  return [...document.querySelectorAll("[data-tiny-essential]")].map(
    (e) => e.textContent ?? "",
  );
}

describe("ContractManager tiny mode", () => {
  it("counts the board and times the soonest deadline in the tiny form, and draws the body from 4x5", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    const { unmount } = renderWidget("contract-manager", {
      w: 3,
      h: 4,
      wrapper: fixture.Provider,
    });
    act(() => {
      fixture.emit("career.status", {
        contracts: {
          active: [contract("1", 0), contract("2", 4600), contract("3", 9000)],
          offered: [contract("4", 0)],
          completedRecent: [],
        },
      });
    });

    await waitFor(() => expect(essentialTexts()[0]).toContain("3"));
    const [active, due, offered] = essentialTexts();
    expect(active).toContain("Active");
    expect(offered).toContain("Offered");
    expect(offered).toContain("1");
    expect(due).toContain("Due in");
    expect(due).not.toContain(NULL_DISPLAY);
    unmount();

    renderWidget("contract-manager", {
      w: 4,
      h: 5,
      wrapper: fixture.Provider,
    });
    await waitFor(() => expect(visibleText()).toContain("Contract 2"));
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
    await act(async () => {});
  });

  it("counts nothing it was not sent, rather than counting zero", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    renderWidget("contract-manager", {
      w: 3,
      h: 4,
      wrapper: fixture.Provider,
    });
    act(() => {
      fixture.emit("career.status", { contracts: null });
    });

    await waitFor(() => expect(essentialTexts()).toHaveLength(3));
    for (const text of essentialTexts()) {
      expect(text).toContain(NULL_DISPLAY);
      expect(text).not.toMatch(/\b0\b/);
    }
    await act(async () => {});
  });

  it("says a passed deadline is EXPIRED and a board with no deadline has NONE, never a countdown", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    renderWidget("contract-manager", {
      w: 3,
      h: 4,
      wrapper: fixture.Provider,
    });
    const emitActive = (deadlines: number[]) =>
      act(() => {
        fixture.emit("career.status", {
          contracts: {
            active: deadlines.map((d, i) => contract(String(i + 1), d)),
            offered: [],
            completedRecent: [],
          },
        });
      });

    emitActive([500, 4600]);
    await waitFor(() => expect(essentialTexts()[1]).toContain("EXPIRED"));

    emitActive([0]);
    await waitFor(() => expect(essentialTexts()[1]).toContain("NONE"));
    await act(async () => {});
  });
});
