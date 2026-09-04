import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import { Staleness } from "@ksp-gonogo/sitrep-sdk";
import { installDomStubs } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { Panel, PanelStatusStoreProvider } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  useWidgetStreamStatus,
  WidgetStreamStatusBridge,
} from "./useWidgetStreamStatus";

beforeAll(() => installDomStubs());

function Host({
  children,
  transport,
}: {
  children: ReactNode;
  transport: StubTransport;
}) {
  const client = new TelemetryClient(transport);
  return (
    <TelemetryProvider
      client={client}
      carriedChannels={["vessel.orbit", "vessel.flight"]}
    >
      {children}
    </TelemetryProvider>
  );
}

/**
 * Stands in for the widget's own read of the channel it declared.
 *
 * Load-bearing, not scaffolding: `useWidgetStreamStatus` deliberately does not
 * subscribe, so an unread topic delivers nothing and reads `resyncing`, which
 * is not a blackout grade. A test whose probe only declared would therefore
 * pass by never seeing anything, which is the shape of a fixture that agrees
 * with the bug.
 */
function Reads({ topic }: { topic: string }) {
  useStream(topic);
  return null;
}

function Probe({ topics }: { topics: readonly string[] }) {
  const status = useWidgetStreamStatus({ channels: topics });
  return (
    <>
      {topics.map((topic) => (
        <Reads key={topic} topic={topic} />
      ))}
      <div>status:{status ?? "none"}</div>
    </>
  );
}

/**
 * The blackout grades were visible in exactly one place in the whole tree,
 * because the panel's stream badge is opt-in through `panelStatus` and no
 * widget passed it. Three separate doc comments already described the
 * automatic derivation as if it existed (`panelStatus`'s own, the badge's, and
 * `widgetDeclaredTopics`'s "the stream-status badge derived from this"); the
 * hook they all named did not.
 */
describe("useWidgetStreamStatus", () => {
  it("reports nothing while every declared channel is live", async () => {
    const transport = new StubTransport();
    render(
      <Host transport={transport}>
        <Probe topics={["vessel.orbit"]} />
      </Host>,
    );
    act(() => {
      transport.emit("vessel.orbit", { sma: 680_000 });
    });
    await waitFor(() => expect(screen.getByText("status:none")).toBeTruthy());
  });

  it("reports a replayed channel as recorded", async () => {
    const transport = new StubTransport();
    render(
      <Host transport={transport}>
        <Probe topics={["vessel.orbit"]} />
      </Host>,
    );
    act(() => {
      transport.emit(
        "vessel.orbit",
        { sma: 680_000 },
        { staleness: Staleness.Recorded },
      );
    });
    await waitFor(() =>
      expect(screen.getByText("status:recorded")).toBeTruthy(),
    );
  });

  /**
   * The narrow claim this derivation rests on. `Panel`'s own comment refuses a
   * worst-of summary across a widget's channels, and is right to: `absent`
   * means opposite things per topic, and a `held-stale` heartbeat miss is one
   * channel's own. The two blackout grades are not like that. The blackout
   * authority is per SUBJECT (`ChannelEngine.SetSubjectConnected` marks the
   * node, `Courier.ReplayRecorded` stamps every topic of the dump), so if one
   * of a widget's channels is recorded, the craft was dark, and saying so for
   * the widget is not a lossy summary but the same fact restated.
   */
  it("stays silent for the grades that are one channel's own", async () => {
    const transport = new StubTransport();
    render(
      <Host transport={transport}>
        <Probe topics={["vessel.orbit"]} />
      </Host>,
    );
    act(() => {
      transport.emit(
        "vessel.orbit",
        { sma: 680_000 },
        { staleness: Staleness.HeldStale },
      );
    });
    await waitFor(() => expect(screen.getByText("status:none")).toBeTruthy());
  });

  it("takes the worse grade when two declared channels disagree", async () => {
    const transport = new StubTransport();
    render(
      <Host transport={transport}>
        <Probe topics={["vessel.orbit", "vessel.flight"]} />
      </Host>,
    );
    act(() => {
      transport.emit(
        "vessel.orbit",
        { sma: 680_000 },
        { staleness: Staleness.Recorded },
      );
      transport.emit(
        "vessel.flight",
        { altitudeAsl: 1000 },
        { staleness: Staleness.LastBeforeBlackout },
      );
    });
    await waitFor(() =>
      expect(screen.getByText("status:last-before-blackout")).toBeTruthy(),
    );
  });

  it("reports nothing with no telemetry provider mounted", () => {
    render(<Probe topics={["vessel.orbit"]} />);
    expect(screen.getByText("status:none")).toBeTruthy();
  });
});

describe("WidgetStreamStatusBridge", () => {
  it("puts the badge in a panel's header with the widget wiring nothing", async () => {
    const transport = new StubTransport();
    render(
      <Host transport={transport}>
        <PanelStatusStoreProvider>
          <Reads topic="vessel.orbit" />
          <WidgetStreamStatusBridge def={{ channels: ["vessel.orbit"] }} />
          <Panel panelTitle="ORBIT">body</Panel>
        </PanelStatusStoreProvider>
      </Host>,
    );

    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      transport.emit(
        "vessel.orbit",
        { sma: 680_000 },
        { staleness: Staleness.Recorded },
      );
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("RECORDED"),
    );
  });
});
