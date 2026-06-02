import { cleanup, render, screen } from "@testing-library/react";
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

describe("SerialDevicesMenu Web Serial support banner", () => {
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
    cleanup();
    if (originalSerial) {
      Object.defineProperty(navigator, "serial", originalSerial);
    } else {
      delete (navigator as Navigator & { serial?: unknown }).serial;
    }
    if (originalSecureContext) {
      Object.defineProperty(window, "isSecureContext", originalSecureContext);
    } else {
      delete (window as Window & { isSecureContext?: boolean }).isSecureContext;
    }
  });

  function renderMenu(): void {
    const svc = new SerialDeviceService({
      screenKey: "test",
      storage: memoryStorage(),
      renderDebounceMs: 0,
    });
    render(
      <SerialDeviceProvider service={svc}>
        <SerialDevicesMenu />
      </SerialDeviceProvider>,
    );
  }

  it("shows the unsupported-browser banner when serial is absent in a secure context", () => {
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: undefined,
    });
    setSecureContext(true);
    renderMenu();
    expect(screen.getByRole("status").textContent).toMatch(
      /not available in this browser/i,
    );
  });

  it("shows the insecure-context banner when serial is absent on an insecure origin", () => {
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: undefined,
    });
    setSecureContext(false);
    renderMenu();
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/secure context/i);
    expect(banner.textContent).toMatch(/unsafely-treat-insecure-origin/i);
  });

  it("hides the banner when navigator.serial.requestPort exists", () => {
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: () => Promise.resolve() },
    });
    renderMenu();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
