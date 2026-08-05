import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";
import { useStatusSummary } from "./status/useStatusSummary";
import { axe } from "./test/axe";

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
    const { rerender } = render(<Badge severity="caution">C</Badge>);
    const cautionClass = screen.getByText("C").className;
    rerender(<Badge severity="critical">C</Badge>);
    expect(screen.getByText("C").className).not.toBe(cautionClass);
  });

  it("keeps a decorative badge (no severity) visually distinct from nominal", () => {
    // A neutral kind-chip must not turn nominal-green just because the scale
    // gained a floor. Decorative stays grey.
    const { rerender } = render(<Badge>KOS</Badge>);
    const decorativeClass = screen.getByText("KOS").className;
    rerender(<Badge severity="nominal">KOS</Badge>);
    expect(screen.getByText("KOS").className).not.toBe(decorativeClass);
  });
});

describe("Badge tone (deprecated alias) folds onto severity", () => {
  it("renders neutral tone as the decorative grey, not nominal", () => {
    const { rerender } = render(<Badge tone="neutral">N</Badge>);
    const neutralClass = screen.getByText("N").className;
    rerender(<Badge>N</Badge>);
    // neutral tone === no severity === decorative default.
    expect(screen.getByText("N").className).toBe(neutralClass);
  });

  it("maps a semantic tone to the matching severity look", () => {
    const { rerender } = render(<Badge tone="nogo">X</Badge>);
    const nogoClass = screen.getByText("X").className;
    rerender(<Badge severity="critical">X</Badge>);
    // nogo folds to critical, so they render identically.
    expect(screen.getByText("X").className).toBe(nogoClass);
  });
});

describe("Badge live-region behaviour", () => {
  it("announces when live", () => {
    render(
      <Badge severity="critical" live>
        ABORT
      </Badge>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("ABORT");
  });

  it("is not a live region by default (decorative badges stay silent)", () => {
    render(<Badge severity="info">NOTE</Badge>);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Badge report auto-registration", () => {
  it("registers into the nearest store and can win the panel summary", () => {
    render(
      <PanelStatusStoreProvider>
        <Badge severity="caution" report={{ id: "a" }}>
          SYNCING
        </Badge>
        <Badge severity="critical" report={{ id: "b" }}>
          ABORT
        </Badge>
        <SummaryProbe />
      </PanelStatusStoreProvider>,
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("critical:ABORT");
  });

  it("uses an explicit report label over the badge text", () => {
    render(
      <PanelStatusStoreProvider>
        <Badge severity="warning" report={{ id: "a", label: "LOW FUEL" }}>
          LF
        </Badge>
        <SummaryProbe />
      </PanelStatusStoreProvider>,
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("warning:LOW FUEL");
  });

  it("does NOT move the summary for a badge without report", () => {
    render(
      <PanelStatusStoreProvider>
        <Badge severity="critical">DECOR</Badge>
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
            <Badge severity="critical" report={{ id: "a" }}>
              ABORT
            </Badge>
          )}
          <SummaryProbe />
        </PanelStatusStoreProvider>
      );
    }
    const { rerender } = render(<Harness show />);
    expect(screen.getByTestId("summary")).toHaveTextContent("critical:ABORT");
    rerender(<Harness show={false} />);
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });

  it("is a no-op outside a store (a bare badge still renders)", () => {
    render(
      <Badge severity="critical" report={{ id: "a" }}>
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
        <Badge severity="info">NOTE</Badge>
        <Badge severity="critical" live>
          ABORT
        </Badge>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
