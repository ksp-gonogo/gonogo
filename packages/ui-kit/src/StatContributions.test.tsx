import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  clearContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { ContributionsProvider } from "./contributionsRuntime";
import { StatContributions } from "./StatContributions";
import { WidgetMetaContext } from "./WidgetMetaContext";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface ContributionRegistry {
    "stat-probe.readouts": {
      entry: import("@ksp-gonogo/sitrep-sdk").StatEntry;
    };
  }
}

const SLOT = "stat-probe.readouts";

function mount() {
  const stream = setupStreamFixture();
  render(
    <stream.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "stat-probe", contributionSlots: [SLOT] }}
      >
        <ContributionsProvider>
          <StatContributions slot={SLOT} />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </stream.Provider>,
  );
}

/** The text of every figure carrying the held mark: a `Unit` stamps `data-held`, a text figure carries the mark inside it. */
function heldFigures(): string[] {
  return [
    ...Array.from(document.querySelectorAll("[data-held]")),
    ...Array.from(document.querySelectorAll("[data-held-mark]")).map(
      (mark) => mark.parentElement,
    ),
  ].map((el) => el?.textContent ?? "");
}

beforeEach(() => {
  clearContributions();
});

describe("StatContributions", () => {
  it("draws a held quantity and a held text figure with the held mark, and a current one plain", async () => {
    registerContribution({
      id: "stats",
      contributes: SLOT,
      compute: () => [
        {
          id: "budget",
          label: "Budget",
          value: {
            state: "held" as const,
            value: value("funds", 1200),
            asOfUt: value("ut", 50),
            grade: "disconnected" as const,
            reckoning: { status: "none" as const },
          },
        },
        {
          id: "roster",
          label: "Roster",
          text: "3 / 13",
          held: "held" as const,
        },
        { id: "queue", label: "Queue", text: "2 waiting" },
      ],
    });
    mount();
    await act(async () => {});

    expect(screen.getByText("3 / 13")).toBeTruthy();
    const held = heldFigures();
    expect(
      held.some((text) => text.includes("1,200") || text.includes("1.2")),
    ).toBe(true);
    expect(held.some((text) => text.includes("3 / 13"))).toBe(true);
    expect(held.some((text) => text.includes("2 waiting"))).toBe(false);
  });
});
