import { type Reading, value } from "@ksp-gonogo/sitrep-sdk";
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
/** The same dose, contributed as a reading whose model will bound it. */
const BANDED_DOSE = {
  ...DOSE,
  value: {
    state: "observed",
    reckoning: "available",
    value: 0.4,
    atUt: value("ut", 9_000),
    reckoned: {
      value: 0.4,
      atUt: value("ut", 9_000),
      basis: "linear-dead-reckoning",
      modelled: [{ path: "", basis: "linear-dead-reckoning" }],
      owner: "core",
      bands: {
        "": {
          value: value("ratio", 0.4),
          lo: value("ratio", 0.34),
          hi: value("ratio", 0.46),
          kind: "sigma1",
        },
      },
    },
  } satisfies Reading<number>,
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

  it("carries a contributed reading's band through to the marks on the track", () => {
    // The contributor hands over the reading it holds and nothing else: no
    // band lookup, no path, no unit. Everything drawn below is the primitive's
    // decision, which is what keeps one Uplink's meters looking like another's.
    const { container } = render(
      <WithMeters entries={[BANDED_DOSE]}>
        <WidgetMeters row="Jebediah Kerman" />
      </WithMeters>,
    );

    const marks = container.querySelectorAll<HTMLElement>("[data-bound]");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveStyle({ left: "34%" });
    expect(marks[1]).toHaveStyle({ left: "46%" });
  });
});
