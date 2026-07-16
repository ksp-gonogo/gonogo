import { memoryStorage } from "@ksp-gonogo/core/test";
import { ModalProvider, useModal } from "@ksp-gonogo/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GAMEPAD_ROLES } from "../gamepadRoles";
import { MockGamepadAPI, type MockGamepadSpec } from "../mocks/mockGamepad";
import { SerialDeviceProvider } from "../SerialDeviceContext";
import { SerialDeviceService } from "../SerialDeviceService";
import { axe } from "../test/axe";
import { GamepadPoller } from "../transports/GamepadPoller";
import type { DeviceInput, DeviceType } from "../types";
import { GamepadLearnWizard } from "./GamepadLearnWizard";

// The modal's Tab focus trap and the wizard's own status readouts are both
// exercised via a real Modal, per the InputMappingTab.test.tsx precedent —
// render inside a <ModalProvider>, open on mount.
function AutoOpen({ content }: Readonly<{ content: ReactNode }>) {
  const { open } = useModal();
  // biome-ignore lint/correctness/useExhaustiveDependencies: open once on mount.
  useEffect(() => {
    open(content);
  }, []);
  return null;
}

function renderInModal(content: ReactNode) {
  return render(
    <ModalProvider>
      <AutoOpen content={content} />
    </ModalProvider>,
  );
}

// Non-standard mapping (`mapping: ""`) is the whole reason this wizard
// exists — a standard-mapping pad already gets roles for free (Phase 3 of
// the gamepad-transport spec).
const NON_STANDARD_SPEC: MockGamepadSpec = {
  id: "Test Pad",
  mapping: "",
  buttonCount: 18,
  axisCount: 4,
};

