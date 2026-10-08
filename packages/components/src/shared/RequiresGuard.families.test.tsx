import {
  clearRegistry,
  type DataSourceStatus,
  registerDataSource,
} from "@ksp-gonogo/core";
import { UnlockKind } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { RequiresGuard, type RequiresGuardProps } from "./RequiresGuard";

const FLIGHT_CONTROL = {
  kind: UnlockKind.Tech,
  id: "flightControl",
  name: "Flight Control",
  scienceCost: 45,
};

const LOCKED = {
  outcome: 1,
  errorCode: "notUnlocked",
  detail: "",
  missing: [FLIGHT_CONTROL],
};

function connectHost(status: DataSourceStatus) {
  registerDataSource({
    id: "sitrep",
    name: "Sitrep Stream",
    status,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    configSchema: () => [],
    getConfig: () => ({}),
    configure: () => {},
    onStatusChange: () => () => {},
  });
}

function roster(state: number, detail: string, ownedPrefixes: string[]) {
  return {
    uplinks: [
      {
        id: "fleetmod",
        version: "1.0.0",
        available: true,
        reason: null,
        ownedPrefixes,
        health: { state, detail },
      },
    ],
  };
}

/**
 * With `control`, a second guard on a plain required channel shares the stream,
 * so its refusal proves the roster arrived when the guard under test stays put.
 */
function renderGuard(
  props: Omit<RequiresGuardProps, "children">,
  control?: string,
) {
  const fixture = setupStreamFixture();
  const view = render(
    <fixture.Provider>
      <RequiresGuard title="Fleet Roster" {...props}>
        <p>widget content</p>
      </RequiresGuard>
      {control && (
        <RequiresGuard title="Control" channels={[control]}>
          <p>control content</p>
        </RequiresGuard>
      )}
    </fixture.Provider>,
  );
  return { fixture, ...view };
}

function lockChannel(
  fixture: ReturnType<typeof setupStreamFixture>,
  topic: string,
) {
  act(() => {
    fixture.emit("system.uplink.gates", {
      gates: [],
      channels: [{ topic, verdict: LOCKED }],
    });
  });
}

afterEach(() => clearRegistry());

describe("RequiresGuard: families and config channels", () => {
  describe("a missing telemetry host", () => {
    it.each([
      ["a required family", { families: ["fleet.<vessel>.contact"] }],
      [
        "an optional family",
        { optionalFamilies: ["vessel.partActions.<flightId>"] },
      ],
      ["a config channel", { configChannels: ["vessel.flight"] }],
    ] as const)("replaces a widget that declares only %s", async (_, props) => {
      connectHost("disconnected");
      const { container } = renderGuard(props);
      expect(screen.getByText("No telemetry host")).toBeInTheDocument();
      expect(screen.queryByText("widget content")).not.toBeInTheDocument();
      await expectNoA11yViolations(container);
    });

    it("leaves a widget that declares nothing alone", () => {
      connectHost("disconnected");
      renderGuard({ families: [], optionalFamilies: [], configChannels: [] });
      expect(screen.getByText("widget content")).toBeInTheDocument();
    });
  });

  describe("lock claims", () => {
    it("locks the widget when a gate entry covers a required family's prefix", () => {
      connectHost("connected");
      const { fixture } = renderGuard({ families: ["fleet.<vessel>.contact"] });
      expect(screen.getByText("widget content")).toBeInTheDocument();
      lockChannel(fixture, "fleet.");
      expect(screen.queryByText("widget content")).toBeNull();
      expect(screen.getByText("Missing tech: Flight Control")).toBeTruthy();
    });

    it("does not claim a family that starts with a placeholder", () => {
      connectHost("connected");
      const { fixture } = renderGuard({ families: ["<domain>.available"] });
      lockChannel(fixture, "fleet.");
      expect(screen.getByText("widget content")).toBeInTheDocument();
    });

    it("does not claim an optional family at mount", () => {
      connectHost("connected");
      const { fixture } = renderGuard({
        optionalFamilies: ["vessel.partActions.<flightId>"],
      });
      lockChannel(fixture, "vessel.");
      expect(screen.getByText("widget content")).toBeInTheDocument();
    });

    it("locks the widget on a config channel its body never reads", () => {
      connectHost("connected");
      const { fixture } = renderGuard({ configChannels: ["executor.state"] });
      lockChannel(fixture, "executor.");
      expect(screen.queryByText("widget content")).toBeNull();
      expect(screen.getByText("Missing tech: Flight Control")).toBeTruthy();
    });
  });

  describe("Uplink health", () => {
    it("replaces the widget when the Uplink owning a required family's prefix is unavailable", async () => {
      connectHost("connected");
      const { fixture } = renderGuard({ families: ["fleet.<vessel>.contact"] });
      act(() => {
        fixture.emit(
          "system.uplinks",
          roster(2, "fleet link down", ["fleet."]),
        );
      });
      expect(await screen.findByText("fleet link down")).toBeInTheDocument();
      expect(screen.queryByText("widget content")).toBeNull();
    });

    it("never replaces the widget for an unhealthy owner of an optional family or a config channel", async () => {
      connectHost("connected");
      const { fixture } = renderGuard(
        {
          optionalFamilies: ["vessel.partActions.<flightId>"],
          configChannels: ["demo.gauge.1"],
        },
        "demo.gauge.2",
      );
      act(() => {
        fixture.emit(
          "system.uplinks",
          roster(2, "owner down", ["vessel.partActions.", "demo."]),
        );
      });
      expect(await screen.findByText("owner down")).toBeInTheDocument();
      expect(screen.getByText("widget content")).toBeInTheDocument();
    });

    it("passes a required family with no owning Uplink through", async () => {
      connectHost("connected");
      const { fixture } = renderGuard(
        { families: ["fleet.<vessel>.contact"] },
        "demo.gauge.2",
      );
      act(() => {
        fixture.emit("system.uplinks", roster(2, "other down", ["demo."]));
      });
      expect(await screen.findByText("other down")).toBeInTheDocument();
      expect(screen.getByText("widget content")).toBeInTheDocument();
    });
  });
});
