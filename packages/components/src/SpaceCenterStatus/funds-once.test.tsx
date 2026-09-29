import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import {
  clearAugments,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/ui-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * The host draws the one funds balance every contributed section relies on: the
 * sections slot never mounts without a balance in the same widget, and the
 * balance is drawn exactly once however many sections contribute.
 */

/** A stand-in for any Uplink section that spends: it exists and it is findable. */
const SPENDING_SECTION_TEXT = "a section with a spend control";

const renderedTrees: Array<() => void> = [];

beforeEach(() => {
  clearAugments();
  registerAugment({
    id: "funds-once-probe",
    augments: "space-center-status.sections",
    component: () => <div>{SPENDING_SECTION_TEXT}</div>,
  });
});

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearAugments();
  clearActionHandlers();
});

function mount(
  fixture: ReturnType<typeof setupStreamFixture>,
  instanceId: string,
  w: number,
  h: number,
) {
  const { unmount } = render(
    <fixture.Provider>
      {/* The segment form of the slot completes `${componentId}.sections` from this meta; without it no augment mounts. */}
      <WidgetMetaContext.Provider
        value={{ componentId: "space-center-status", contributionSlots: [] }}
      >
        <DashboardItemContext.Provider value={{ instanceId }}>
          <ContributionHost
            componentId="space-center-status"
            contributionSlots={["space-center-status.facilities"]}
          >
            <SpaceCenterStatusComponent id={instanceId} w={w} h={h} />
          </ContributionHost>
        </DashboardItemContext.Provider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

function emitCareer(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.emit("spaceCenter.scene", {
      scene: "SpaceCenter",
      launchSite: "LaunchPad",
    });
    fixture.emit("spaceCenter.launchSites", [
      { name: "__pad_occupancy__", padOccupied: false, padVesselTitle: null },
    ]);
    fixture.emit("career.facilities", {
      facilities: {
        LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
      },
    });
    fixture.emit("career.status", {
      balances: { funds: 500000, reputation: 0, science: 0 },
      contracts: null,
      strategies: null,
      tech: null,
    });
  });
}

/** Every shape above the tiny floor, so a balance drawn only at roomy sizes fails. */
const SIZES: ReadonlyArray<readonly [number, number]> = [
  [5, 4],
  [5, 18],
  [6, 7],
  [9, 8],
  [18, 5],
];

describe("SpaceCenterStatus draws the balance wherever a contributed section can spend", () => {
  for (const [w, h] of SIZES) {
    it(`shows the balance alongside the sections slot at ${w}x${h}`, async () => {
      const fixture = setupStreamFixture({
        pinnedUt: 10,
        suspendFrames: true,
      });
      mount(fixture, `scs-funds-once-${w}x${h}`, w, h);
      emitCareer(fixture);

      // Waited on the balance, since the augment is on screen before the career record lands.
      await waitFor(() =>
        expect(screen.getByTitle("Available funds")).toBeTruthy(),
      );
      expect(screen.getByText(SPENDING_SECTION_TEXT)).toBeTruthy();
    });
  }

  it("draws exactly one balance, however many sections contribute", async () => {
    registerAugment({
      id: "funds-once-probe-b",
      augments: "space-center-status.sections",
      component: () => <div>a second contributed section</div>,
    });
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-funds-once-count", 12, 14);
    emitCareer(fixture);

    await waitFor(() =>
      expect(screen.getAllByTitle("Available funds")).toHaveLength(1),
    );
    expect(screen.getByText(SPENDING_SECTION_TEXT)).toBeTruthy();
    expect(screen.getByText("a second contributed section")).toBeTruthy();
  });
});
