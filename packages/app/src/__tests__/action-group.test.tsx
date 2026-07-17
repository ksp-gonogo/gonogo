import {
  ActionGroupComponent,
  AlarmsLauncherProvider,
} from "@ksp-gonogo/components";
import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeTelemachusHandle,
  setupFakeTelemachus,
} from "./fixtures/fakeTelemachus";

function withItemContext(instanceId: string, children: ReactNode) {
  return (
    <DashboardItemContext.Provider value={{ instanceId }}>
      {children}
    </DashboardItemContext.Provider>
  );
}

let fake: FakeTelemachusHandle | null = null;

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  fake?.buffered.disconnect();
  fake = null;
});

describe("ActionGroup component", () => {
  it("shows placeholder when no action group is configured", () => {
    render(withItemContext("t", <ActionGroupComponent id="t" />));
    expect(screen.getByText("No action group configured")).toBeInTheDocument();
  });

  it("shows group name and OFF state on initial connect", async () => {
    fake = await setupFakeTelemachus({ "v.ag1Value": false });
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );
    fake.seed();

    await waitFor(() => expect(screen.getByText("AG1")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("OFF")).toBeInTheDocument());
  });

  it("shows ON when the action group is already active", async () => {
    fake = await setupFakeTelemachus({ "v.ag1Value": true });
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );
    fake.seed();

    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());
  });

  it("sends a toggle request and reflects the updated state", async () => {
    const user = userEvent.setup();
    fake = await setupFakeTelemachus({ "v.ag1Value": false });
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );
    fake.seed();

    await waitFor(() => expect(screen.getByText("OFF")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /toggle ag1/i }));

    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());
  });

  it("shows a disabled toggle for a read-only group (Precision Control)", async () => {
    fake = await setupFakeTelemachus({ "v.precisionControlValue": false });
    render(
      withItemContext(
        "t",
        <ActionGroupComponent
          config={{ actionGroupId: "Precision Control" }}
          id="t"
        />,
      ),
    );
    fake.seed();

    await waitFor(() =>
      expect(screen.getByText("Precision Control")).toBeInTheDocument(),
    );
    // The state pill is now a toggle button at every size, but a read-only
    // group (no toggle action) renders it disabled so it can't be actioned.
    expect(
      screen.getByRole("button", { name: /toggle precision control/i }),
    ).toBeDisabled();
  });

  it("clears state to unknown when the connection drops", async () => {
    fake = await setupFakeTelemachus({ "v.ag1Value": true });
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );
    fake.seed();

    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());

    act(() => {
      fake?.telemachus.disconnect();
    });

    await waitFor(() => expect(screen.getByText("—")).toBeInTheDocument());
  });

  it("toggles SAS independently from AG1", async () => {
    const user = userEvent.setup();
    fake = await setupFakeTelemachus({ "v.sasValue": false });
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "SAS" }} id="t" />,
      ),
    );
    fake.seed();

    await waitFor(() => expect(screen.getByText("OFF")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /toggle sas/i }));

    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());
  });

  it("hides the alarm bell when no AlarmsLauncherProvider is mounted", async () => {
    fake = await setupFakeTelemachus({ "v.ag1Value": false });
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );
    fake.seed();

    await waitFor(() => expect(screen.getByText("AG1")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /set alarm to fire ag1/i }),
    ).not.toBeInTheDocument();
  });

  it("invokes the alarms launcher with the group's toggle action when the bell is clicked", async () => {
    const user = userEvent.setup();
    const launcher = vi.fn();
    fake = await setupFakeTelemachus({ "v.ag1Value": false });
    render(
      <AlarmsLauncherProvider launcher={launcher}>
        {withItemContext(
          "t",
          <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
        )}
      </AlarmsLauncherProvider>,
    );
    fake.seed();

    await waitFor(() => expect(screen.getByText("AG1")).toBeInTheDocument());
    await user.click(
      screen.getByRole("button", { name: /set alarm to fire ag1/i }),
    );
    expect(launcher).toHaveBeenCalledWith({
      name: "Fire AG1",
      action: "f.ag1",
    });
  });

  it("hides the bell on read-only groups (Precision Control has no toggle action)", async () => {
    const launcher = vi.fn();
    fake = await setupFakeTelemachus({ "v.precisionControlValue": false });
    render(
      <AlarmsLauncherProvider launcher={launcher}>
        {withItemContext(
          "t",
          <ActionGroupComponent
            config={{ actionGroupId: "Precision Control" }}
            id="t"
          />,
        )}
      </AlarmsLauncherProvider>,
    );
    fake.seed();

    await waitFor(() =>
      expect(screen.getByText("Precision Control")).toBeInTheDocument(),
    );
    // No bell — without a toggle action there's nothing for the alarm to
    // dispatch, so the affordance is suppressed.
    expect(
      screen.queryByRole("button", { name: /set alarm to fire/i }),
    ).not.toBeInTheDocument();
  });
});
