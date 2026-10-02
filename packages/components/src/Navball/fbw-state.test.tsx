import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
  PerfBudget,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * The button reads the outcome of the latest arm or disarm: ARMED only once the
 * craft has said yes, and never across a vessel switch, which the mod answers
 * by dropping the override. The mod's own `vessel.control.flyByWire` settles it
 * whenever no command is travelling, so a reload cannot show off while armed.
 */

beforeEach(() => {
  PerfBudget.getAll()
    .find((b) => b.name.startsWith("useActionInput register"))
    ?.reset();
});

afterEach(() => {
  clearActionHandlers();
});

const PRESS = { kind: "button", value: true } as const;

/** No telemetry provider: nothing can answer a command. */
function Bare({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function navball(
  instanceId: string,
  Provider: (props: { children: ReactNode }) => ReactElement = Bare,
) {
  return render(
    <Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <NavballComponent
          config={{ controlMode: true }}
          id={instanceId}
          w={10}
          h={20}
        />
      </DashboardItemContext.Provider>
    </Provider>,
  );
}

function mount(instanceId: string, reply: unknown = { success: true }) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  fixture.transport.setCommandHandler(() => reply);
  navball(instanceId, fixture.Provider);
  act(() => {
    fixture.emit("vessel.comms", { controlState: 4 });
  });
  return fixture;
}

function identity(fixture: StreamFixture, vesselId: string) {
  act(() => {
    fixture.emit("vessel.identity", {
      vesselId,
      name: vesselId,
      vesselType: 0,
      situation: 0,
      parentBodyIndex: 1,
      launchUt: null,
    });
  });
}

function press(instanceId: string, action: "arm-fbw" | "disarm-fbw") {
  act(() => {
    dispatchAction(instanceId, action, PRESS);
  });
}

const fbwButton = (name: string) => screen.findByRole("button", { name });

describe("Navball's FBW state follows the command outcome", () => {
  it("reads Arming while the arm travels and ARMED only once the craft confirms", async () => {
    const fixture = mount("fbw-travel");
    fixture.transport.holdCommands();
    press("fbw-travel", "arm-fbw");
    await fbwButton("Arming FBW");
    expect(screen.queryByRole("button", { name: "FBW ARMED" })).toBeNull();

    act(() => fixture.transport.answerHeldCommands());
    await fbwButton("FBW ARMED");
  });

  it("returns to Arm FBW when the craft refuses the arm", async () => {
    mount("fbw-refused", {
      success: false,
      errorCode: 9,
      detail: "the vessel is not controllable",
    });
    press("fbw-refused", "arm-fbw");
    await waitFor(() =>
      expect(document.body.textContent).toContain("Arm FBW refused"),
    );
    await fbwButton("Arm FBW");
    expect(screen.queryByRole("button", { name: "FBW ARMED" })).toBeNull();
  });

  it("ends disarmed when a disarm is pressed while the arm travels", async () => {
    const fixture = mount("fbw-latest");
    fixture.transport.holdCommands();
    press("fbw-latest", "arm-fbw");
    press("fbw-latest", "disarm-fbw");
    await fbwButton("Disarming FBW");

    act(() => fixture.transport.answerHeldCommands());
    await fbwButton("Arm FBW");
  });

  it("clears FBW ARMED on a vessel switch", async () => {
    const fixture = mount("fbw-switch");
    identity(fixture, "craft-a");
    press("fbw-switch", "arm-fbw");
    await fbwButton("FBW ARMED");

    identity(fixture, "craft-b");
    await fbwButton("Arm FBW");
  });

  it("stays armed when the same vessel's identity arrives again", async () => {
    const fixture = mount("fbw-same");
    identity(fixture, "craft-a");
    press("fbw-same", "arm-fbw");
    await fbwButton("FBW ARMED");

    identity(fixture, "craft-a");
    await act(async () => {});
    expect(
      screen.getByRole("button", { name: "FBW ARMED" }),
    ).toBeInTheDocument();
  });

  it("reads unconfirmed when the arm gets no answer", async () => {
    navball("fbw-lost");
    press("fbw-lost", "arm-fbw");
    await fbwButton("FBW unconfirmed");
    expect(screen.getByText("Stick inputs may be live")).toBeInTheDocument();
  });

  it("reads ARMED on a fresh mount when the mod reports the override armed", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    navball("fbw-reload", fixture.Provider);
    act(() => {
      fixture.emit("vessel.comms", { controlState: 4 });
      fixture.emit("vessel.control", { flyByWire: true });
    });
    await fbwButton("FBW ARMED");
  });

  it("follows the mod when it drops an override the page armed", async () => {
    const fixture = mount("fbw-dropped");
    press("fbw-dropped", "arm-fbw");
    await fbwButton("FBW ARMED");

    act(() => {
      fixture.emit("vessel.control", { flyByWire: false });
    });
    await fbwButton("Arm FBW");
  });

  it("holds Arming while the arm travels, whatever the mod last reported", async () => {
    const fixture = mount("fbw-travel-readback");
    act(() => {
      fixture.emit("vessel.control", { flyByWire: false });
    });
    fixture.transport.holdCommands();
    press("fbw-travel-readback", "arm-fbw");
    await fbwButton("Arming FBW");

    act(() => {
      fixture.emit("vessel.control", { flyByWire: true });
    });
    await fbwButton("Arming FBW");
  });
});
