import { act, renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useLandingModel } from "./useLandingModel";

const IDENTITY = { vesselId: "lander", name: "Lander", vesselType: 0 };

describe("a load back onto the same craft", () => {
  it("starts the descent trend and the held touchdown speed over", () => {
    const fixture = setupStreamFixture({ suspendFrames: true, pinnedUt: 100 });
    const { result } = renderHook(() => useLandingModel(), {
      wrapper: fixture.Provider,
    });
    act(() => {
      fixture.emit("vessel.identity", IDENTITY, { validAt: 100 });
      fixture.emit("vessel.flight", { verticalSpeed: -80 }, { validAt: 100 });
    });
    expect(result.current.descentHistory).toContain(-80);

    act(() => {
      fixture.emit("vessel.identity", IDENTITY, {
        validAt: 100,
        timelineEpoch: 1,
      });
      fixture.emit(
        "vessel.flight",
        { verticalSpeed: -2 },
        { validAt: 100, timelineEpoch: 1 },
      );
    });

    expect(result.current.descentHistory).not.toContain(-80);
    expect(result.current.touchdownSpeed).not.toBe(80);
  });
});
