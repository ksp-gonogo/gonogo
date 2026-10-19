import "./chargeRate";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { countUnratedProcesses, netToneWithUnrated } from "./flow";
import { PowerTotals } from "./PowerTotals";

/** A process that draws a resource with no published rate leaves its draw out of NET, so a surplus is not claimed while one runs; a part that only stores never counts. */

const parts = [{ flightId: 1 }, { flightId: 2 }, { flightId: 3 }];
const solar = { amount: 0, maxAmount: 0, flow: 5, nominalFlow: 5 };
const battery = { amount: 50, maxAmount: 100 };
const drill = { amount: 0, maxAmount: 0, unratedProcess: true };

function live(
  rows: Array<Record<string, number | boolean>>,
): Map<number, { resources: Record<string, (typeof rows)[number]> }> {
  return new Map(
    rows.map((row, i) => [i + 1, { resources: { ElectricCharge: row } }]),
  );
}

describe("countUnratedProcesses", () => {
  it("never counts a part that only stores", () => {
    expect(
      countUnratedProcesses(parts, live([solar, battery]), "ElectricCharge"),
    ).toBe(0);
  });

  it("counts a marked part with no rate", () => {
    expect(
      countUnratedProcesses(
        parts,
        live([solar, battery, drill]),
        "ElectricCharge",
      ),
    ).toBe(1);
  });

  it("counts a marked part by its rate once the mod publishes one", () => {
    expect(
      countUnratedProcesses(
        parts,
        live([{ ...drill, flow: -3 }]),
        "ElectricCharge",
      ),
    ).toBe(0);
  });

  it("reads as today when the field is absent", () => {
    expect(countUnratedProcesses(parts, live([solar]), "ElectricCharge")).toBe(
      0,
    );
  });
});

describe("netToneWithUnrated", () => {
  it("keeps the surplus beside a battery and withholds it beside an unrated process", () => {
    expect(netToneWithUnrated(5, 0)).toBe("go");
    expect(netToneWithUnrated(5, 1)).toBe("neutral");
  });

  it("still shows a deficit while a process is unrated", () => {
    expect(netToneWithUnrated(-2, 1)).toBe("warn");
  });
});

describe("PowerTotals", () => {
  const props = {
    net: 5,
    drawUnknown: false,
    flowMeasured: true,
    netFigure: value("units/s", 5),
    netTone: "neutral" as const,
    totalProduced: 5,
    totalConsumed: 0,
    measuredTotalProduced: undefined,
    measuredDisagrees: false,
    storage: { amount: 0, maxAmount: 0 },
  };

  it("names the unrated processes beside NET", () => {
    render(<PowerTotals {...props} unratedCount={2} />);
    expect(screen.getByText("+2 unrated")).toBeTruthy();
  });

  it("names nothing when every draw is rated", () => {
    render(<PowerTotals {...props} unratedCount={0} />);
    expect(screen.queryByText(/unrated/)).toBeNull();
  });
});

describe("PowerTotals NET cell", () => {
  it("lets the figure wrap onto a second line so the unit is never cut off by the cell edge", () => {
    render(
      <PowerTotals
        net={-0.03}
        drawUnknown={false}
        flowMeasured
        netFigure={value("EC/s", -0.03)}
        netTone="warn"
        unratedCount={0}
        totalProduced={0}
        totalConsumed={0.03}
        measuredTotalProduced={undefined}
        measuredDisagrees={false}
        storage={{ amount: 0, maxAmount: 0 }}
      />,
    );
    const figure = screen.getByText("NET").nextElementSibling as HTMLElement;
    expect(figure.textContent).toContain("EC/s");
    expect(getComputedStyle(figure).whiteSpace).not.toBe("nowrap");
  });
});
