import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * Characterisation: what this widget does when its telemetry reads come back
 * `undefined`. Every read is carried by the fixture, so an un-emitted topic
 * reaches the widget through the production route. No absence may fail open
 * into a claim or a permission to spend.
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const ALL_READS = [
  "career.status",
  "career.facilities",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
];

function mount(
  fixture: ReturnType<typeof setupStreamFixture>,
  instanceId: string,
  w: number,
  h: number,
) {
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <ContributionHost
          componentId="space-center-status"
          contributionSlots={["space-center-status.facilities"]}
        >
          <SpaceCenterStatusComponent id={instanceId} w={w} h={h} />
        </ContributionHost>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

describe("SpaceCenterStatus: what undefined telemetry renders today", () => {
  it("draws no facility grid at all when nothing has arrived, and says so", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-cold", 6, 7);

    // No loading state: the whole chrome renders with placeholders, except the grid, which gets one absence marker.
    await waitFor(() => expect(screen.getByText("SPACE CENTER")).toBeTruthy());

    expect(screen.getByText("No facility tiers")).toBeTruthy();
    for (const label of [
      "Launch Pad",
      "Runway",
      "VAB",
      "SPH",
      "Mission Control",
      "Tracking",
      "Admin",
      "R&D",
      "Astronaut",
    ]) {
      expect(screen.queryByLabelText(`${label} tier unknown`)).toBeNull();
      expect(screen.queryByText(label)).toBeNull();
    }

    // Absent facilities hide the upgrade button rather than disabling it.
    expect(screen.queryAllByRole("button", { name: "Upgrade" })).toHaveLength(
      0,
    );
    expect(screen.queryByText("MAX")).toBeNull();

    expect(screen.queryByTitle("Available funds")).toBeNull();
  });

  /** Announced through aria-live, so no pad telemetry must not read as "No vehicle on pad". */
  it("says the pad state is unknown, rather than claiming the pad is clear, from no pad telemetry", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-pad-cold", 6, 7);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Pad state unknown",
      ),
    );
    // A genuinely clear pad still says so.
    expect(screen.getByRole("status").textContent).not.toContain(
      "No vehicle on pad",
    );
  });

  /** A scene record without a launchSite still says nothing about pad occupancy. */
  it("still says the pad state is unknown when only the scene record arrived", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-partial-scene", 6, 7);

    act(() => {
      // Partial payload: the record IS here, the field within it is not.
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Pad state unknown",
      ),
    );
  });

  /** Scene availability is the command's to declare, so the widget reads no scene before offering an upgrade. */
  it("offers the upgrade button whatever the scene reads", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-scene-free", 6, 7);

    act(() => {
      fixture.emit("career.facilities", {
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
        },
      });
      fixture.emit("career.status", {
        economy: { funds: 500000, reputation: 0, science: 0 },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    const button = await waitFor(() =>
      screen.getByRole("button", { name: "Upgrade" }),
    );
    expect((button as HTMLButtonElement).disabled).toBe(false);

    for (const scene of ["SpaceCenter", "Flight", "TrackingStation"]) {
      act(() => {
        fixture.emit("spaceCenter.scene", { scene });
      });
      expect(
        (screen.getByRole("button", { name: "Upgrade" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    }
  });

  /** An unknown balance is never a sufficient one. */
  it("treats an absent funds field as unaffordable, and says the balance is unknown", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-funds-gate", 6, 7);

    act(() => {
      fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      // The tiers arrived and `economy` is null.
      fixture.emit("career.facilities", {
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
        },
      });
      fixture.emit("career.status", {
        economy: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    // An unknown balance cannot satisfy a 150,000f cost, so the button is inert.
    const button = await waitFor(() =>
      screen.getByRole("button", { name: "Upgrade" }),
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // The refusal is explained: the readout reports the balance as the thing that is missing.
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(screen.getByTitle("No funds balance has arrived")).toBeTruthy();

    // Absence and a short balance are both "cannot afford this".
    act(() => {
      fixture.emit("career.facilities", {
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150000 },
        },
      });
      fixture.emit("career.status", {
        economy: { funds: 100, reputation: 0, science: 0 },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
    // Wait on the readout: the button is already disabled before the emit lands.
    await waitFor(() =>
      expect(screen.getByTitle("Available funds")).toBeTruthy(),
    );
    expect(
      (screen.getByRole("button", { name: "Upgrade" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByTitle("No funds balance has arrived")).toBeNull();
  });

  it("renders a confirmed career.status tombstone exactly as it renders a never-arrived one", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-tombstone", 6, 7);

    act(() => {
      // A tombstone: `useTelemetry` hands back `null` here, not `undefined`.
      fixture.emit("career.status", null);
    });

    // The widget does not distinguish a tombstone from absence.
    await waitFor(() =>
      expect(screen.getByText("No facility tiers")).toBeTruthy(),
    );
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Upgrade" })).toHaveLength(
      0,
    );
  });

  /** In the tiny bucket, nothing arrived must not read as PAD CLEAR. */
  it("reports the pad state as unknown in the tiny bucket when nothing has arrived", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ALL_READS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    mount(fixture, "scs-tiny-cold", 2, 3);

    await waitFor(() =>
      expect(screen.getByLabelText("Pad state unknown").textContent).toBe(
        "PAD UNKNOWN",
      ),
    );
    expect(screen.queryByLabelText("No vehicle on pad")).toBeNull();
    // Funds is the one read the tiny bucket DOES admit ignorance about.
    expect(visibleText()).toContain(NULL_DISPLAY);
    expect(screen.queryByTitle(/funds/)).toBeNull();
  });
});
