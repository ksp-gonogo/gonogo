import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { AugmentSlot } from "./AugmentSlot";
import {
  clearAugments,
  getAugmentSettings,
  getAugmentsForSlot,
  registerAugment,
} from "./augments";

// The augment registry is intentionally NOT reset by `clearRegistry` (see its
// doc comment): module-load augments must survive the per-widget-test data-source
// reset. Augment-registry tests own their isolation and clear it explicitly.
beforeEach(() => clearAugments());

describe("augment registry — ordering", () => {
  it("orders augments in a slot by ascending priority, ties in registration order", () => {
    registerAugment({
      id: "late-high",
      augments: "power-systems.sections",
      component: () => null,
      priority: 10,
    });
    registerAugment({
      id: "early-low",
      augments: "power-systems.sections",
      component: () => null,
      priority: 1,
    });
    // Same priority as late-high but registered after → tie broken by order.
    registerAugment({
      id: "later-high",
      augments: "power-systems.sections",
      component: () => null,
      priority: 10,
    });
    // Different slot — must not leak into this slot's list.
    registerAugment({
      id: "other-slot",
      augments: "map-view.overlay",
      component: () => null,
    });

    const ids = getAugmentsForSlot("power-systems.sections").map((a) => a.id);
    expect(ids).toEqual(["early-low", "late-high", "later-high"]);
  });

  it("defaults priority to 0 and keeps a slot's list independent", () => {
    registerAugment({
      id: "a",
      augments: "s",
      component: () => null,
    });
    expect(getAugmentsForSlot("s").map((a) => a.id)).toEqual(["a"]);
    expect(getAugmentsForSlot("empty")).toEqual([]);
  });
});

describe("AugmentSlot — composition", () => {
  it("renders all registered augments for a slot, ordered by priority", () => {
    registerAugment({
      id: "second",
      augments: "power-systems.sections",
      component: () => <div>second</div>,
      priority: 20,
    });
    registerAugment({
      id: "first",
      augments: "power-systems.sections",
      component: () => <div>first</div>,
      priority: 10,
    });

    const { container } = render(
      <AugmentSlot name="power-systems.sections" props={{}} />,
    );

    expect(container.textContent).toBe("firstsecond");
  });

  it("composes two mutually-unaware augments on one slot (spec §4.2)", () => {
    registerAugment({
      id: "kerbalism-ec",
      augments: "power-systems.sections",
      component: () => <div>kerbalism</div>,
    });
    registerAugment({
      id: "nfe-reactor",
      augments: "power-systems.sections",
      component: () => <div>near-future</div>,
    });

    render(<AugmentSlot name="power-systems.sections" props={{}} />);

    expect(screen.getByText("kerbalism")).toBeTruthy();
    expect(screen.getByText("near-future")).toBeTruthy();
  });

  it("layers overlay augments in priority (z-)order (spec §4.8)", () => {
    registerAugment({
      id: "trajectory",
      augments: "map-view.overlay",
      component: () => <div data-testid="layer">trajectory</div>,
      priority: 30,
    });
    registerAugment({
      id: "scan",
      augments: "map-view.overlay",
      component: () => <div data-testid="layer">scan</div>,
      priority: 10,
    });
    registerAugment({
      id: "commlink",
      augments: "map-view.overlay",
      component: () => <div data-testid="layer">commlink</div>,
      priority: 20,
    });

    render(<AugmentSlot name="map-view.overlay" props={{}} />);

    // DOM order = ascending priority → the highest-priority layer is last (on top).
    const order = screen.getAllByTestId("layer").map((el) => el.textContent);
    expect(order).toEqual(["scan", "commlink", "trajectory"]);
  });

  it("passes slot props down to every augment (spec §4.4)", () => {
    function ProjAugment({ zoom }: { zoom: number }) {
      return <div>zoom:{zoom}</div>;
    }
    registerAugment({
      id: "proj",
      // Loose slot (not in SlotRegistry) → props typed as Record<string,unknown>;
      // the augment narrows what it needs. Real typed slots use SlotRegistry.
      augments: "map-view.overlay",
      component: ProjAugment as never,
    });

    render(<AugmentSlot name="map-view.overlay" props={{ zoom: 7 }} />);

    expect(screen.getByText("zoom:7")).toBeTruthy();
  });
});

describe("AugmentSlot — Domain presence gating (spec §4.2)", () => {
  it("does not render an augment whose required Domain is absent, then renders it once available", async () => {
    registerAugment({
      id: "scan-overlay",
      augments: "map-view.overlay",
      component: () => <div>scan-layer</div>,
      requires: "scansat",
      channels: ["scansat.available"],
    });

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    render(
      <TelemetryProvider client={client}>
        <AugmentSlot name="map-view.overlay" props={{}} />
      </TelemetryProvider>,
    );

    // Domain absent → augment not rendered.
    expect(screen.queryByText("scan-layer")).toBeNull();

    // Domain announces availability → augment appears.
    act(() => {
      transport.emit(
        "scansat.available",
        { available: true },
        { quality: Quality.Loaded, source: "scansat" },
      );
    });

    await waitFor(() => expect(screen.getByText("scan-layer")).toBeTruthy());
  });

  it("renders an ungated augment even without a TelemetryProvider", () => {
    registerAugment({
      id: "ungated",
      augments: "power-systems.sections",
      component: () => <div>always</div>,
    });

    render(<AugmentSlot name="power-systems.sections" props={{}} />);

    expect(screen.getByText("always")).toBeTruthy();
  });
});

describe("augment settings merge (spec §4.7)", () => {
  it("collects each augment's settings namespaced by augment id, ordered like the slot", () => {
    registerAugment({
      id: "kerbalism",
      augments: "power-systems.sections",
      component: () => null,
      priority: 20,
      settings: [{ key: "showPerConverter", type: "boolean", default: false }],
    });
    registerAugment({
      id: "near-future",
      augments: "power-systems.sections",
      component: () => null,
      priority: 10,
      settings: [{ key: "reactorUnits", type: "text", default: "MW" }],
    });
    // An augment with no settings contributes no block.
    registerAugment({
      id: "no-settings",
      augments: "power-systems.sections",
      component: () => null,
    });

    const merged = getAugmentSettings("power-systems.sections");

    expect(merged).toEqual([
      {
        augmentId: "near-future",
        namespace: "near-future",
        fields: [{ key: "reactorUnits", type: "text", default: "MW" }],
      },
      {
        augmentId: "kerbalism",
        namespace: "kerbalism",
        fields: [{ key: "showPerConverter", type: "boolean", default: false }],
      },
    ]);
  });

  it("keeps identically-keyed settings from two augments in separate namespaces", () => {
    registerAugment({
      id: "aug-a",
      augments: "s",
      component: () => null,
      settings: [{ key: "enabled", type: "boolean", default: true }],
    });
    registerAugment({
      id: "aug-b",
      augments: "s",
      component: () => null,
      settings: [{ key: "enabled", type: "boolean", default: false }],
    });

    const merged = getAugmentSettings("s");
    const namespaces = merged.map((m) => m.namespace);

    // Same field key, distinct namespaces → no collision in instance config.
    expect(namespaces).toEqual(["aug-a", "aug-b"]);
    expect(merged[0]?.fields[0]?.key).toBe("enabled");
    expect(merged[1]?.fields[0]?.key).toBe("enabled");
  });
});
