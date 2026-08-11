import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { useRevealedScience, useScienceCredit } from "./currency-events";
import { StubTransport } from "./stub-transport";

function CreditProbe({ guid }: { guid: string }) {
  const credit = useScienceCredit(guid);
  const text = credit
    ? `${credit.vesselName}/${credit.amount}/${credit.ut}`
    : "waiting";
  return <div>{`credit:${text}`}</div>;
}

function TotalProbe({ guids, viewUt }: { guids: string[]; viewUt: number }) {
  const { credits, revealedTotal } = useRevealedScience(guids, viewUt);
  return (
    <div>
      <div>{`total:${revealedTotal}`}</div>
      <div>{`count:${credits.length}`}</div>
      <div>{`ages:${credits.map((c) => c.ageSeconds).join("|")}`}</div>
    </div>
  );
}

const credit = (vesselId: string, amount: number, ut: number) => ({
  vesselId,
  vesselName: `Probe ${vesselId}`,
  amount,
  subjectId: "magScan@KerbinInSpaceHigh",
  subjectTitle: "Magnetometer Scan of Kerbin",
  ut,
});

describe("useScienceCredit", () => {
  it("reads bare fields off the raw dynamic currency.<guid>.science topic", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <CreditProbe guid="g1" />
      </TelemetryProvider>,
    );
    expect(screen.getByText("credit:waiting")).toBeTruthy();

    // A dynamic topic: like production, it cannot be unit-wrapped, so amount is
    // the bare number 7.8, not { magnitude: 7.8 }.
    act(() => {
      t.emit("currency.g1.science", credit("g1", 7.8, 120));
    });
    await waitFor(() =>
      expect(screen.getByText("credit:Probe g1/7.8/120")).toBeTruthy(),
    );
  });
});

describe("useRevealedScience", () => {
  it("sums only revealed credits and ages each against the view UT", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <TotalProbe guids={["near", "far"]} viewUt={500} />
      </TelemetryProvider>,
    );
    // Nothing revealed yet: the total is 0, NOT the game's true science total.
    // The delayed view starts from what this observer has actually been told.
    expect(screen.getByText("total:0")).toBeTruthy();

    act(() => {
      t.emit("currency.near.science", credit("near", 3, 480));
    });
    await waitFor(() => expect(screen.getByText("total:3")).toBeTruthy());

    act(() => {
      t.emit("currency.far.science", credit("far", 9, 200));
    });
    await waitFor(() => expect(screen.getByText("total:12")).toBeTruthy());

    // Newest-first, each aged by view UT minus the UT it actually happened at, so a
    // render can say how old the news is (far: 300s ago, near: 20s ago).
    expect(screen.getByText("ages:20|300")).toBeTruthy();
  });

  it("counts a credit once even when the same event is delivered again", async () => {
    // The reliable lane replays the sticky last value on every re-subscribe, so a
    // running total that did not de-dupe on (vesselId, ut) would inflate on any
    // remount or roster churn.
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <TotalProbe guids={["g1"]} viewUt={100} />
      </TelemetryProvider>,
    );

    act(() => {
      t.emit("currency.g1.science", credit("g1", 5, 50));
    });
    await waitFor(() => expect(screen.getByText("total:5")).toBeTruthy());

    act(() => {
      t.emit("currency.g1.science", credit("g1", 5, 50));
    });
    await waitFor(() => expect(screen.getByText("count:1")).toBeTruthy());
    expect(screen.getByText("total:5")).toBeTruthy();

    // A genuinely new credit from the same vessel (a different UT) does count.
    act(() => {
      t.emit("currency.g1.science", credit("g1", 2, 80));
    });
    await waitFor(() => expect(screen.getByText("total:7")).toBeTruthy());
  });

  it("exposes no pending or in-flight figure", () => {
    // Guards the design constraint: `pending` is derivable only as
    // (instant true total - revealed total), and surfacing it would tell the
    // operator that N science is inbound the moment it is earned, which is the
    // inference the delayed reveal exists to prevent.
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    let shape: Record<string, unknown> = {};
    function ShapeProbe() {
      shape = useRevealedScience([], 0) as unknown as Record<string, unknown>;
      return null;
    }
    render(
      <TelemetryProvider client={client}>
        <ShapeProbe />
      </TelemetryProvider>,
    );
    expect(Object.keys(shape).sort()).toEqual(["credits", "revealedTotal"]);
  });
});
