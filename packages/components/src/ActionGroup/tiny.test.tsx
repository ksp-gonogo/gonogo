import { clearActionHandlers, dispatchAction } from "@ksp-gonogo/core";
import { act, screen, waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  renderWidget,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./index";

describe("ActionGroup tiny mode", () => {
  afterEach(() => {
    clearActionHandlers();
  });

  function setup(size: { w: number; h: number }, sas = false) {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const result = renderWidget("action-group", {
      ...size,
      config: { actionGroupId: "SAS" },
      wrapper: fixture.Provider,
    });
    act(() => {
      fixture.emit("vessel.control", {
        sasMode: 0,
        throttle: 0,
        sas,
        actionGroups: [],
      });
      fixture.emit("comms.link", { connected: true });
      fixture.emit("time.warp", { paused: false });
    });
    return { fixture, ...result };
  }

  it("draws the group's name and its toggle, and nothing else", async () => {
    const { container } = setup({ w: 2, h: 2 }, true);
    const button = await screen.findByRole("button", { name: "Toggle SAS" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("ON");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(document.querySelector("[data-tiny-essential]")).not.toBeNull();
    await expectNoA11yViolations(container);
  });

  it("sends the same delay-aware command a body press does", async () => {
    const user = userEvent.setup();
    const { fixture } = setup({ w: 3, h: 3 });
    await user.click(await screen.findByRole("button", { name: "Toggle SAS" }));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "vessel.control.setSas",
      );
      expect(sent?.args).toEqual({ enabled: true });
    });
  });

  it("keeps its serial and keyboard binding while the body is unmounted", async () => {
    const { fixture } = setup({ w: 3, h: 3 });
    await screen.findByRole("button", { name: "Toggle SAS" });
    act(() => {
      dispatchAction("action-group-test", "toggle", {
        kind: "button",
        value: true,
      });
    });
    await waitFor(() =>
      expect(
        fixture.transport.sentCommands.some(
          (c) => c.command === "vessel.control.setSas",
        ),
      ).toBe(true),
    );
  });

  it("is the body from 5x4", async () => {
    setup({ w: 5, h: 4 });
    await screen.findByRole("button", { name: "Toggle SAS" });
    expect(document.querySelector("[data-tiny-essential]")).toBeNull();
  });
});
