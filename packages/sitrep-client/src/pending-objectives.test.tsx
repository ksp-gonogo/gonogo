import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import {
  type PendingObjectiveRow,
  unsettledObjectiveRows,
  usePendingObjectiveRows,
} from "./pending-objectives";
import { StubTransport } from "./stub-transport";

const row = (
  overrides: Partial<PendingObjectiveRow> = {},
): PendingObjectiveRow => ({
  key: "c1/0/Met@100",
  contractId: "77",
  contractTitle: "Orbit the Mun",
  objective: "Enter orbit",
  objectivePath: "0",
  target: "Met",
  vesselId: "probe",
  vesselName: "Mun Probe",
  ut: 100,
  homeArrivesUt: 130,
  ...overrides,
});

describe("unsettledObjectiveRows", () => {
  it("shows nothing at the home command, which learns of a change only when it applies it", () => {
    expect(unsettledObjectiveRows([row()], [], true)).toEqual([]);
  });

  it("keeps a row until home's settled list names its key", () => {
    expect(unsettledObjectiveRows([row()], undefined, false)).toEqual([row()]);
    expect(
      unsettledObjectiveRows(
        [row()],
        [{ key: "c1/0/Met@100", outcome: "Applied", ut: 130 }],
        false,
      ),
    ).toEqual([]);
  });

  it("drops a row home settled by dropping it, the same as one it applied", () => {
    expect(
      unsettledObjectiveRows(
        [row()],
        [{ key: "c1/0/Met@100", outcome: "Dropped", ut: 130 }],
        false,
      ),
    ).toEqual([]);
  });

  it("keeps only the newest change per objective", () => {
    const later = row({ key: "c1/0/Unmet@110", target: "Unmet", ut: 110 });
    expect(unsettledObjectiveRows([row(), later], [], false)).toEqual([later]);
  });

  it("keeps changes to different objectives side by side, oldest first", () => {
    const other = row({
      key: "c1/1/Failed@90",
      objectivePath: "1",
      target: "Failed",
      ut: 90,
    });
    expect(unsettledObjectiveRows([row(), other], [], false)).toEqual([
      other,
      row(),
    ]);
  });

  it("ignores a malformed settled list rather than hiding every row", () => {
    expect(unsettledObjectiveRows([row()], "nonsense", false)).toEqual([row()]);
    expect(unsettledObjectiveRows([row()], [null, { key: 3 }], false)).toEqual([
      row(),
    ]);
  });
});

function RowsProbe({ guids }: { guids: string[] }) {
  const rows = usePendingObjectiveRows(guids);
  return (
    <div>{`rows:${rows.map((r) => `${r.vesselName}/${r.target}`).join("|")}`}</div>
  );
}

describe("usePendingObjectiveRows", () => {
  it("collects each vessel's rows once, off its own dynamic topic", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <RowsProbe guids={["probe", "lander"]} />
      </TelemetryProvider>,
    );
    expect(screen.getByText("rows:")).toBeTruthy();

    act(() => {
      t.emit("career.objectives.probe.pending", row());
      t.emit("career.objectives.probe.pending", row());
      t.emit(
        "career.objectives.lander.pending",
        row({
          key: "c2/0/Failed@120",
          vesselId: "lander",
          vesselName: "Lander",
          target: "Failed",
          ut: 120,
        }),
      );
      t.emit("career.objectives.lander.pending", { key: "bad" });
    });
    await waitFor(() =>
      expect(screen.getByText("rows:Mun Probe/Met|Lander/Failed")).toBeTruthy(),
    );
  });
});
