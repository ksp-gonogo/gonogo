/**
 * DOM-snapshot regression tests for the ContractManager widget.
 *
 * ContractManager's contract reads come off the `career.status` Topic's
 * `contracts` sub-tree now (canonical `useTelemetry`) and the altitude used for
 * altitude-band parameters comes off the derived `vessel.state.altitudeAsl`
 * (`useStream`), so the shared `snapshotWidgetMode` helper (which mounts no
 * `TelemetryProvider`) can never feed them. This file builds its own per-fixture
 * stream render instead: each fixture's flat `contracts.*` arrays are emitted
 * verbatim under `career.status.contracts` (parseContracts reads the same
 * shape), the view clock is pinned at the fixture's `t.universalTime`, and — when
 * the fixture carries `v.altitude` — a Loaded-basis `vessel.flight` supplies the
 * measured altitude the altitude bands read.
 *
 * If the widget output intentionally changes, regenerate with
 * `pnpm --filter @ksp-gonogo/components exec vitest run src/ContractManager/snapshots -u`.
 */
import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import activeMission from "./__fixtures__/active-mission-partial.json";
import allComplete from "./__fixtures__/all-complete-awaiting-recovery.json";
import awaiting from "./__fixtures__/awaiting-telemetry.json";
import mixedFailed from "./__fixtures__/mixed-failed-parameters.json";
import multipleActive from "./__fixtures__/multiple-active-contracts.json";
import noContracts from "./__fixtures__/no-contracts.json";
import { ContractManagerComponent } from "./index";

interface ContractFixture {
  "t.universalTime"?: number;
  "v.altitude"?: number;
  "contracts.active"?: unknown[];
  "contracts.offered"?: unknown[];
  "contracts.completedRecent"?: unknown[];
}

const FIXTURES: Record<string, ContractFixture> = {
  "awaiting-telemetry": awaiting,
  "no-contracts": noContracts,
  "active-mission-partial": activeMission,
  "all-complete-awaiting-recovery": allComplete,
  "mixed-failed-parameters": mixedFailed,
  "multiple-active-contracts": multipleActive,
};

// Minimal orbit so `deriveVesselState` produces a record; emitted in the Loaded
// basis (StubTransport defaults to OnRails, where altitudeAsl is null) alongside
// the vessel.flight altitude the widget's altitude bands read.
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

const config = getWidget("contract-manager");
if (!config) throw new Error("contract-manager missing from widgets.ts");

async function snapshotContractStream(
  fixture: ContractFixture,
  mode: {
    name: string;
    w: number;
    h: number;
    config?: Record<string, unknown>;
  },
): Promise<string> {
  const streamFixture = setupStreamFixture({
    carriedChannels: ["career.status", "vessel.state"],
    pinnedUt: fixture["t.universalTime"] ?? 0,
  });

  const { container } = render(
    <streamFixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
        <ContractManagerComponent
          config={mode.config ?? {}}
          id="snap"
          w={mode.w}
          h={mode.h}
        />
      </DashboardItemContext.Provider>
    </streamFixture.Provider>,
  );

  const hasContracts = fixture["contracts.active"] !== undefined;
  if (hasContracts) {
    act(() => {
      streamFixture.emit("career.status", {
        contracts: {
          active: fixture["contracts.active"] ?? [],
          offered: fixture["contracts.offered"] ?? [],
          completedRecent: fixture["contracts.completedRecent"] ?? [],
        },
      });
      if (typeof fixture["v.altitude"] === "number") {
        streamFixture.emit("vessel.orbit", ORBIT, { quality: Quality.Loaded });
        streamFixture.emit(
          "vessel.flight",
          {
            altitudeAsl: fixture["v.altitude"],
            verticalSpeed: 0,
            surfaceSpeed: 0,
            orbitalSpeed: 0,
          },
          { quality: Quality.Loaded },
        );
      }
    });

    await waitFor(() => {
      const point = streamFixture.store.sample(
        "career.status",
        streamFixture.store.currentFrame(),
      );
      if (point === undefined) {
        throw new Error("career.status has not resolved off the stream yet");
      }
    });
  }

  return stripVolatile(container.innerHTML);
}

describe("ContractManager DOM snapshots", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotContractStream(fixture, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
