import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { badgeFace } from "./badgeFace";
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

function classOf(tone: "go" | "caution" | "warn"): string {
  const { unmount } = render(<Badge tone={tone}>REF</Badge>);
  const className = screen.getByText("REF").className;
  unmount();
  return className;
}

describe("a held Badge", () => {
  it("draws a nominal badge in the caution tone, keeping its words", () => {
    const caution = classOf("caution");
    render(
      <Badge tone="go" held="held">
        COMMS LINKED
      </Badge>,
    );
    expect(screen.getByText("COMMS LINKED").className).toBe(caution);
  });

  it("keeps a tone already at or past caution", () => {
    const warn = classOf("warn");
    render(
      <Badge tone="warn" held="held">
        LOW
      </Badge>,
    );
    expect(screen.getByText("LOW").className).toBe(warn);
  });

  it("carries the held square on the badge itself, and a current badge carries none", () => {
    const { rerender } = render(<Badge tone="go">DATA</Badge>);
    expect(
      screen.getByText("DATA").querySelector("[data-held-mark]"),
    ).toBeNull();

    rerender(
      <Badge tone="go" held="disconnected">
        DATA
      </Badge>,
    );
    expect(
      screen.getByText("DATA").querySelector("[data-held-mark]"),
    ).not.toBeNull();
  });

  it("says the grade after its words to a screen reader, and draws no grade pill", () => {
    render(
      <Badge tone="go" held="held">
        COMMS LINKED
      </Badge>,
    );
    expect(screen.getByText("COMMS LINKED")).toHaveTextContent(
      "COMMS LINKED, HELD",
    );
    expect(screen.queryByText("HELD")).toBeNull();
  });

  it("reports the caution tone to the panel summary", () => {
    render(
      <PanelStatusStoreProvider>
        <Badge tone="go" held="held" report={{ id: "link" }}>
          COMMS LINKED
        </Badge>
        <SummaryProbe />
      </PanelStatusStoreProvider>,
    );
    expect(screen.getByTestId("summary")).toHaveTextContent(
      "caution:COMMS LINKED",
    );
  });
});

describe("badgeFace for a held entry", () => {
  it("keeps the entry's label, moves a nominal tone to caution and carries the grade", () => {
    expect(
      badgeFace({
        id: "fleet-comms-link",
        label: "COMMS LINKED",
        tone: "go",
        held: "held",
      }),
    ).toEqual({
      label: "COMMS LINKED",
      tone: "caution",
      title: "COMMS LINKED: HELD",
      held: "held",
    });
  });

  it("leaves a current entry as it is", () => {
    expect(
      badgeFace({ id: "link", label: "NO COMMS LINK", tone: "nogo" }),
    ).toEqual({ label: "NO COMMS LINK", tone: "nogo", title: undefined });
  });
});
