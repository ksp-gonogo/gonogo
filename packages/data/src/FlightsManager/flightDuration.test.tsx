import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { MissionStore } from "../storage/MissionStore";
import { FlightsManager } from "./index";
import { MissionHistorySource } from "./MissionHistorySource";

/** A flight's span is the game time between its first and last frame, so a flight under time warp is not read as time at the desk. */

beforeEach(() => {
  clearRegistry();
  localStorage.clear();
});

describe("FlightsManager duration", () => {
  it("reads a flight's span as game time, in the game's own days and hours, not as seconds at the desk", async () => {
    const store = new MissionStore({ dbName: "flight-duration-test" });
    registerDataSource(new MissionHistorySource(store));
    // Ten hours and seven minutes of game time, as a flight under 50x warp covers in about twelve minutes at the desk.
    const gameSeconds = 36_420;
    await store.saveMission({
      meta: {
        id: "warped",
        vesselName: "Circ D",
        launchedAt: 1_000_000,
        firstFrameUt: 0,
        lastFrameUt: gameSeconds,
        frameCount: 1,
      },
      fixture: { subscribedTopics: [], frames: [] },
    });

    render(<FlightsManager />);

    const game = writeQuantity(value("s", gameSeconds));
    await waitFor(() => {
      expect(screen.getAllByText(game)).toHaveLength(1);
    });
    expect(game).not.toBe(writeQuantity(value("irl:s", gameSeconds)));
    expect(screen.queryByText(writeQuantity(value("irl:s", gameSeconds)))).toBe(
      null,
    );
  });
});
