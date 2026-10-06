import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

// `ControlState` ordinals off the wire.
const CONTROL_STATE_FULL = 4;
const CONTROL_STATE_NONE = 0;

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderComm(fixture: ReturnType<typeof newFixture>) {
  const { unmount } = render(
    <fixture.Provider>
      <CommSignalComponent config={{}} id="comm" />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("CommSignalComponent", () => {
  it("says it is awaiting the first signal until any signal field arrives, and never that there is none", () => {
    renderComm(newFixture());
    expect(screen.getByText("Awaiting first signal")).toBeInTheDocument();
    expect(screen.queryByText(/no signal/i)).toBeNull();
    expect(screen.queryByLabelText(/no signal/i)).toBeNull();
  });

  it("labels the bars accessibly from signal strength", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.82,
        controlState: CONTROL_STATE_FULL,
      });
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Signal 4 of 4")).toBeInTheDocument(),
    );
    expect(visibleText()).toContain("82 %");
    expect(screen.getByText("Full")).toBeInTheDocument();
  });

  it("drops to zero bars and shows the control tone as lost when disconnected", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: false });
      fixture.emit("vessel.comms", {
        connected: false,
        signalStrength: 0,
        controlState: CONTROL_STATE_NONE,
      });
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Signal 0 of 4")).toBeInTheDocument(),
    );
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("shows the strength this command centre was sent for its own path, over the craft's own figure", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.82,
        controlState: CONTROL_STATE_FULL,
      });
      fixture.emit("comms.signal", { strength: 0.6, modelled: false });
    });

    await waitFor(() => expect(visibleText()).toContain("60 %"));
    expect(visibleText()).not.toContain("82 %");
    expect(
      document.querySelector('[data-reckoning-mark="modelled"]'),
    ).toBeNull();

    // The same figure, worked out and not measured, is the same widget with the mark on it.
    act(() => {
      fixture.emit("comms.signal", { strength: 0.6, modelled: true });
    });
    await waitFor(() =>
      expect(
        document.querySelector('[data-reckoning-mark="modelled"]'),
      ).not.toBeNull(),
    );
    await act(async () => {});
  });

  it("marks a strength worked out for the believed path as modelled, and says so", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.82,
        controlState: CONTROL_STATE_FULL,
      });
      fixture.emit("comms.signal", { strength: 0.6, modelled: true });
    });

    await waitFor(() => expect(visibleText()).toContain("60 %"));
    expect(
      document.querySelector('[data-reckoning-mark="modelled"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toMatch(
      /worked out for the path this command centre believes in/i,
    );
    await act(async () => {});
  });

  it("marks a strength measured on another path as held, and says which path it is of", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.signal", {
        strength: 0.6,
        modelled: false,
        otherPath: true,
      });
    });

    await waitFor(() => expect(visibleText()).toContain("60 %"));
    expect(
      document.querySelector('[data-reckoning-mark="held"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toMatch(
      /not the path this command centre believes in/i,
    );
    await act(async () => {});
  });

  it("formats signal delay in seconds or minutes depending on magnitude", async () => {
    const fixture = newFixture();
    renderComm(fixture);
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", {
        connected: true,
        signalStrength: 0.5,
        controlState: CONTROL_STATE_FULL,
      });
      fixture.emit("comms.delay", { oneWaySeconds: 135 });
    });
    await waitFor(() => expect(visibleText()).toContain("2min 15s"));
  });
});
