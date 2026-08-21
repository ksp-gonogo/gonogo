import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ContractManagerComponent } from "./index";

/**
 * Characterisation: what ContractManager DOES today when its telemetry reads
 * are `undefined`, recorded ahead of `useTelemetry` returning a `Reading`.
 *
 * Two reads carry the risk:
 * - `useTelemetry("career.status")?.contracts` feeds `parseContracts`, which
 *   maps `undefined` AND `null` to `null`, and the widget then branches on
 *   `active === null`
 * - `useStream<VesselState>("vessel.state")?.altitudeAsl ?? undefined` gates
 *   the altitude-band progress bar behind `typeof vAltitude === "number"`
 *
 * Every assertion below is an observation, not an endorsement.
 */

const CARRIED = ["career.status", "vessel.state"];

function newFixture() {
  return setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 0 });
}

function renderManager(
  fixture: StreamFixture,
  size?: { w: number; h: number },
) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "cm-char" }}>
        <ContractManagerComponent
          config={{}}
          id="cm-char"
          w={size?.w}
          h={size?.h}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

/** A ReachAltitudeEnvelope parameter: the one thing that reads vessel.state. */
const ALTITUDE_CONTRACT = {
  id: "7001",
  title: "Fly above 5000m",
  agency: "Kerbin Aviation",
  state: "Active",
  fundsCompletion: 0,
  scienceCompletion: 0,
  repCompletion: 0,
  deadlineUt: 0,
  parameters: [
    {
      title: "Altitude band",
      state: "Incomplete",
      stateOrdinal: 0,
      optional: false,
      parameterType: "ReachAltitudeEnvelope",
      minAltitude: 5000,
      maxAltitude: 10000,
    },
  ],
};

const ORBIT = {
  sma: 682500,
  ecc: 0.00367,
  inc: 0.3,
  argPe: 12.5,
  mu: 3.5316e12,
  meanAnomalyAtEpoch: 0,
  epoch: 10,
  referenceBodyIndex: 1,
};

/** Feed the derived `vessel.state` so `altitudeAsl` is a real number. */
function emitAltitude(fixture: StreamFixture, altitudeAsl: number) {
  fixture.emit("vessel.orbit", ORBIT, { quality: Quality.Loaded });
  fixture.emit(
    "vessel.flight",
    { altitudeAsl, verticalSpeed: 0, surfaceSpeed: 0, orbitalSpeed: 0 },
    { quality: Quality.Loaded },
  );
}

describe("ContractManager: nothing has arrived at all", () => {
  it("renders the awaiting placeholder and none of the loaded chrome", () => {
    renderManager(newFixture());

    // `parseContracts(undefined) === null` reaches the `active === null` gate.
    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();
    // The gate returns early, so the counts row and the empty-state copy that
    // a CONFIRMED-empty career would show are both absent. This is the one
    // place the widget today separates "waiting" from "there are none".
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/No active contracts/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept/i })).toBeNull();
  });

  it("renders NOTHING but the panel title in a short box, because the placeholder is itself gated on height", () => {
    // `showSubtitle` is `(h ?? 8) >= 4`, so at h=3 the awaiting branch has no
    // body at all: the widget is silent about waiting rather than empty.
    renderManager(newFixture(), { w: 5, h: 3 });

    expect(screen.getByText("CONTRACT MANAGER")).toBeInTheDocument();
    expect(screen.queryByText(/Awaiting contract telemetry/i)).toBeNull();
    expect(screen.queryByText(/No active contracts/i)).toBeNull();
  });
});

describe("ContractManager: the `active === null` absence gate", () => {
  it("fires for a never-arrived topic and does not fire for a confirmed-empty one", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();

    act(() => {
      fixture.emit("career.status", { contracts: { active: [] } });
    });

    // An empty array parses to `[]`, not `null`, so the gate stops firing and
    // the counts row plus the confident empty-state copy take over.
    await waitFor(() =>
      expect(screen.getByText(/No active contracts/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Awaiting contract telemetry/i)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "0 active · 0 offered · 0 recent",
    );
  });

  it("fires for a partial payload whose `contracts` field is null", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    act(() => {
      // The record arrived; the sub-tree the widget reads did not. Today this
      // is indistinguishable from nothing having arrived.
      fixture.emit("career.status", {
        economy: { funds: 1000, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No active contracts/i)).toBeNull();
  });
});

describe("ContractManager: null versus undefined", () => {
  it("does NOT distinguish a whole-topic tombstone from a topic that never arrived", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    act(() => {
      // A tombstone: the hook returns `null` here rather than `undefined`
      // (`getStreamSnapshot` hands back `point.payload`), so the widget CAN
      // see the difference. It does not: `null?.contracts` is `undefined`,
      // `parseContracts` maps both to `null`, and a confirmed "no career at
      // all" renders the same "waiting" copy as a cold start.
      fixture.emit("career.status", null);
    });

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("career.status")).toBe(true),
    );
    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();
  });
});

describe("ContractManager: partial payloads inside an arrived record", () => {
  it("counts absent `offered`/`completedRecent` sub-arrays as zero and hides their sections", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    act(() => {
      // Only `active` present. `offered?.length ?? 0` and
      // `recent?.length ?? 0` coerce two never-arrived arrays to a confident 0.
      fixture.emit("career.status", {
        contracts: { active: [ALTITUDE_CONTRACT] },
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Fly above 5000m")).toBeInTheDocument(),
    );
    expect(screen.getByRole("status").textContent).toBe(
      "1 active · 0 offered · 0 recent",
    );
    // The "Offered" section label is gated on that coerced 0, so it is absent.
    expect(screen.queryByText("Offered")).toBeNull();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders a deadline of `no deadline` when the contract's own deadline field is absent", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    act(() => {
      fixture.emit("career.status", {
        contracts: { active: [{ id: "7002", title: "Undated job" }] },
      });
    });

    // `magnitudeOf(undefined) ?? magnitudeOf(undefined) ?? 0` makes an absent
    // deadline a hard 0, which `formatDeadline` reads as "no deadline" rather
    // than as an unknown.
    await waitFor(() =>
      expect(screen.getByText("Undated job")).toBeInTheDocument(),
    );
    expect(visibleText()).toContain("no deadline");
  });
});

describe("ContractManager: the vessel.state altitude gate", () => {
  it("omits the altitude-band progress bar entirely while vessel.state has not arrived", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    act(() => {
      fixture.emit("career.status", {
        contracts: { active: [ALTITUDE_CONTRACT] },
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Altitude band")).toBeInTheDocument(),
    );
    // `typeof vAltitude === "number"` is the gate. With no vessel.state the
    // parameter row renders its title and nothing else: no bar, no band label,
    // no distance-to-band figure.
    expect(screen.queryByText("in band")).toBeNull();
    expect(visibleText()).not.toContain("in band");
    expect(visibleText()).not.toContain("−");
    expect(visibleText()).not.toContain("+");
  });

  it("renders the band label once vessel.state carries an altitude", async () => {
    const fixture = newFixture();
    renderManager(fixture);

    act(() => {
      fixture.emit("career.status", {
        contracts: { active: [ALTITUDE_CONTRACT] },
      });
      emitAltitude(fixture, 7000);
    });

    // The other side of the same gate, so the test above is proving an
    // absence rather than a permanently-missing feature.
    await waitFor(() =>
      expect(screen.getByText("in band")).toBeInTheDocument(),
    );
  });
});
