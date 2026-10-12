import { act, render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SerialDeviceProvider } from "../SerialDeviceContext";
import { SerialDeviceService } from "../SerialDeviceService";
import { SerialDevicesMenu } from "./index";

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

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value,
  });
}

describe("SerialDevicesMenu USB serial switch", () => {
  let originalSerial: PropertyDescriptor | undefined;
  let originalSecureContext: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalSerial = Object.getOwnPropertyDescriptor(navigator, "serial");
    originalSecureContext = Object.getOwnPropertyDescriptor(
      window,
      "isSecureContext",
    );
  });

  afterEach(() => {
    if (originalSerial) {
      Object.defineProperty(navigator, "serial", originalSerial);
    } else {
      delete (navigator as { serial?: unknown }).serial;
    }
    if (originalSecureContext) {
      Object.defineProperty(window, "isSecureContext", originalSecureContext);
    } else {
      delete (window as { isSecureContext?: boolean }).isSecureContext;
    }
  });

  const USB_TYPE = {
    id: "box",
    name: "Button Box",
    parser: "char-position",
    inputs: [{ id: "a", name: "A", kind: "button" }],
  };
  const USB_DEVICE = {
    id: "usb1",
    name: "Throttle",
    typeId: "box",
    transport: "web-serial",
  };

  function setUsbSupported(supported: boolean): void {
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: supported ? { requestPort: () => Promise.resolve() } : undefined,
    });
    setSecureContext(supported);
  }

  function renderMenu(opts: { usbOn?: boolean; saved?: boolean } = {}) {
    const storage = memoryStorage();
    if (opts.usbOn) storage.setItem("gonogo.serial.usb-enabled.test", "1");
    if (opts.saved) {
      storage.setItem("gonogo.serial.device-types", JSON.stringify([USB_TYPE]));
      storage.setItem(
        "gonogo.serial.devices.test",
        JSON.stringify([USB_DEVICE]),
      );
    }
    const svc = new SerialDeviceService({
      screenKey: "test",
      storage,
      renderDebounceMs: 0,
    });
    const view = render(
      // SerialDevicesMenu is always opened inside a Modal in production (see
      // SerialFab.tsx), and a gamepad DeviceRow offers its own nested
      // "Learn roles..." modal, so it needs a real ModalProvider ancestor.
      <ModalProvider>
        <SerialDeviceProvider service={svc}>
          <SerialDevicesMenu />
        </SerialDeviceProvider>
      </ModalProvider>,
    );
    return { svc, ...view };
  }

  it("shows nothing about USB serial while it is off, whatever the browser", async () => {
    setUsbSupported(false);
    const { container, unmount, svc } = renderMenu();
    await act(async () => {});

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Device Types" })).toBeNull();
    expect(screen.queryByText(/self-describing/i)).toBeNull();
    expect(screen.queryByText(/web serial|secure context|flag/i)).toBeNull();
    expect(
      (screen.getByRole("checkbox", { name: "USB serial" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    await expectNoA11yViolations(container);
    unmount();
    await svc.destroy();
  });

  it("lists a saved USB serial device as unavailable while it is off, and runs it again when switched on", async () => {
    setUsbSupported(true);
    const user = userEvent.setup();
    const { unmount, svc } = renderMenu({ saved: true });
    await act(async () => {});

    expect(screen.getByText("Throttle")).toBeTruthy();
    expect(screen.getByText("unavailable")).toBeTruthy();
    expect(screen.getByText("USB serial is off")).toBeTruthy();
    expect(svc.getDevice("usb1")).toBeUndefined();

    await act(async () => {
      await user.click(screen.getByRole("checkbox", { name: "USB serial" }));
    });

    expect(screen.queryByText("unavailable")).toBeNull();
    expect(screen.getByText(/Button Box · web-serial/)).toBeTruthy();
    expect(svc.getDevice("usb1")).toBeDefined();

    await act(async () => {
      await user.click(screen.getByRole("checkbox", { name: "USB serial" }));
    });

    expect(screen.getByText("USB serial is off")).toBeTruthy();
    expect(svc.getDevice("usb1")).toBeUndefined();
    expect(svc.getUnavailableDevice("usb1")?.reason).toBe("usb-serial-off");
    unmount();
    await svc.destroy();
  });

  it("keeps the saved device in storage across a reload with the switch off", async () => {
    setUsbSupported(true);
    const storage = memoryStorage();
    storage.setItem("gonogo.serial.device-types", JSON.stringify([USB_TYPE]));
    storage.setItem("gonogo.serial.devices.test", JSON.stringify([USB_DEVICE]));
    const first = new SerialDeviceService({
      screenKey: "test",
      storage,
      renderDebounceMs: 0,
    });
    await first.destroy();

    const rows: { id: string }[] = JSON.parse(
      storage.getItem("gonogo.serial.devices.test") ?? "[]",
    );
    expect(rows.map((r) => r.id)).toContain("usb1");
  });

  it("offers the self-describing wizard and the type editor once USB serial is on and the browser can run it", async () => {
    setUsbSupported(true);
    const { unmount, svc } = renderMenu({ usbOn: true });
    await act(async () => {});

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("+ add self-describing")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Device Types" })).toBeTruthy();
    unmount();
    await svc.destroy();
  });

  it("shows no banner in the list when USB serial is on but the browser cannot run it, and disables Connect on a saved device", async () => {
    setUsbSupported(false);
    const { container, unmount, svc } = renderMenu({
      usbOn: true,
      saved: true,
    });
    await act(async () => {});

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("+ add self-describing")).toBeNull();
    const connects = screen.getAllByRole("button", { name: "Connect" });
    expect(connects.some((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    await expectNoA11yViolations(container);
    unmount();
    await svc.destroy();
  });

  it("still offers a gamepad device Connect button when USB serial cannot run, the Gamepad API is cross-browser", async () => {
    setUsbSupported(false);
    const { svc, unmount } = renderMenu();
    await act(async () => {
      svc.addDevice({
        id: "gp1",
        name: "My Pad",
        typeId: "gamepad-unconfigured",
        transport: "gamepad",
      });
    });
    await act(async () => {});

    expect(
      screen.getAllByRole("button", { name: "Connect" }).length,
    ).toBeGreaterThan(0);
    unmount();
    await svc.destroy();
  });
});
