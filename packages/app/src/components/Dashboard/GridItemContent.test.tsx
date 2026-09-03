/*
 * Structural guard: verify that all widget action buttons (Remove, Configure)
 * live inside a .widget-action-buttons container, which is the draggableCancel
 * target in GridDashboard. If the class or wrapper is ever removed, the touch
 * drag regression returns -- this test catches that drift.
 *
 * Note: react-draggable attaches onTouchStart via addEventListener({passive:false}),
 * bypassing React's synthetic event system. stopPropagation on mouse events is
 * not sufficient for touch. The actual drag-start hit-test is not reproducible
 * in jsdom; this test guards the selector contract instead.
 */
import {
  type ComponentProps,
  clearContributions,
  clearRegistry,
  registerComponent,
  registerContribution,
  useContributions,
  useWidgetMeta,
} from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { Panel } from "@ksp-gonogo/ui-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GridItemContent } from "./GridItemContent";
import type { DashboardItem } from "./index";

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "meta-probe.rows": { entry: { id: string; label: string } };
  }
}

/* Stub context hooks and heavy dependencies pulled in transitively. */
// Capture what the chrome hands the render-gate so we can assert optionalChannels
// never reaches it (see the optionalChannels test below).
// Captured so the chrome can be shown to hand the seat gate the whole def,
// which is what lets the gate read `optionalChannels` and `dataRequirements`
// that the health gate deliberately never sees.
const seatCapture = vi.hoisted(() => ({ last: null as unknown }));
const guardCapture = vi.hoisted(() => ({
  last: null as {
    requires?: readonly string[];
    channels?: readonly string[];
    optionalChannels?: readonly string[];
  } | null,
}));
vi.mock("@ksp-gonogo/components", () => ({
  /*
   * Pass-through, like `RequiresGuard` below: this file is about the chrome's
   * structure, and the seat gate's own behaviour is covered where the
   * derivation lives (`seatAvailability.test.ts`).
   */
  SeatGuard: (props: { children: React.ReactNode; def: unknown }) => {
    seatCapture.last = props.def;
    return <>{props.children}</>;
  },
  RequiresGuard: (props: {
    children: React.ReactNode;
    requires?: readonly string[];
    channels?: readonly string[];
    optionalChannels?: readonly string[];
  }) => {
    guardCapture.last = {
      requires: props.requires,
      channels: props.channels,
      optionalChannels: props.optionalChannels,
    };
    return <>{props.children}</>;
  },
}));

vi.mock("../../pushToMain/PushClientContext", () => ({
  usePushClient: () => null,
}));

