import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { EscapeProfileComponent } from "./index";

/**
 * EscapeProfile off the stream: a streamed body with no gravitational parameter surfaces the "No reference data" Notice under that exact name, which only happens if the name actually streamed.
 * The trace is not emitted, so only the title and Notice are asserted.
 */

describe("EscapeProfile: reads the parent body off the stream", () => {
  it("surfaces the streamed body name in the no-reference-data notice", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "escape-stream" }}>
          <EscapeProfileComponent id="escape-stream" w={10} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // A radius and no GM for "Proxima", so the Notice proves the name streamed.
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Proxima",
            index: 3,
            parentIndex: 0,
            radius: 700_000,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", { parentBodyIndex: 3 });
    });

    await waitFor(() => {
      if (!visibleText(container).includes("No reference data")) {
        throw new Error("streamed body name has not reached the widget yet");
      }
    });

    expect(visibleText(container)).toContain("ESCAPE PROFILE");
    expect(visibleText(container)).toContain("No reference data for Proxima");
  });
});
