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
 * The funds rule, in the one place it is now met.
 *
 * The repo rule is that a spend control is never visible without a balance
 * visible in the same WIDGET. `space-center-status.sections` made that rule read
 * as per-SECTION: three RP-1 augments land in this panel, two of them drew their
 * own "Funds" row, and one widget ended up printing the same balance three times
 * under three headings. The operator read the repetition as a defect, and it was
 * one.
 *
 * So the augments dropped their copies, and everything now rests on the host: if
 * this panel can ever mount the sections slot without also drawing a balance,
 * the rule is broken for every augment at once and no augment's own tests can
 * see it. That is what this file holds.
 *
 * The two facts asserted are DIFFERENT KINDS on purpose. Presence of the
 * balance is one; that the augment is on screen at the same moment is the other,
 * because a size at which the sections slot renders nothing would satisfy a
 * presence check while proving nothing at all.
 */

const CARRIED = [
  "career.status",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
];

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
      {/* The segment form of the slot completes `${componentId}.sections` from
          this meta, so a tree without it mounts no augments at all and every
          assertion below would pass on a widget that never opened the slot. */}
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
    fixture.emit("career.status", {
      economy: { funds: 500000, reputation: 0, science: 0 },
      facilities: {
        LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
      },
      contracts: null,
      strategies: null,
      tech: null,
    });
  });
}

/**
 * Every shape the dashboard can give this widget above its tiny floor: the two
 * squeezed extremes, the compact-grid width, the default, and a wide one. A
 * balance drawn only at the roomy sizes would pass a single-size check and
 * still leave an Uplink's spend control unaccompanied on a narrow screen.
 */
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
        carriedChannels: CARRIED,
        pinnedUt: 10,
        suspendFrames: true,
      });
      mount(fixture, `scs-funds-once-${w}x${h}`, w, h);
      emitCareer(fixture);

      // Waited on the BALANCE, asserted on the section: the augment mounts off
      // the registry and is on screen from the first frame, so waiting on it
      // would let the balance be checked a tick before the career record lands
      // and fail every size for a reason that is not the one under test.
      await waitFor(() =>
        expect(screen.getByTitle("Available funds")).toBeTruthy(),
      );
      expect(screen.getByText(SPENDING_SECTION_TEXT)).toBeTruthy();
    });
  }

  it("draws exactly one balance, however many sections contribute", async () => {
    // The defect itself. Three augments in this slot is the shipped
    // configuration, and the count is what a second copy shows up in.
    registerAugment({
      id: "funds-once-probe-b",
      augments: "space-center-status.sections",
      component: () => <div>a second contributed section</div>,
    });
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
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
