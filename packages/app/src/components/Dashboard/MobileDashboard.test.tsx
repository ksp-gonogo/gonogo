import {
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
import type { DashboardItem } from "./index";
import { MobileDashboard } from "./MobileDashboard";

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "mobile-probe.rows": { entry: { id: string; label: string } };
  }
}

vi.mock("@ksp-gonogo/components", () => ({
  SeatGuard: (props: { children: React.ReactNode }) => <>{props.children}</>,
  RequiresGuard: (props: { children: React.ReactNode }) => (
    <>{props.children}</>
  ),
}));

function renderList(items: DashboardItem[]) {
  return render(
    <MobileDashboard
      items={items}
      layout={[]}
      onLayoutChange={vi.fn()}
      updateItemConfig={vi.fn()}
      updateItemMappings={vi.fn()}
      updateItemMobileWidth={vi.fn()}
      updateItemMobileHeight={vi.fn()}
      removeItem={vi.fn()}
      moveItemUp={vi.fn()}
      moveItemDown={vi.fn()}
      lastAddedId={null}
      clearLastAdded={vi.fn()}
    />,
  );
}

describe("MobileDashboard widget wiring", () => {
  beforeEach(() => {
    clearRegistry();
    clearContributions();
  });

  it("gives a phone tile the same contributions a desktop tile gets", () => {
    registerContribution({
      id: "probe-row",
      contributes: "mobile-probe.rows",
      compute: () => [{ id: "row-1", label: "hello from a contribution" }],
    });
    registerComponent({
      id: "mobile-probe",
      name: "Mobile Probe",
      description: "Test probe for contribution wiring",
      tags: [],
      contributionSlots: ["mobile-probe.rows"],
      component: function MobileProbe() {
        const meta = useWidgetMeta();
        const rows = useContributions("mobile-probe.rows");
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

    renderList([{ i: "m1", componentId: "mobile-probe" }]);

    expect(screen.getByText("componentId:mobile-probe")).toBeInTheDocument();
    expect(screen.getByText("hello from a contribution")).toBeInTheDocument();
  });

  it("shows a badge contributed to the widget's own badges slot on a phone tile", () => {
    registerContribution({
      id: "auto-badge",
      contributes: "mobile-badge.badges",
      compute: () => [{ id: "b1", label: "AUTO-BADGE" }],
    });
    registerComponent({
      id: "mobile-badge",
      name: "Mobile Badge",
      description: "Badge probe",
      tags: [],
      component: () => <Panel panelTitle="Mobile Badge" />,
    });

    renderList([{ i: "m2", componentId: "mobile-badge" }]);

    expect(screen.getByText("AUTO-BADGE")).toBeTruthy();
  });
});
