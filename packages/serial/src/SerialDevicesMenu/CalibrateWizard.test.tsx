import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SerialDeviceProvider } from "../SerialDeviceContext";
import { SerialDeviceService } from "../SerialDeviceService";
import type { VirtualTransport } from "../transports/VirtualTransport";
import type { DeviceInput } from "../types";
import { CalibrateWizard } from "./CalibrateWizard";

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

async function setup(initialInputs: DeviceInput[]) {
  const svc = new SerialDeviceService({
    screenKey: `cal-${Math.random().toString(36).slice(2)}`,
    storage: memoryStorage(),
    renderDebounceMs: 0,
  });
  for (const d of svc.getDevices()) await svc.removeDevice(d.id);
  for (const t of svc.getDeviceTypes()) await svc.removeDeviceType(t.id);
  svc.upsertDeviceType({
    id: "t",
    name: "Pad",
    parser: "char-position",
    inputs: initialInputs,
  });
  svc.addDevice({
    id: "d1",
    name: "Pad 1",
    typeId: "t",
    transport: "virtual",
  });
  await svc.connect("d1");
  const transport = svc.getTransport("d1") as VirtualTransport;
  return { svc, transport };
}

describe("CalibrateWizard", () => {
  it("captures live raw lines from the selected device and previews parsed values", async () => {
    const { svc, transport } = await setup([
      {
        id: "x",
        name: "X",
        kind: "analog",
        offset: 0,
        length: 3,
        min: 0,
        max: 1023,
      },
    ]);
    const onApply = vi.fn();
    render(
      <SerialDeviceProvider service={svc}>
        <CalibrateWizard
          inputs={[
            {
              id: "x",
              name: "X",
              kind: "analog",
              offset: 0,
              length: 3,
              min: 0,
              max: 1023,
            },
          ]}
          onApply={onApply}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    // injectRawLine delivers synchronously through the transport listener
    // chain into a React setState, so wrap it in act() (no testing-library
    // async equivalent for a synchronous external push).
    act(() => transport.injectRawLine("512"));
    // Preview row reads the latest line and surfaces the normalised value.
    // 512 / 1023 → roughly centre, so we expect a normalised value near 0.
    await waitFor(() =>
      expect(
        screen
          .getAllByText(/live:/i)
          .some((el) => /0\.\d/.test(el.textContent ?? "")),
      ).toBe(true),
    );

    await svc.destroy();
  });

  it("captures raw min/max while the wiggle pass is active and applies them on Done", async () => {
    const { svc, transport } = await setup([
      {
        id: "x",
        name: "X",
        kind: "analog",
        offset: 0,
        length: 3,
        min: 0,
        max: 1023,
      },
    ]);
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <SerialDeviceProvider service={svc}>
        <CalibrateWizard
          inputs={[
            {
              id: "x",
              name: "X",
              kind: "analog",
              offset: 0,
              length: 3,
              min: 0,
              max: 1023,
            },
          ]}
          onApply={onApply}
          onClose={() => {}}
        />
      </SerialDeviceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /capture range/i }));
    // Synchronous external pushes into React setState — wrap each in act().
    act(() => transport.injectRawLine("100"));
    act(() => transport.injectRawLine("900"));
    act(() => transport.injectRawLine("500"));

    await user.click(screen.getByRole("button", { name: /^done$/i }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith([
      expect.objectContaining({ id: "x", min: 100, max: 900 }),
    ]);

    await svc.destroy();
  });
});
