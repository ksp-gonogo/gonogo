import {
  clearContributions,
  clearRegistry,
  registerComponent,
  registerContribution,
  useContributions,
  useWidgetMeta,
} from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import {
  Panel,
  useDelayRailStore,
  usePanelStatusStore,
} from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PeerClient,
  PeerClientProvider,
} from "../../peer/PeerClientContext";
import { PushClientProvider } from "../../pushToMain/PushClientContext";
import { idlePeerClient } from "../../test/peerFakes";
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

  it("mounts the delay rail and panel status store a desktop tile mounts", () => {
    registerComponent({
      id: "mobile-stores",
      name: "Mobile Stores",
      description: "Store probe",
      tags: [],
      component: function MobileStores() {
        const rail = useDelayRailStore();
        const status = usePanelStatusStore();
        return (
          <span>
            rail:{rail ? "yes" : "no"} status:{status ? "yes" : "no"}
          </span>
        );
      },
    });

    renderList([{ i: "m3", componentId: "mobile-stores" }]);

    expect(screen.getByText("rail:yes status:yes")).toBeInTheDocument();
  });
});

describe("MobileDashboard push to main", () => {
  beforeEach(() => {
    clearRegistry();
  });

  function registerProbe(id: string, pushable: boolean) {
    registerComponent({
      id,
      name: id,
      description: "Push probe",
      tags: [],
      pushable,
      component: function PushProbe() {
        return <div>body</div>;
      },
    });
  }

  function renderOnStation(items: DashboardItem[]) {
    const client: PeerClient = {
      ...idlePeerClient(),
      getApproval: () => "approved",
      getHostSeat: () => "main",
    };
    return render(
      <PeerClientProvider client={client}>
        <PushClientProvider>
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
          />
        </PushClientProvider>
      </PeerClientProvider>,
    );
  }

  it("puts a Push to main button beside the options button of a pushable tile, and recalls on a second press", async () => {
    registerProbe("push-probe", true);
    renderOnStation([{ i: "a", componentId: "push-probe" }]);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole("button", { name: "Push to main" }));
    expect(
      screen.getByRole("button", { name: "Recall from main" }),
    ).toBeInTheDocument();
  });

  it("has no push button on a tile that is not pushable", () => {
    registerProbe("plain-probe", false);
    renderOnStation([{ i: "a", componentId: "plain-probe" }]);
    expect(screen.queryByRole("button", { name: /main$/ })).toBeNull();
  });

  it("has no push button where no push client is mounted", () => {
    registerProbe("push-probe", true);
    renderList([{ i: "a", componentId: "push-probe" }]);
    expect(screen.queryByRole("button", { name: /main$/ })).toBeNull();
  });
});
