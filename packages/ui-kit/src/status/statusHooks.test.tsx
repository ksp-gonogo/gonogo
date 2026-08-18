import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "../testing-react";
import {
  PanelStatusStoreProvider,
  type StatusContribution,
} from "./PanelStatusStore";
import { useStatusBreakdown } from "./useStatusBreakdown";
import { useStatusContribution } from "./useStatusContribution";
import { useStatusSummary } from "./useStatusSummary";

function Reporter({ c }: { c: StatusContribution | null }) {
  useStatusContribution(c);
  return null;
}

function SummaryProbe() {
  const summary = useStatusSummary();
  return (
    <output data-testid="summary">
      {summary ? `${summary.severity}:${summary.label}` : "none"}
    </output>
  );
}

function withStore(children: ReactNode) {
  return <PanelStatusStoreProvider>{children}</PanelStatusStoreProvider>;
}

function BreakdownProbe() {
  const breakdown = useStatusBreakdown();
  return (
    <output data-testid="breakdown">
      {breakdown.length === 0
        ? "none"
        : breakdown.map((e) => `${e.severity}:${e.count}`).join(",")}
    </output>
  );
}

describe("useStatusBreakdown", () => {
  it("surfaces per-severity counts worst-first, never merged across tiers", () => {
    render(
      withStore(
        <>
          <Reporter c={{ id: "a", severity: "caution", label: "A" }} />
          <Reporter c={{ id: "b", severity: "caution", label: "B" }} />
          <Reporter c={{ id: "c", severity: "critical", label: "C" }} />
          <BreakdownProbe />
        </>,
      ),
    );
    // Two cautions stay one caution:2 row; critical leads (worst-first).
    expect(screen.getByTestId("breakdown")).toHaveTextContent(
      "critical:1,caution:2",
    );
  });

  it("drops a severity's row when its last contributor unmounts", () => {
    const { rerender } = render(
      withStore(
        <>
          <Reporter c={{ id: "a", severity: "warning", label: "A" }} />
          <Reporter c={{ id: "b", severity: "caution", label: "B" }} />
          <BreakdownProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("breakdown")).toHaveTextContent(
      "warning:1,caution:1",
    );
    rerender(
      withStore(
        <>
          <Reporter c={{ id: "a", severity: "warning", label: "A" }} />
          <BreakdownProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("breakdown")).toHaveTextContent("warning:1");
  });

  it("is empty with no store in the tree", () => {
    render(
      <>
        <Reporter c={{ id: "a", severity: "critical", label: "X" }} />
        <BreakdownProbe />
      </>,
    );
    expect(screen.getByTestId("breakdown")).toHaveTextContent("none");
  });
});

describe("useStatusContribution + useStatusSummary", () => {
  it("summarises the worst of the registered contributions", () => {
    render(
      withStore(
        <>
          <Reporter c={{ id: "a", severity: "caution", label: "SYNCING" }} />
          <Reporter c={{ id: "b", severity: "critical", label: "ABORT" }} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("critical:ABORT");
  });

  it("drops to the next-worst when the worst contributor unmounts", () => {
    const { rerender } = render(
      withStore(
        <>
          <Reporter c={{ id: "a", severity: "caution", label: "SYNCING" }} />
          <Reporter c={{ id: "b", severity: "critical", label: "ABORT" }} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("critical:ABORT");

    rerender(
      withStore(
        <>
          <Reporter c={{ id: "a", severity: "caution", label: "SYNCING" }} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("caution:SYNCING");
  });

  it("updates in place when a contribution's severity changes", () => {
    const { rerender } = render(
      withStore(
        <>
          <Reporter c={{ id: "a", severity: "caution", label: "SYNCING" }} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("caution:SYNCING");

    rerender(
      withStore(
        <>
          <Reporter c={{ id: "a", severity: "offline", label: "OFFLINE" }} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("offline:OFFLINE");
  });

  it("contributes nothing for a null contribution", () => {
    render(
      withStore(
        <>
          <Reporter c={null} />
          <SummaryProbe />
        </>,
      ),
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });

  it("is a no-op with no store in the tree: summary is null, no throw", () => {
    render(
      <>
        <Reporter c={{ id: "a", severity: "critical", label: "ABORT" }} />
        <SummaryProbe />
      </>,
    );
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });
});
