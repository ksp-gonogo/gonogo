import type { ActionDefinition } from "@ksp-gonogo/core";
import { memoryStorage } from "@ksp-gonogo/core/test";
import { act, render, screen, within } from "@ksp-gonogo/test-utils";
import { ModalProvider, useModal } from "@ksp-gonogo/ui";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { InputMappingTab } from "./InputMappingTab";
import { SerialDeviceProvider } from "./SerialDeviceContext";
import { SerialDeviceService } from "./SerialDeviceService";
import { SerialDevicesMenu } from "./SerialDevicesMenu";
import { VirtualTransport } from "./transports/VirtualTransport";
import type { DeviceInstance, DeviceType } from "./types";

const TYPE: DeviceType = {
  id: "pad",
  name: "Pad",
  parser: "char-position",
  inputs: [{ id: "a", name: "A", kind: "button" }],
};

const DEVICES_KEY = "gonogo.serial.devices.saved";
const TYPES_KEY = "gonogo.serial.device-types";

const virtual = (id: string): DeviceInstance => ({
  id,
  name: `Virtual ${id}`,
  typeId: TYPE.id,
  transport: "virtual",
});

const unknownKind = {
  id: "midi1",
  name: "Launch Pad",
  typeId: TYPE.id,
  transport: "midi",
};

const missingType = {
  id: "orphan",
  name: "Old Box",
  typeId: "gone",
  transport: "virtual",
};

function seed(rows: unknown[], types: DeviceType[] = [TYPE]): Storage {
  const storage = memoryStorage();
  storage.setItem(TYPES_KEY, JSON.stringify(types));
  storage.setItem(DEVICES_KEY, JSON.stringify(rows));
  return storage;
}

function load(storage: Storage): SerialDeviceService {
  return new SerialDeviceService({
    screenKey: "saved",
    storage,
    renderDebounceMs: 0,
  });
}

function savedIds(storage: Storage): string[] {
  const rows: { id: string }[] = JSON.parse(
    storage.getItem(DEVICES_KEY) ?? "[]",
  );
  return rows.map((r) => r.id);
}

describe("SerialDeviceService saved devices", () => {
  it("loads the rows after a corrupt row and after an unknown transport in the middle", async () => {
    const storage = seed([
      virtual("first"),
      "not a row",
      { name: "no id" },
      unknownKind,
      virtual("last"),
    ]);
    const svc = load(storage);

    expect(svc.getDevices().map((d) => d.id)).toEqual(
      expect.arrayContaining(["first", "last"]),
    );
    expect(svc.getUnavailableDevices().map((u) => u.instance.id)).toEqual([
      "midi1",
    ]);
    await svc.destroy();
  });

  it("keeps an unknown transport in storage and says what it needs", async () => {
    const storage = seed([virtual("first"), unknownKind]);
    const svc = load(storage);

    expect(svc.getUnavailableDevice("midi1")).toMatchObject({
      reason: "unknown-transport",
      needs: "midi",
    });
    expect(svc.getDevice("midi1")).toBeUndefined();
    expect(savedIds(storage)).toContain("midi1");
    await svc.destroy();
  });

  it("keeps a device whose type is missing, and runs it once the type is back", async () => {
    const storage = seed([missingType, virtual("after")]);
    const svc = load(storage);

    expect(svc.getUnavailableDevice("orphan")).toMatchObject({
      reason: "missing-type",
      needs: "gone",
    });
    expect(svc.getDevice("after")).toBeDefined();
    expect(savedIds(storage)).toContain("orphan");

    svc.upsertDeviceType({ ...TYPE, id: "gone", name: "Gone" });

    expect(svc.getDevice("orphan")).toBeDefined();
    expect(svc.getUnavailableDevices()).toEqual([]);
    await svc.destroy();
  });

  it("keeps a device whose transport throws while it is built", async () => {
    const storage = seed([virtual("boom"), virtual("fine")]);
    const svc = new SerialDeviceService({
      screenKey: "saved",
      storage,
      renderDebounceMs: 0,
      transportFactory: (instance) => {
        if (instance.id === "boom") throw new Error("no such port");
        return new VirtualTransport(instance.id);
      },
    });

    expect(svc.getUnavailableDevice("boom")?.reason).toBe("transport-error");
    expect(svc.getDevice("fine")).toBeDefined();
    expect(savedIds(storage)).toContain("boom");
    await svc.destroy();
  });

  it("removes an unavailable device from storage on Remove", async () => {
    const storage = seed([unknownKind, virtual("first")]);
    const svc = load(storage);

    await svc.removeDevice("midi1");

    expect(svc.getUnavailableDevices()).toEqual([]);
    expect(savedIds(storage)).not.toContain("midi1");
    expect(savedIds(storage)).toContain("first");
    await svc.destroy();
  });

  it("does not seed a default device when every saved row is unavailable", async () => {
    const svc = load(seed([unknownKind]));

    expect(svc.getDevices().map((d) => d.transport)).toEqual(["keyboard"]);
    await svc.destroy();
  });
});