vi.mock("./WidgetGearMenu", () => ({
  GearButton: ({ def }: { def: { name: string } }) => (
    <button type="button" aria-label={`Configure ${def.name}`}>
      gear
    </button>
  ),
  GearWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function StubWidget(_: ComponentProps) {
  return <div data-testid="stub-widget" />;
}

const STUB_ITEM: DashboardItem = { i: "w1", componentId: "stub" };

describe("GridItemContent: draggableCancel structural guard", () => {
  beforeEach(() => {
    // Both clears live HERE, not in `afterEach`. RTL's auto-cleanup runs AFTER a user
    // `afterEach`, so a clear written there fires while the previous test's tree is still
    // mounted, and `SlotAggregator` reads the contribution registry through
    // `useSyncExternalStore`: the clear then notifies mounted subscribers from outside
    // `act`, which was 14 warnings in this file. By the time this hook runs the tree is
    // already unmounted, so the clear notifies nothing, with no explicit `cleanup()` and
    // no dependence on which hook the framework registered first.
    clearRegistry();
    clearContributions();
    registerComponent({
      id: "stub",
      name: "Stub",
      description: "Test stub",
      tags: [],
      component: StubWidget,
    });
  });

  it("wraps Remove and Configure buttons in .widget-action-buttons", () => {
    registerComponent({
      id: "configurable-stub",
      name: "Configurable Stub",
      description: "Has config",
      tags: [],
      component: StubWidget,
      configComponent: () => null,
    });

    const item: DashboardItem = { i: "w2", componentId: "configurable-stub" };
    render(
      <GridItemContent
        item={item}
        w={3}
        h={3}
        updateItemConfig={vi.fn()}
        updateItemMappings={vi.fn()}
        removeItem={vi.fn()}
      />,
    );

    const removeBtn = screen.getByRole("button", { name: /Remove widget/i });
    const configureBtn = screen.getByRole("button", { name: /Configure/i });
    const cancelTarget = document.querySelector(".widget-action-buttons");

    expect(cancelTarget).not.toBeNull();
    expect(cancelTarget).toContainElement(removeBtn);
    expect(cancelTarget).toContainElement(configureBtn);
  });

  it("wraps the Remove button in .widget-action-buttons even without a config component", () => {
    render(
      <GridItemContent
        item={STUB_ITEM}
        w={3}
        h={3}
        updateItemConfig={vi.fn()}
        updateItemMappings={vi.fn()}
        removeItem={vi.fn()}
      />,
    );

    const removeBtn = screen.getByRole("button", { name: /Remove widget/i });
    const cancelTarget = document.querySelector(".widget-action-buttons");

    expect(cancelTarget).not.toBeNull();
    expect(cancelTarget).toContainElement(removeBtn);
  });

  it("hands the render-gate def.channels only, never def.optionalChannels", () => {
    // optionalChannels must never gate: an unhealthy OPTIONAL uplink should not
    // blank a widget that handles absence itself (SystemView relies on this).
    // The chrome enforces it by passing the gate def.channels alone, guard that
    // wiring so a future accidental optionalChannels pass-through is caught.
    registerComponent({
      id: "optional-channels-stub",
      name: "Optional Channels Stub",
      description: "declares both required and optional channels",
      tags: [],
      component: StubWidget,
      channels: ["comms.link"],
      optionalChannels: ["vessel.orbit"],
    });

    const item: DashboardItem = {
      i: "w3",
      componentId: "optional-channels-stub",
    };
    render(
      <GridItemContent
        item={item}
        w={3}
        h={3}
        updateItemConfig={vi.fn()}
        updateItemMappings={vi.fn()}
        removeItem={vi.fn()}
      />,
    );

    expect(guardCapture.last?.channels).toEqual(["comms.link"]);
    expect(guardCapture.last?.optionalChannels).toBeUndefined();
    // The SEAT gate gets the whole def, and must: an optional ground channel
    // still makes a widget a ground instrument, even though it must never gate
    // that widget's health. The two gates ask different questions off the same
    // declaration, and this is where the chrome keeps them apart.
    expect(seatCapture.last).toMatchObject({
      channels: ["comms.link"],
      optionalChannels: ["vessel.orbit"],
    });
    expect(screen.getByTestId("stub-widget")).toBeInTheDocument();
  });

  it("wraps a rendered widget in WidgetMetaContext + ContributionsProvider so useContributions works with zero widget-side setup", () => {
    registerContribution({
      id: "probe-row",
      contributes: "meta-probe.rows",
      compute: () => [{ id: "row-1", label: "hello from a contribution" }],
    });
    registerComponent({
      id: "meta-probe",
      name: "Meta Probe",
      description: "Test probe for contribution wiring",
      tags: [],
      contributionSlots: ["meta-probe.rows"],
      component: function MetaProbe() {
        const meta = useWidgetMeta();
        const rows = useContributions("meta-probe.rows");
        return (
          <div>
            <span>componentId:{meta?.componentId}</span>
            {rows.map((r) => (
              <span key={r.contributionId}>{r.label}</span>
            ))}
          </div>
        );
      },
    });

    const item: DashboardItem = { i: "w4", componentId: "meta-probe" };
    render(
      <GridItemContent
        item={item}
        w={3}
        h={3}
        updateItemConfig={vi.fn()}
        updateItemMappings={vi.fn()}
        removeItem={vi.fn()}
      />,
    );

    expect(screen.getByText("componentId:meta-probe")).toBeInTheDocument();
    expect(screen.getByText("hello from a contribution")).toBeInTheDocument();
  });

  it("a widget's Panel shows a badge from a contribution registered against the widget's own `<componentId>.badges` slot, with no widget-side wiring", () => {
    clearContributions();
    registerContribution({
      id: "auto-badge",
      contributes: "badge-probe.badges",
      compute: () => [{ id: "b1", label: "AUTO-BADGE" }],
    });
    registerComponent({
      id: "badge-probe",
      name: "Badge Probe",
      description: "Badge probe",
      tags: [],
      component: () => <Panel panelTitle="Badge Probe" />,
    });

    render(
      <GridItemContent
        item={{ i: "instance-2", componentId: "badge-probe" }}
        w={3}
        h={3}
        updateItemConfig={vi.fn()}
        updateItemMappings={vi.fn()}
        removeItem={vi.fn()}
      />,
    );

    expect(screen.getByText("AUTO-BADGE")).toBeTruthy();
  });
});