describe("GamepadLearnWizard", () => {
  const mock = new MockGamepadAPI();

  afterEach(() => {
    mock.restore();
    GamepadPoller.resetForTests();
  });

  async function makeGamepadService(): Promise<SerialDeviceService> {
    const svc = new SerialDeviceService({
      screenKey: `grw-${Math.random().toString(36).slice(2)}`,
      storage: memoryStorage(),
      renderDebounceMs: 0,
    });
    for (const d of svc.getDevices()) await svc.removeDevice(d.id);
    return svc;
  }

  async function setup(spec: MockGamepadSpec = NON_STANDARD_SPEC) {
    mock.install();
    const svc = await makeGamepadService();
    svc.addDevice({
      id: "gp1",
      name: "Pad 1",
      typeId: "gamepad-unconfigured",
      transport: "gamepad",
    });
    await svc.connect("gp1");
    mock.connectPad(0, spec);
    const device = svc.getDevices().find((d) => d.id === "gp1");
    if (!device) throw new Error("device missing after connect");
    const type = svc.getDeviceType(device.typeId);
    if (!type) throw new Error("type missing after connect");
    return { svc, device, type };
  }

  it("assigns a role to the first input crossing the capture threshold, then advances", async () => {
    const { svc, device, type } = await setup();
    const onApply = vi.fn();

    renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={onApply}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    expect(screen.getByText(/1 of 21/i)).not.toBeNull();
    expect(screen.getByText(/press it now/i)).not.toBeNull();

    act(() => {
      mock.setButton(0, 3, { pressed: true, value: 1 });
      mock.step();
    });

    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const applied = onApply.mock.calls.at(-1)?.[0] as DeviceInput[];
    expect(applied.find((i) => i.id === "button-3")?.role).toBe("face-south");

    await waitFor(() => expect(screen.getByText(/2 of 21/i)).not.toBeNull());

    await svc.destroy();
  });

  it("Skip leaves the role unassigned and advances without writing anything", async () => {
    const { svc, device, type } = await setup();
    const onApply = vi.fn();
    const user = userEvent.setup();

    renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={onApply}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /^skip$/i }));

    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/2 of 21/i)).not.toBeNull());

    await svc.destroy();
  });

  it("never changes an input's id — only role — on the applied inputs list", async () => {
    const { svc, device, type } = await setup();
    const originalIds = type.inputs.map((i) => i.id).sort();
    const onApply = vi.fn();

    renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={onApply}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    act(() => {
      mock.setButton(0, 5, { pressed: true, value: 1 });
      mock.step();
    });
    await waitFor(() => expect(onApply).toHaveBeenCalled());

    const applied = onApply.mock.calls.at(-1)?.[0] as DeviceInput[];
    expect(applied.map((i) => i.id).sort()).toEqual(originalIds);

    await svc.destroy();
  });

  it("moves a role to the newly-pressed input, clearing it from whoever held it before", async () => {
    mock.install();
    const svc = await makeGamepadService();
    svc.addDevice({
      id: "gp1",
      name: "Pad 1",
      typeId: "gamepad-unconfigured",
      transport: "gamepad",
    });
    await svc.connect("gp1");
    mock.connectPad(0, NON_STANDARD_SPEC);
    const device = svc.getDevices().find((d) => d.id === "gp1");
    if (!device) throw new Error("device missing after connect");
    const baseType = svc.getDeviceType(device.typeId);
    if (!baseType) throw new Error("type missing after connect");

    // Simulate a prior wizard run that already put "face-south" on
    // button-2.
    const seeded: DeviceType = {
      ...baseType,
      inputs: baseType.inputs.map((i) =>
        i.id === "button-2" ? { ...i, role: "face-south" } : i,
      ),
    };
    svc.upsertDeviceType(seeded);
    const type = svc.getDeviceType(seeded.id);
    if (!type) throw new Error("seeded type missing");

    const onApply = vi.fn();
    renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={onApply}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    expect(screen.getByText(/currently assigned to/i).textContent).toMatch(
      /button-2/,
    );

    act(() => {
      mock.setButton(0, 7, { pressed: true, value: 1 });
      mock.step();
    });
    await waitFor(() => expect(onApply).toHaveBeenCalled());

    const applied = onApply.mock.calls.at(-1)?.[0] as DeviceInput[];
    expect(applied.find((i) => i.id === "button-2")?.role).toBeUndefined();
    expect(applied.find((i) => i.id === "button-7")?.role).toBe("face-south");
    expect(applied.filter((i) => i.role === "face-south")).toHaveLength(1);

    await svc.destroy();
  });

  it("a drifting/idle axis below the capture threshold assigns nothing on Confirm", async () => {
    const { svc, device, type } = await setup();
    const onApply = vi.fn();
    const user = userEvent.setup();

    renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={onApply}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    // Walk past every button-shaped role to reach the first axis-shaped one
    // ("Stick Left X").
    for (let i = 0; i < 17; i++) {
      await user.click(screen.getByRole("button", { name: /^skip$/i }));
    }
    await waitFor(() =>
      expect(screen.getByText(/stick left x/i)).not.toBeNull(),
    );

    act(() => {
      mock.setAxis(0, 0, 0.05); // drift, well below the 0.5 threshold
      mock.step();
    });

    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/stick left y/i)).not.toBeNull(),
    );

    await svc.destroy();
  });

  it("commits the axis with the largest excursion while the prompt is active, not the first to move", async () => {
    const { svc, device, type } = await setup();
    const onApply = vi.fn();
    const user = userEvent.setup();

    renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={onApply}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    for (let i = 0; i < 17; i++) {
      await user.click(screen.getByRole("button", { name: /^skip$/i }));
    }
    await waitFor(() =>
      expect(screen.getByText(/stick left x/i)).not.toBeNull(),
    );

    // A diagonal push: axis-1 fires first (smaller excursion), axis-0
    // fires second with a bigger excursion. The wizard must pick axis-0 —
    // the largest excursion seen, not the first thing that moved.
    act(() => {
      mock.setAxis(0, 1, 0.55);
      mock.step();
    });
    act(() => {
      mock.setAxis(0, 0, 0.9);
      mock.step();
    });

    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const applied = onApply.mock.calls.at(-1)?.[0] as DeviceInput[];
    expect(applied.find((i) => i.id === "axis-0")?.role).toBe("stick-left-x");
    expect(applied.find((i) => i.id === "axis-1")?.role).toBeUndefined();

    await svc.destroy();
  });

  it("Back returns to the previous role", async () => {
    const { svc, device, type } = await setup();
    const user = userEvent.setup();

    renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={() => {}}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    expect(
      screen.getByRole("button", { name: /^back$/i }).hasAttribute("disabled"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: /^skip$/i }));
    await waitFor(() => expect(screen.getByText(/2 of 21/i)).not.toBeNull());
    await user.click(screen.getByRole("button", { name: /^back$/i }));
    await waitFor(() => expect(screen.getByText(/1 of 21/i)).not.toBeNull());

    await svc.destroy();
  });

  it("re-running to completion shows a finished screen, and Close calls onClose", async () => {
    const { svc, device, type } = await setup();
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={() => {}}
          onClose={onClose}
        />
      </SerialDeviceProvider>,
    );

    for (let i = 0; i < GAMEPAD_ROLES.length; i++) {
      await user.click(screen.getByRole("button", { name: /^skip$/i }));
    }

    expect(screen.getByText(/walked every role/i)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: /^done$/i }));
    expect(onClose).toHaveBeenCalled();

    await svc.destroy();
  });

  it("captures a gamepad press even while the modal's Tab focus trap is active", async () => {
    const { svc, device, type } = await setup();
    const onApply = vi.fn();

    renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={onApply}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    // The Modal's focus trap only intercepts the Tab key (see Modal.tsx);
    // Gamepad input is polled, never a keyboard event, so it can never be
    // caught by it — this asserts the press still lands while the dialog
    // (and its trap) are up.
    expect(screen.getByRole("dialog")).not.toBeNull();

    act(() => {
      mock.setButton(0, 0, { pressed: true, value: 1 });
      mock.step();
    });

    await waitFor(() => expect(onApply).toHaveBeenCalled());

    await svc.destroy();
  });

  it("has no axe violations", async () => {
    const { svc, device, type } = await setup();

    const { container } = renderInModal(
      <SerialDeviceProvider service={svc}>
        <GamepadLearnWizard
          device={device}
          type={type}
          onApply={() => {}}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    expect(await axe(container)).toHaveNoViolations();

    await svc.destroy();
  });
});