describe("Devices list with an unavailable device", () => {
  it("lists it as unavailable, naming what it needs, with Remove", async () => {
    const storage = seed([virtual("first"), unknownKind]);
    const svc = load(storage);
    const user = userEvent.setup();
    await act(async () => {});

    const { container, unmount } = render(
      <ModalProvider>
        <SerialDeviceProvider service={svc}>
          <SerialDevicesMenu />
        </SerialDeviceProvider>
      </ModalProvider>,
    );

    let card: HTMLElement | null = screen.getByText("Launch Pad");
    while (card && !within(card).queryByRole("button", { name: "Remove" })) {
      card = card.parentElement;
    }
    const scope = within(card as HTMLElement);
    expect(scope.getByText("unavailable")).toBeTruthy();
    expect(scope.getByText(/needs midi transport/i)).toBeTruthy();
    await expectNoA11yViolations(container);

    await user.click(scope.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Launch Pad")).toBeNull();
    expect(savedIds(storage)).not.toContain("midi1");
    unmount();
    await svc.destroy();
  });
});

function AutoOpen({ content }: { content: ReactNode }) {
  const { open } = useModal();
  // biome-ignore lint/correctness/useExhaustiveDependencies: open once on mount.
  useEffect(() => {
    open(content);
  }, []);
  return null;
}

const fire: ActionDefinition = {
  id: "fire",
  label: "Fire",
  accepts: ["button"],
};

describe("Inputs tab with a binding to an unavailable device", () => {
  it("names the device instead of reading unbound, and keeps the binding", async () => {
    const svc = load(seed([unknownKind]));

    const { container } = render(
      <ModalProvider>
        <AutoOpen
          content={
            <SerialDeviceProvider service={svc}>
              <InputMappingTab
                actions={[fire]}
                mappings={{ fire: { deviceId: "midi1", inputId: "pad-3" } }}
                onSave={() => {}}
              />
            </SerialDeviceProvider>
          }
        />
      </ModalProvider>,
    );

    const select = (await screen.findByLabelText("Fire")) as HTMLSelectElement;
    expect(select.value).toBe("midi1::pad-3");
    expect(select.selectedOptions[0]?.textContent).toBe(
      "Launch Pad · pad-3 · unavailable",
    );
    await expectNoA11yViolations(container);
    await svc.destroy();
  });

  it("names the input of a binding to a device that is not on this screen at all, and keeps it", async () => {
    const svc = load(seed([virtual("first")]));
    const onSave = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <ModalProvider>
        <AutoOpen
          content={
            <SerialDeviceProvider service={svc}>
              <InputMappingTab
                actions={[fire]}
                mappings={{ fire: { deviceId: "elsewhere", inputId: "btn-7" } }}
                onSave={onSave}
              />
            </SerialDeviceProvider>
          }
        />
      </ModalProvider>,
    );

    const select = (await screen.findByLabelText("Fire")) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe(
      "btn-7 · device not on this screen",
    );
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({
      fire: { deviceId: "elsewhere", inputId: "btn-7" },
    });
    await svc.destroy();
  });
});
