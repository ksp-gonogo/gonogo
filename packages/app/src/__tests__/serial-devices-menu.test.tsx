/**
 * Smoke test for the SerialDevicesMenu: create a device type via the UI,
 * create a virtual device of that type, verify the service exposes both.
 */
import {
  SerialDeviceProvider,
  SerialDeviceService,
  SerialDevicesMenu,
} from "@ksp-gonogo/serial";
import { ModalProvider } from "@ksp-gonogo/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

async function makeEmptyService(): Promise<SerialDeviceService> {
  const svc = new SerialDeviceService({
    screenKey: `m-${Math.random().toString(36).slice(2)}`,
    storage: memoryStorage(),
    renderDebounceMs: 0,
  });
  for (const d of svc.getDevices()) await svc.removeDevice(d.id);
  for (const t of svc.getDeviceTypes()) await svc.removeDeviceType(t.id);
  return svc;
}

afterEach(() => cleanup());

describe("SerialDevicesMenu", () => {
  it("creates a device type via the UI and reflects it in the service", async () => {
    const svc = await makeEmptyService();
    render(
      <SerialDeviceProvider service={svc}>
        <ModalProvider>
          <SerialDevicesMenu />
        </ModalProvider>
      </SerialDeviceProvider>,
    );

    // Switch to Device Types tab, open the editor.
    fireEvent.click(screen.getByRole("tab", { name: /device types/i }));
    fireEvent.click(screen.getByRole("button", { name: /add type/i }));

    fireEvent.change(screen.getByLabelText("Type name"), {
      target: { value: "Demo Panel" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save type/i }));

    expect(svc.getDeviceTypes().map((t) => t.name)).toContain("Demo Panel");
  });

  it("creates a virtual device of an existing type", async () => {
    const svc = await makeEmptyService();
    svc.upsertDeviceType({
      id: "panel",
      name: "Panel",
      parser: "char-position",
      inputs: [{ id: "a", name: "A", kind: "button" }],
    });

    render(
      <SerialDeviceProvider service={svc}>
        <ModalProvider>
          <SerialDevicesMenu />
        </ModalProvider>
      </SerialDeviceProvider>,
    );

    // Default tab is Devices. Add one.
    fireEvent.click(screen.getByRole("button", { name: /add device/i }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Panel 1" },
    });
    // Transport defaults to "virtual"; type defaults to first.
    fireEvent.click(screen.getByRole("button", { name: /save device/i }));

    const devices = svc.getDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe("Panel 1");
    expect(devices[0].transport).toBe("virtual");
    expect(devices[0].typeId).toBe("panel");
  });

  it("keeps add-device enabled with no types (a gamepad is always creatable)", async () => {
    const svc = await makeEmptyService();
    render(
      <SerialDeviceProvider service={svc}>
        <ModalProvider>
          <SerialDevicesMenu />
        </ModalProvider>
      </SerialDeviceProvider>,
    );

    // The gamepad transport needs no pre-existing user type, so add-device is
    // always available now — the old "disabled when no types" guard was removed.
    const addBtn = screen.getByRole("button", { name: /add device/i });
    expect(addBtn).toBeEnabled();
  });
});
