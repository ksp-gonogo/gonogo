import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ContributionsPanelStore } from "./contributionsRead";
import { WidgetMetaContext } from "./WidgetMetaContext";
import { WidgetMeters } from "./WidgetMeters";

/**
 * Feeds the per-widget contribution store directly, which is what the per-frame
 * aggregation writes into. Going through the aggregation would mean standing up
 * a telemetry client to test a renderer.
 */
function WithMeters({
  entries,
  children,
}: {
  entries: readonly unknown[];
  children: ReactNode;
}) {
  return (
    <WidgetMetaContext.Provider
      value={{ componentId: "crew-status", contributionSlots: [] }}
    >
      <ContributionsPanelStore.Provider>
        <Seed entries={entries}>{children}</Seed>
      </ContributionsPanelStore.Provider>
    </WidgetMetaContext.Provider>
  );
}

function Seed({
  entries,
  children,
}: {
  entries: readonly unknown[];
  children: ReactNode;
}) {
  const store = ContributionsPanelStore.useStore();
  if (store && store.getSnapshot().length === 0) {
    store.register({ id: "crew-status.meters", entries });
  }
  return <>{children}</>;
}

const DOSE = {
  id: "Jeb:radiation",
  label: "Radiation dose",
  value: 0.4,
  tone: "warn" as const,
  valueLabel: "40%",
  row: "Jebediah Kerman",
};
const STRESS = {
  id: "Bill:stress",
  label: "Stress",
  value: 0.1,
  tone: "go" as const,
  valueLabel: "10%",
  row: "Bill Kerman",
};
const VESSEL_WIDE = {
  id: "shielding",
  label: "Shielding",
  value: 0.8,
  valueLabel: "80%",
};

describe("WidgetMeters", () => {
  it("draws a contributed meter through the kit's own Meter", () => {
    render(
      <WithMeters entries={[DOSE]}>
        <WidgetMeters row="Jebediah Kerman" />
      </WithMeters>,
    );

    // `Meter` reports 0..100 on the ARIA scale and speaks the entry's own
    // `valueLabel`, so a contribution's 0..1 fraction lands as the kit's own
    // meter semantics rather than as a second convention beside them.
    const meter = screen.getByRole("meter", { name: "Radiation dose" });
    expect(meter).toHaveAttribute("aria-valuenow", "40");
    expect(meter).toHaveAttribute("aria-valuetext", "40%");
  });

  it("puts each meter beside the row it names, and no other", () => {
    render(
      <WithMeters entries={[DOSE, STRESS]}>
        <div data-testid="jeb">
          <WidgetMeters row="Jebediah Kerman" />
        </div>
      </WithMeters>,
    );

    const jeb = screen.getByTestId("jeb");
    expect(jeb.textContent).toContain("Radiation dose");
    expect(jeb.textContent).not.toContain("Stress");
  });

  it("keeps a row-addressed meter OUT of a whole-widget stack", () => {
    // Otherwise a host that forgot to name a row would silently pool every
    // kerbal's meters into the body, attributed to nobody.
    render(
      <WithMeters entries={[DOSE, VESSEL_WIDE]}>
        <WidgetMeters />
      </WithMeters>,
    );

    expect(
      screen.getByRole("meter", { name: "Shielding" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("meter", { name: "Radiation dose" })).toBeNull();
  });

  it("renders no DOM at all when nothing is contributed for the row", () => {
    const { container } = render(
      <WithMeters entries={[STRESS]}>
        <WidgetMeters row="Jebediah Kerman" style={{ paddingLeft: "12px" }} />
      </WithMeters>,
    );

    // Not an empty stack carrying the host's indent: nothing.
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing outside a widget context, same as any segment slot", () => {
    const { container } = render(<WidgetMeters row="Jebediah Kerman" />);
    expect(container.innerHTML).toBe("");
  });
});
