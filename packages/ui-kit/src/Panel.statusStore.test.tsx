import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Panel } from "./Panel";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";
import { axe } from "./test/axe";

/**
 * The panel header now summarises its OWN worst state out of the per-item
 * PanelStatusStore: `report` badges, stream staleness, and (via the app bridge)
 * alarms all merge through one door. These pin the store-backed header, the part
 * the old single-status aside splice could never do.
 */
function inStore(children: ReactNode) {
  return <PanelStatusStoreProvider>{children}</PanelStatusStoreProvider>;
}

describe("Panel header summary (store-backed)", () => {
  it("shows the worst of the widget's report badges by role, not a hand-picked one", () => {
    render(
      inStore(
        <Panel panelTitle="FUEL">
          <Badge severity="caution" report={{ id: "ox", label: "OX LOW" }}>
            OX
          </Badge>
          <Badge
            severity="critical"
            report={{ id: "lf", label: "LF CRITICAL" }}
          >
            LF
          </Badge>
        </Panel>,
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("LF CRITICAL");
  });

  it("drops the summary to the next-worst when the worst badge unmounts", () => {
    function Harness({ critical }: { critical: boolean }) {
      return inStore(
        <Panel panelTitle="FUEL">
          <Badge severity="caution" report={{ id: "ox", label: "OX LOW" }}>
            OX
          </Badge>
          {critical && (
            <Badge
              severity="critical"
              report={{ id: "lf", label: "LF CRITICAL" }}
            >
              LF
            </Badge>
          )}
        </Panel>,
      );
    }
    const { rerender } = render(<Harness critical />);
    expect(screen.getByRole("status")).toHaveTextContent("LF CRITICAL");
    rerender(<Harness critical={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("OX LOW");
  });

  it("folds the host-derived stream status into the same summary", () => {
    render(
      inStore(
        <Panel.Status status="resyncing">
          <Panel panelTitle="ORBIT">body</Panel>
        </Panel.Status>,
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("SYNCING");
  });

  it("lets a firing-style critical report outrank a merely stale stream", () => {
    render(
      inStore(
        <Panel.Status status="held-stale">
          <Panel panelTitle="DESCENT">
            <Badge
              severity="critical"
              report={{ id: "alarm", label: "NO BURN VECTOR" }}
            >
              !
            </Badge>
          </Panel>
        </Panel.Status>,
      ),
    );
    // stream held-stale -> warning, the report -> critical, so the alarm wins.
    expect(screen.getByRole("status")).toHaveTextContent("NO BURN VECTOR");
  });

  it("shows nothing when a store is present but empty and the stream is live", () => {
    render(
      inStore(
        <Panel.Status status="live">
          <Panel panelTitle="ORBIT">body</Panel>
        </Panel.Status>,
      ),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("re-summarises when a contribution's severity transitions (the change cue path)", () => {
    function Harness({ severity }: { severity: "caution" | "offline" }) {
      return inStore(
        <Panel panelTitle="LINK">
          <Badge severity={severity} report={{ id: "link", label: severity }}>
            L
          </Badge>
        </Panel>,
      );
    }
    const { rerender } = render(<Harness severity="caution" />);
    expect(screen.getByRole("status")).toHaveTextContent("caution");
    // A severity change updates the summary (and drives the one-shot pulse) with
    // no throw and no stale reading.
    rerender(<Harness severity="offline" />);
    expect(screen.getByRole("status")).toHaveTextContent("offline");
  });

  it("a summarised panel has no axe violations", async () => {
    const { container } = render(
      inStore(
        <Panel panelTitle="DESCENT">
          <Badge
            severity="critical"
            report={{ id: "a", label: "NO BURN VECTOR" }}
          >
            !
          </Badge>
          body
        </Panel>,
      ),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
