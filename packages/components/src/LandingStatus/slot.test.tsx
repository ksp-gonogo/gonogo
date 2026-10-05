import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
  registerStockBodies,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LandingStatusComponent } from "./index";

const MUN = { index: 3, name: "Mun", radius: 200_000, mu: 6.5138398e10 };

describe("LandingStatus: the sections slot", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    registerStockBodies();
    stream = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  });

  // Unmounted first: clearing the registry would otherwise notify a mounted slot outside act().
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    clearAugments();
  });

  function emitDescent(): void {
    act(() => {
      stream.emit("system.bodies", {
        bodies: [
          {
            name: MUN.name,
            index: MUN.index,
            parentIndex: 0,
            radius: MUN.radius,
            orbit: null,
          },
        ],
      });
      stream.emit("vessel.identity", {
        vesselId: "test-vessel",
        name: "Test Vessel",
        vesselType: 0,
        situation: 6,
        parentBodyIndex: MUN.index,
        launchUt: null,
      });
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: MUN.index,
          sma: 250_000,
          ecc: 0.01,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
          mu: MUN.mu,
        },
        { quality: Quality.Loaded },
      );
      stream.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 0,
        altitudeTerrain: 5000,
        verticalSpeed: -50,
        surfaceSpeed: 60,
        orbitalSpeed: 60,
        atmDensity: 0,
      });
      stream.emit("vessel.propulsion", {
        totalMass: 5,
        dryMass: 3,
        currentThrust: 0,
        availableThrust: 60,
      });
    });
  }

  it("mounts a planted section in the row that holds the altitude rail, beside it", async () => {
    registerAugment({
      id: "test-landing-sections",
      augments: "landing-status.sections",
      component: () => <div data-testid="planted">planted</div>,
    });
    await act(async () => {
      ({ unmount } = render(
        <stream.Provider>
          <WidgetMetaContext.Provider
            value={{ componentId: "landing-status", contributionSlots: [] }}
          >
            <DashboardItemContext.Provider value={{ instanceId: "land-slot" }}>
              <LandingStatusComponent id="land-slot" w={8} h={12} />
            </DashboardItemContext.Provider>
          </WidgetMetaContext.Provider>
        </stream.Provider>,
      ));
    });
    emitDescent();
    const rail = await waitFor(() => screen.getByRole("meter"));
    const planted = screen.getByTestId("planted");
    const row = rail.closest("[style*='align-items: stretch']");
    expect(row).not.toBeNull();
    expect(row?.contains(planted)).toBe(true);
    expect(rail.parentElement?.parentElement?.contains(planted)).toBe(false);
    await act(async () => {});
  });
});
