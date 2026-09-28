import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CrewStatusComponent } from "./index";

/** CrewStatus renders its roster off the real stream pipeline with no legacy `DataSource` registered. */
describe("CrewStatus, genuinely runs off the stream", () => {
  it("reads v.crewCount/v.crew/v.crewCapacity off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "crew-stream" }}>
          <CrewStatusComponent id="crew-stream" w={6} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet, known is false, so the waiting placeholder shows.
    expect(screen.getByText(/Waiting for telemetry/i)).toBeInTheDocument();

    // StubTransport.emit is subscription-gated, so nothing would deliver without this.
    expect(fixture.transport.isSubscribed("vessel.crew")).toBe(true);

    act(() => {
      fixture.emit("vessel.crew", {
        count: 3,
        capacity: 4,
        crew: [
          { name: "Jebediah Kerman" },
          { name: "Bill Kerman" },
          { name: "Bob Kerman" },
        ],
      });
    });

    // The headcount is a panel badge, which a bare-component render never mounts.
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bob Kerman")).toBeInTheDocument();
  });

  it("marks the held headcount and capacity once the crew stops arriving", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "crew-held" }}>
          <CrewStatusComponent id="crew-held" w={3} h={3} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.crew", { count: 3, capacity: 4, crew: [] });
    });
    await waitFor(() => expect(screen.getByText(/aboard/)).toBeInTheDocument());
    expect(container.querySelectorAll("[data-held]")).toHaveLength(0);

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() => {
      const held = [...container.querySelectorAll("[data-held]")].map(
        (el) => el.firstChild?.textContent,
      );
      expect(held).toEqual(["3", "4"]);
    });
    await act(async () => {});
  });
});
