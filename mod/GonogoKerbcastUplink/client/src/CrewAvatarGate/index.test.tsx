import { SettingsProvider, SettingsService } from "@ksp-gonogo/core";
import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { KerbcastAvatarAugment } from "./index";

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

function renderGate(embedded?: boolean) {
  const service = new SettingsService(memoryStorage());
  if (embedded !== undefined) {
    service.set("kerbcast.embeddedFacecams", embedded);
  }
  return render(
    <SettingsProvider service={service}>
      <KerbcastAvatarAugment kerbalName="Jeb" />
    </SettingsProvider>,
  );
}

describe("KerbcastAvatarAugment — embedded-facecam kill-switch gate", () => {
  it("renders the facecam avatar child when the switch is ON (default)", () => {
    const { container } = renderGate(); // unset → defaults to ON
    expect(container.querySelector("span")).not.toBeNull();
  });

  it("renders nothing when the switch is OFF — the subscribing child never mounts", () => {
    const { container } = renderGate(false);
    // The component-boundary split returns before the child renders, so the
    // subscribing FacecamAvatar (its future home) is never mounted: zero cost.
    expect(container.querySelector("span")).toBeNull();
    expect(container.childElementCount).toBe(0);
  });
});
