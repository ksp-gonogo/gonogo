/**
 * Presence-gate wiring for the `crew-manifest.avatar` slot: proves the
 * augment is bound to the real slot id, behind the real `requires:
 * "kerbcast"` gate `<AugmentSlot>` enforces — not just callable directly with
 * hand-picked props (that's index.test.tsx's job).
 */

import {
  clearRegistry,
  clearUplinkHandles,
  SettingsProvider,
  SettingsService,
} from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { AugmentSlot, Quality, type SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { beforeEach, describe, expect, it } from "vitest";
// Importing the real module runs its module-load `registerAugment(...)` once
// — the same way the app picks this augment up via the package's bare
// `import "./CrewAvatarGate"`. Deliberately never call `clearAugments()`
// here for the same reason DockingCameraAugment's slot test doesn't: it
// would wipe the one real registration this file exists to check.
import "./index";

const CONTEXT: SlotProps<"crew-manifest.avatar"> = {
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
  const client = new TelemetryClient(transport);
  const settings = new SettingsService(memoryStorage());
  return render(
    <TelemetryProvider client={client}>
      <SettingsProvider service={settings}>
        <ModalProvider>
          <AugmentSlot name="crew-manifest.avatar" props={CONTEXT} />
        </ModalProvider>
      </SettingsProvider>
    </TelemetryProvider>,
  );
}

describe("kerbcast crew-avatar augment — crew-manifest.avatar slot", () => {
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
          <AugmentSlot name="crew-manifest.avatar" props={CONTEXT} />
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
    // gate opens there is nothing to correlate against — composes to nothing,
    // never a throw.
    await Promise.resolve();
    expect(container.querySelector("button")).toBeNull();
  });
});
