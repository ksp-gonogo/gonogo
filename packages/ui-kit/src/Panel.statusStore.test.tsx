import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Panel } from "./Panel";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";

/** The panel's status announcer: an off-screen `aria-live` region, not a `status`. */
function announcer(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-live-region]");
}

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
    expect(announcer()).toHaveTextContent("LF CRITICAL");
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
    expect(announcer()).toHaveTextContent("LF CRITICAL");
    rerender(<Harness critical={false} />);
    expect(announcer()).toHaveTextContent("OX LOW");
  });

  it("folds the widget's own stream status into the same summary", () => {
    render(inStore(<Panel panelTitle="ORBIT" panelStatus="resyncing" />));
    expect(announcer()).toHaveTextContent("SYNCING");
  });

  it("lets a firing-style critical report outrank a merely stale stream", () => {
    render(
      inStore(
        <Panel panelTitle="DESCENT" panelStatus="held-stale">
          <Badge
            severity="critical"
            report={{ id: "alarm", label: "NO BURN VECTOR" }}
          >
            !
          </Badge>
        </Panel>,
      ),
    );
    // stream held-stale -> warning, the report -> critical, so the alarm wins.
    expect(announcer()).toHaveTextContent("NO BURN VECTOR");
  });

  it("shows nothing when a store is present but empty and the stream is live", () => {
    render(inStore(<Panel panelTitle="ORBIT" panelStatus="live" />));
    expect(announcer()).toBeEmptyDOMElement();
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
    expect(announcer()).toHaveTextContent("caution");
    // A severity change updates the summary (and drives the one-shot pulse) with
    // no throw and no stale reading.
    rerender(<Harness severity="offline" />);
    expect(announcer()).toHaveTextContent("offline");
  });

  it("keeps the same live region across a severity change, so the change is announced", () => {
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
    const before = announcer();
    rerender(<Harness severity="offline" />);
    expect(announcer()).toBe(before);
  });

  it("announces the first report in a region that was mounted, empty, before it", () => {
    function Harness({ firing }: { firing: boolean }) {
      return inStore(
        <Panel panelTitle="DESCENT">
          {firing && (
            <Badge
              severity="critical"
              report={{ id: "alarm", label: "NO BURN VECTOR" }}
            >
              !
            </Badge>
          )}
        </Panel>,
      );
    }
    const { rerender } = render(<Harness firing={false} />);
    const region = announcer();
    expect(region).toBeEmptyDOMElement();
    rerender(<Harness firing />);
    expect(announcer()).toBe(region);
    expect(region).toHaveTextContent("DESCENT: NO BURN VECTOR");
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
    await expectNoA11yViolations(container);
  });
});
