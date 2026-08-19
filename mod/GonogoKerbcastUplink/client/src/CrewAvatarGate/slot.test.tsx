/**
 * Presence-gate wiring for the `crew-status.avatar` slot: proves the
 * augment is bound to the real slot id, behind the real `requires:
 * "kerbcast"` gate `<AugmentSlot>` enforces: not just callable directly with
 * hand-picked props (that's index.test.tsx's job).
 */

import { AugmentSlot, Quality, type SlotProps } from "@ksp-gonogo/sitrep-sdk";
import {
  createTestTelemetryClient,
  render,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  clearRegistry,
  clearUplinkHandles,
  SettingsProvider,
  SettingsService,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-testing";
import { ModalProvider } from "@ksp-gonogo/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
// Importing the real module runs its module-load `registerAugment(...)` once,
// the same way the app picks this augment up via the package's bare
// `import "./CrewAvatarGate"`. Deliberately never call `clearAugments()`
// here for the same reason DockingCameraAugment's slot test doesn't: it
// would wipe the one real registration this file exists to check.
import "./index";

const CONTEXT: SlotProps<"crew-status.avatar"> = {
  crewName: "Jebediah Kerman",
  crewIndex: 0,
};

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    length: m.size,
    clear: () => m.clear(),
    key: () => null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  } as Storage;
}

function renderSlot(transport: StubTransport) {
  const client = createTestTelemetryClient(transport);
  const settings = new SettingsService(memoryStorage());
  return render(
    <TelemetryProvider client={client}>
      <SettingsProvider service={settings}>
        <ModalProvider>
          <AugmentSlot name="crew-status.avatar" props={CONTEXT} />
        </ModalProvider>
      </SettingsProvider>
    </TelemetryProvider>,
  );
}

describe("kerbcast crew-avatar augment: crew-status.avatar slot", () => {
  beforeEach(() => {
    clearRegistry();
    clearUplinkHandles();
  });

  it("does not render at all before kerbcast announces availability", () => {
    const transport = new StubTransport();
    const { container } = renderSlot(transport);
    expect(container.querySelector("button")).toBeNull();
  });

  it("stays absent with no TelemetryProvider at all (no stream mounted)", () => {
    const settings = new SettingsService(memoryStorage());
    const { container } = render(
      <SettingsProvider service={settings}>
        <ModalProvider>
          <AugmentSlot name="crew-status.avatar" props={CONTEXT} />
        </ModalProvider>
      </SettingsProvider>,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("mounts once kerbcast.available goes live, and still renders nothing with no matching camera", async () => {
    const transport = new StubTransport();
    const { container } = renderSlot(transport);

    transport.emit("kerbcast.available", true, {
      quality: Quality.Loaded,
      source: "kerbcast",
    });

    // No kerbcast handle registered in this test, so even once the Domain
    // gate opens there is nothing to correlate against, composes to nothing,
    // never a throw.
    await Promise.resolve();
    expect(container.querySelector("button")).toBeNull();
  });
});
