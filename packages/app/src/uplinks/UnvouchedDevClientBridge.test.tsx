import { render, screen } from "@ksp-gonogo/test-utils";
import { PanelStatusStoreProvider, useStatusSummary } from "@ksp-gonogo/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetUplinkOutcomes, setUplinkOutcome } from "./loaderState";
import { UnvouchedDevClientBridge } from "./UnvouchedDevClientBridge";

function SummaryProbe() {
  const summary = useStatusSummary();
  return (
    <output data-testid="summary">
      {summary ? `${summary.severity}:${summary.label}` : "none"}
    </output>
  );
}

const panelFor = (ownerId: string | undefined) =>
  render(
    <PanelStatusStoreProvider>
      <UnvouchedDevClientBridge ownerId={ownerId} />
      <SummaryProbe />
    </PanelStatusStoreProvider>,
  );

// Before each test and not after, so the store is never cleared into a tree that is still mounted.
beforeEach(() => {
  __resetUplinkOutcomes();
});

describe("UnvouchedDevClientBridge", () => {
  it("says so on the panel of a widget whose Uplink loaded an unvouched development client", () => {
    setUplinkOutcome({
      id: "widget-y",
      name: "Widget Y",
      status: "loaded",
      unvouchedDevClient: true,
    });
    panelFor("widget-y");
    expect(screen.getByTestId("summary")).toHaveTextContent(
      "warn:Unvouched development client",
    );
  });

  it("says nothing for a widget whose Uplink loaded a vouched client", () => {
    setUplinkOutcome({ id: "widget-y", name: "Widget Y", status: "loaded" });
    panelFor("widget-y");
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });

  it.each([
    ["another Uplink's widget", "widget-z"],
    ["a widget with no owner", undefined],
  ])("says nothing for %s", (_what, ownerId) => {
    setUplinkOutcome({
      id: "widget-y",
      name: "Widget Y",
      status: "loaded",
      unvouchedDevClient: true,
    });
    panelFor(ownerId);
    expect(screen.getByTestId("summary")).toHaveTextContent("none");
  });
});
