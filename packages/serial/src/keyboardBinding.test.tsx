// The keyboard's whole claim is that an operator does nothing to get one.
// These tests exercise that claim end to end: a service built against EMPTY
// storage, with no device type authored and no device added, and a key press
// arriving as a real DOM event.
import type { ActionDefinition } from "@ksp-gonogo/core";
import { clearActionHandlers, registerActionHandler } from "@ksp-gonogo/core";
import { memoryStorage } from "@ksp-gonogo/core/test";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider, useModal } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InputDispatcher } from "./InputDispatcher";
import { InputMappingTab } from "./InputMappingTab";
import { SerialDeviceProvider } from "./SerialDeviceContext";
import { SerialDeviceService } from "./SerialDeviceService";

function freshService(): SerialDeviceService {
  return new SerialDeviceService({
    screenKey: `t-${Math.random().toString(36).slice(2)}`,
    storage: memoryStorage(),
    renderDebounceMs: 0,
  });
}

function press(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

function AutoOpen({ content }: { content: ReactNode }) {
  const { open } = useModal();
  // biome-ignore lint/correctness/useExhaustiveDependencies: open once on mount.
  useEffect(() => {
    open(content);
  }, []);
  return null;
}

const fireAction: ActionDefinition = {
  id: "fire",
  label: "Fire",
  accepts: ["button"],
};

describe("the keyboard needs no device creating", () => {
  beforeEach(() => clearActionHandlers());

  it("is present and connected on a screen that has never opened the Devices menu", async () => {
    const svc = freshService();

    const keyboard = svc.getDevices().find((d) => d.transport === "keyboard");
    expect(keyboard).toBeDefined();
    expect(svc.getStatus(keyboard?.id ?? "")).toBe("connected");

    const type = svc.getDeviceType(keyboard?.typeId ?? "");
    expect(type?.inputs.some((i) => i.id === "KeyW")).toBe(true);
    // Code-defined, so it never shows up as something to edit or remove.
    expect(type?.authoredBy).toBe("device");

    await svc.destroy();
  });

  it("routes a key press to the mapped action through the normal dispatcher", async () => {
    const svc = freshService();
    const spy = vi.fn();
    registerActionHandler("ag-1", "fire", spy);

    const dispatcher = new InputDispatcher({
      service: svc,
      getItems: () => [
        {
          i: "ag-1",
          inputMappings: { fire: { deviceId: "keyboard", inputId: "KeyW" } },
        },
      ],
    });

    press("KeyW");
    expect(spy).toHaveBeenCalledWith({ kind: "button", value: true });

    dispatcher.dispose();
    await svc.destroy();
  });

  it("stays on this screen: a key press reaches the local service only", async () => {
    // Two services stand in for two screens. The keyboard is per-screen the
    // same as every other serial device, so a press must not be seen by a
    // screen that did not receive it; nothing broadcasts it.
    const local = freshService();
    const other = freshService();
    const seenLocally: string[] = [];
    const seenElsewhere: string[] = [];
    local.onInput((deviceId) => seenLocally.push(deviceId));
    other.onInput((deviceId) => seenElsewhere.push(deviceId));

    // The other screen's own listeners come down with it, as they would on a
    // station that is simply a different browser.
    await other.destroy();
    press("KeyW");

    expect(seenLocally).toEqual(["keyboard"]);
    expect(seenElsewhere).toEqual([]);
    await local.destroy();
  });

  it("binds a key from a press, with the keyboard the only device on screen", async () => {
    const svc = freshService();
    // Everything the operator would otherwise have had to create, removed:
    // what remains is the keyboard, and it was never asked for.
    for (const d of svc.getDevices()) {
      if (d.transport !== "keyboard") await svc.removeDevice(d.id);
    }
    expect(svc.getDevices().map((d) => d.transport)).toEqual(["keyboard"]);

    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <AutoOpen
          content={
            <SerialDeviceProvider service={svc}>
              <InputMappingTab
                actions={[fireAction]}
                mappings={{}}
                onSave={onSave}
              />
            </SerialDeviceProvider>
          }
        />
      </ModalProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /capture an input for fire/i }),
    );
    expect(svc.isCaptureMode()).toBe(true);

    await user.keyboard("w");

    await waitFor(() => expect(svc.isCaptureMode()).toBe(false));
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({
      fire: { deviceId: "keyboard", inputId: "KeyW" },
    });

    await svc.destroy();
  });
});
