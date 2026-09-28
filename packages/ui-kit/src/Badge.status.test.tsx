import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";
import { useStatusSummary } from "./status/useStatusSummary";

function SummaryProbe() {
  const summary = useStatusSummary();
  return (
    <output data-testid="summary">
      {summary ? `${summary.severity}:${summary.label}` : "none"}
    </output>
  );
}

describe("Badge severity vocabulary", () => {
  it("paints different severities with different classes", () => {
    const { rerender } = render(<Badge tone="caution">C</Badge>);
    const cautionClass = screen.getByText("C").className;
    rerender(<Badge tone="nogo">C</Badge>);
    expect(screen.getByText("C").className).not.toBe(cautionClass);
  });

  it("keeps a decorative badge (no severity) visually distinct from nominal", () => {
    // A neutral kind-chip stays grey, never nominal green.
    const { rerender } = render(<Badge>KOS</Badge>);
    const decorativeClass = screen.getByText("KOS").className;
    rerender(<Badge tone="go">KOS</Badge>);
    expect(screen.getByText("KOS").className).not.toBe(decorativeClass);
  });
});

describe("Badge live-region behaviour", () => {
  it("announces when live", () => {
    render(
      <Badge tone="nogo" live>
        ABORT
      </Badge>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("ABORT");
  });

  it("is not a live region by default (decorative badges stay silent)", () => {
    render(<Badge tone="info">NOTE</Badge>);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Badge report auto-registration", () => {
  it("registers into the nearest store and can win the panel summary", () => {
    render(
      <PanelStatusStoreProvider>
        <Badge tone="caution" report={{ id: "a" }}>
          SYNCING
        </Badge>
        <Badge tone="nogo" report={{ id: "b" }}>
          ABORT
        </Badge>
        <SummaryProbe />
      </PanelStatusStoreProvider>,
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("nogo:ABORT");
  });

  it("uses an explicit report label over the badge text", () => {
    render(
      <PanelStatusStoreProvider>
        <Badge tone="warn" report={{ id: "a", label: "LOW FUEL" }}>
          LF
        </Badge>
        <SummaryProbe />
      </PanelStatusStoreProvider>,
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("warn:LOW FUEL");
  });

  it("does NOT move the summary for a badge without report", () => {
    render(
      <PanelStatusStoreProvider>
        <Badge tone="nogo">DECOR</Badge>
        <SummaryProbe />
      </PanelStatusStoreProvider>,
    );
    // A decorative badge full of kind-chips must not drown the real status.
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });

  it("deregisters on unmount, dropping the summary", () => {
    function Harness({ show }: { show: boolean }) {
      return (
        <PanelStatusStoreProvider>
          {show && (
            <Badge tone="nogo" report={{ id: "a" }}>
              ABORT
            </Badge>
          )}
          <SummaryProbe />
        </PanelStatusStoreProvider>
      );
    }
    const { rerender } = render(<Harness show />);
    expect(screen.getByTestId("summary")).toHaveTextContent("nogo:ABORT");
    rerender(<Harness show={false} />);
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });

  it("is a no-op outside a store (a bare badge still renders)", () => {
    render(
      <Badge tone="nogo" report={{ id: "a" }}>
        ABORT
      </Badge>,
    );
    expect(screen.getByText("ABORT")).toBeInTheDocument();
  });
});

describe("Badge accessibility", () => {
  it("has no axe violations decorative or live", async () => {
    const { container } = render(
      <div>
        <Badge tone="info">NOTE</Badge>
        <Badge tone="nogo" live>
          ABORT
        </Badge>
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
