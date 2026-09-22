import { memoryStorage } from "@ksp-gonogo/core/test";
import {
  StubTransport,
  setActiveTelemetryClientForTests,
  setActiveTimelineStoreForTests,
  setActiveViewClockForTests,
  TelemetryClient,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  defineUplinkClient,
  type UplinkAlarmRequest,
  type UplinkClientHandle,
  useAlarmRequest,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerMessage } from "../peer/protocol";
import { AlarmHostService } from "./AlarmHostService";
import { AlarmPeerBridge } from "./AlarmPeerBridge";
import { AlarmsLauncherBridge } from "./AlarmsLauncherBridge";
import type { AlarmSnapshot } from "./types";

/**
 * An Uplink asks for an alarm, and the APP creates and owns the result.
 *
 * ## What is real here
 *
 * Everything on the path is production code, and that is the point of the file
 * rather than a nicety: the widget imports `useAlarmRequest` from the PUBLISHED
 * `@ksp-gonogo/sitrep-sdk` barrel, exactly as a third-party Uplink would, and
 * the call resolves through the app's injected host (installed for every app
 * test by `src/test/setup.ts`) into the app's own `AlarmsLauncherBridge` and
 * `AlarmHostService`. Nothing between the button and the alarm list is a
 * double.
 *
 * That matters because the failure this feature exists to avoid is a surface
 * that typechecks and then reaches nothing. An Uplink arming `alarm.scet.arm`
 * for itself compiles, dispatches, and is disarmed a frame later by the app's
 * own reconcile, with no error anywhere. A test that stubbed the host would
 * report the same clean result for a request that reached nothing at all.
 *
 * The instrument is checked rather than assumed: `"records nothing when the
 * bridge is absent"` is the planted control. It renders the SAME widget with
 * the alarm surface deliberately unmounted and asserts the list stays empty, so
 * a harness that has quietly stopped driving the button reports a failure here
 * instead of reporting every other test in the file as passing.
 */

/*
 * Real handles through the real `defineUplinkClient`, the same call every
 * Uplink client makes, rather than an object shaped like one. The handle is
 * where the provenance comes from, so a stand-in would be asserting against
 * values this file invented.
 */
const UPLINK: UplinkClientHandle = defineUplinkClient({
  id: "test-uplink",
  version: "0.0.0-test",
  name: "Test Uplink",
});

const SECOND_UPLINK: UplinkClientHandle = defineUplinkClient({
  id: "other-uplink",
  version: "0.0.0-test",
  name: "Other Uplink",
});

/** How the peer host hands an `alarm-add` to whoever subscribed for one. */
type AlarmAddDelivery = (
  peerId: string,
  msg: Extract<PeerMessage, { type: "alarm-add" }>,
) => void;

/**
 * A widget as an Uplink author writes one: the published hook, a button, and
 * no knowledge of alarms beyond the request it makes.
 */
function RequestingWidget({
  owner = UPLINK,
  request,
  label = "Set alarm",
}: {
  owner?: UplinkClientHandle;
  request: UplinkAlarmRequest;
  label?: string;
}) {
  const requestAlarm = useAlarmRequest(owner);
  return (
    <button type="button" onClick={() => requestAlarm(request)}>
      {label}
    </button>
  );
}

/**
 * The stream seams `AlarmHostService` reads through. It needs a live clock and
 * store to tick at all; nothing in this file asserts on telemetry.
 */
function installStream(): void {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
  client.attachStore(store);
  setActiveTimelineStoreForTests(store);
  setActiveTelemetryClientForTests(client);
  setActiveViewClockForTests({ viewUt: () => 1000 });
}

describe("an Uplink's alarm request", () => {
  let host: AlarmHostService;

  beforeEach(() => {
    installStream();
    host = new AlarmHostService(null, {
      nowMs: () => 1_700_000_000_000,
      tickIntervalMs: 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => 0,
    });
  });

  afterEach(() => {
    host.dispose();
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
  });

  /** The main screen's wiring: the bridge's `onAdd` IS the host's `addAlarm`. */
  function mountMainScreen(widget: React.ReactNode) {
    const useSnapshot = (): AlarmSnapshot => host.snapshot();
    return render(
      <ModalProvider>
        <AlarmsLauncherBridge
          useSnapshot={useSnapshot}
          onAdd={(input) => {
            host.addAlarm(input);
          }}
          onUpdate={(id, patch) => host.updateAlarm(id, patch)}
          onDelete={(id) => host.deleteAlarm(id)}
        >
          {widget}
        </AlarmsLauncherBridge>
      </ModalProvider>,
    );
  }

  it("creates an alarm the app owns, carrying who asked for it", async () => {
    mountMainScreen(
      <RequestingWidget
        request={{
          key: "facility-upgrade:LaunchPad",
          name: "Launch pad upgrade complete",
          trigger: { kind: "time", ut: 9000 },
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Set alarm" }));

    const alarms = host.snapshot().alarms;
    expect(alarms).toHaveLength(1);
    expect(alarms[0].name).toBe("Launch pad upgrade complete");
    expect(alarms[0].trigger).toMatchObject({ kind: "time", ut: 9000 });
    expect(alarms[0].requestedBy).toEqual({
      uplinkId: "test-uplink",
      uplinkName: "Test Uplink",
      key: "facility-upgrade:LaunchPad",
    });
    // The app's own, not a foreign arm: `createdBy` is the screen that made it,
    // which is what lets `ScetAlarmBridge.reconcile` account for the row.
    expect(alarms[0].createdBy).toBe("main");
  });

  it("records nothing when the bridge is absent", async () => {
    // The planted control. Same widget, same click, no alarm surface mounted:
    // if this ever passes by producing an alarm, or if the button stops being
    // clickable, every other assertion in this file is measuring nothing.
    render(
      <ModalProvider>
        <RequestingWidget
          request={{
            key: "control",
            name: "Should not exist",
            trigger: { kind: "time", ut: 9000 },
          }}
        />
      </ModalProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Set alarm" }));

    expect(host.snapshot().alarms).toHaveLength(0);
  });

  it("retargets its own alarm rather than adding a second", async () => {
    const { rerender } = mountMainScreen(
      <RequestingWidget
        request={{
          key: "burn",
          name: "Burn starts",
          trigger: { kind: "time", ut: 9000 },
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Set alarm" }));
    const firstId = host.snapshot().alarms[0].id;

    rerender(
      <ModalProvider>
        <AlarmsLauncherBridge
          useSnapshot={() => host.snapshot()}
          onAdd={(input) => {
            host.addAlarm(input);
          }}
          onUpdate={(id, patch) => host.updateAlarm(id, patch)}
          onDelete={(id) => host.deleteAlarm(id)}
        >
          <RequestingWidget
            request={{
              key: "burn",
              name: "Burn starts (revised)",
              trigger: { kind: "time", ut: 9500 },
            }}
          />
        </AlarmsLauncherBridge>
      </ModalProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Set alarm" }));

    const alarms = host.snapshot().alarms;
    expect(alarms).toHaveLength(1);
    // The SAME row, moved: keeping the id means a warp-to session or a SCET arm
    // already holding it follows the change instead of being orphaned.
    expect(alarms[0].id).toBe(firstId);
    expect(alarms[0].name).toBe("Burn starts (revised)");
    expect(alarms[0].trigger).toMatchObject({ ut: 9500 });
  });

  it("scopes the key to the Uplink, so two Uplinks do not retarget each other", async () => {
    mountMainScreen(
      <>
        <RequestingWidget
          request={{
            key: "burn",
            name: "Ours",
            trigger: { kind: "time", ut: 9000 },
          }}
          label="Set alarm"
        />
        <RequestingWidget
          owner={SECOND_UPLINK}
          request={{
            key: "burn",
            name: "Theirs",
            trigger: { kind: "time", ut: 9100 },
          }}
          label="Set other alarm"
        />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Set alarm" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Set other alarm" }),
    );

    const alarms = host.snapshot().alarms;
    expect(alarms).toHaveLength(2);
    expect(alarms.map((a) => a.requestedBy?.uplinkName)).toEqual([
      "Test Uplink",
      "Other Uplink",
    ]);
  });

  it("addresses a threshold as the Topic and path the Uplink named", async () => {
    mountMainScreen(
      <RequestingWidget
        request={{
          key: "apoapsis",
          name: "Above 100 km",
          trigger: {
            kind: "threshold",
            topic: "vessel.flight",
            fieldPath: "altitudeAsl",
            op: ">",
            value: 100_000,
            vantage: "scet",
          },
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Set alarm" }));

    // The joined `dataKey` is derived from the address rather than asked for,
    // so the client-side read and the mod-side arm cannot name different things.
    expect(host.snapshot().alarms[0].trigger).toMatchObject({
      kind: "threshold",
      topic: "vessel.flight",
      fieldPath: "altitudeAsl",
      dataKey: "vessel.flight.altitudeAsl",
      op: ">",
      value: 100_000,
      sustainSeconds: 0,
      vantage: "scet",
    });
  });

  it("survives a reload with its provenance intact", () => {
    const storage = memoryStorage();
    const first = new AlarmHostService(null, {
      nowMs: () => 1_700_000_000_000,
      tickIntervalMs: 1000,
      storage,
      getOwltSeconds: () => 0,
    });
    first.addAlarm({
      name: "Launch pad upgrade complete",
      trigger: { kind: "time", ut: 9000, leadSeconds: 10 },
      requestedBy: {
        uplinkId: "test-uplink",
        uplinkName: "Test Uplink",
        key: "facility-upgrade:LaunchPad",
      },
    });
    first.dispose();

    // The reviver rebuilds an alarm field by field, so a field it does not know
    // about is dropped silently on the next load. The row would then stop
    // saying where it came from, and the Uplink's next request would add a
    // second alarm instead of retargeting this one.
    const reloaded = new AlarmHostService(null, {
      nowMs: () => 1_700_000_000_000,
      tickIntervalMs: 1000,
      storage,
      getOwltSeconds: () => 0,
    });
    expect(reloaded.snapshot().alarms[0].requestedBy).toEqual({
      uplinkId: "test-uplink",
      uplinkName: "Test Uplink",
      key: "facility-upgrade:LaunchPad",
    });
    reloaded.dispose();
  });

  it("carries provenance from a station to the host that owns the list", () => {
    /*
     * A station's own add already routes this way and the Uplink request rides
     * it, which is the whole reason an Uplink widget works on a station without
     * knowing stations exist.
     *
     * The bridge is the half worth pinning. It rebuilds the add field by field
     * rather than spreading the message, so a field left off that list is
     * dropped in silence and is not a type error, `requestedBy` being optional.
     * The station-side send is a spread of the whole input and the types carry
     * it, so there is nothing there for a test to discover.
     */
    const added: unknown[] = [];
    /*
     * A holder rather than a bare `let`: assigned only inside the callback, a
     * plain binding narrows to `never` after the constructor returns and the
     * call below stops typechecking.
     */
    const subscribed: { deliver: AlarmAddDelivery | null } = { deliver: null };
    new AlarmPeerBridge(
      {
        onPeerConnect: () => () => {},
        onAlarmAdd: (cb) => {
          subscribed.deliver = cb;
          return () => {};
        },
        onAlarmUpdate: () => () => {},
        onAlarmDelete: () => () => {},
        onAlarmAcknowledge: () => () => {},
        onAlarmAckUnscheduledWarp: () => () => {},
        onAlarmWarpIntent: () => () => {},
        sendToPeer: () => {},
        broadcast: () => {},
      },
      {
        addAlarm: (input) => added.push(input),
        updateAlarm: () => {},
        deleteAlarm: () => {},
        acknowledgeAlarm: () => {},
        acknowledgeUnscheduledWarp: () => {},
        registerStationWarpIntent: () => {},
        getSnapshot: () => host.snapshot(),
      },
    );

    expect(subscribed.deliver).not.toBeNull();
    subscribed.deliver?.("station-abc", {
      type: "alarm-add",
      name: "Launch pad upgrade complete",
      trigger: { kind: "time", ut: 9000, leadSeconds: 10 },
      requestedBy: {
        uplinkId: "test-uplink",
        uplinkName: "Test Uplink",
        key: "facility-upgrade:LaunchPad",
      },
    });

    expect(added).toHaveLength(1);
    // Both questions answered at once: the station is who SENT it, the Uplink
    // is who asked for it.
    expect(added[0]).toMatchObject({
      createdBy: "station-abc",
      requestedBy: {
        uplinkId: "test-uplink",
        key: "facility-upgrade:LaunchPad",
      },
    });
  });

  it("lets the operator delete it, and a fresh request makes a new one", async () => {
    mountMainScreen(
      <RequestingWidget
        request={{
          key: "burn",
          name: "Burn starts",
          trigger: { kind: "time", ut: 9000 },
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Set alarm" }));
    const firstId = host.snapshot().alarms[0].id;

    act(() => {
      host.deleteAlarm(firstId);
    });
    expect(host.snapshot().alarms).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Set alarm" }));
    const alarms = host.snapshot().alarms;
    expect(alarms).toHaveLength(1);
    expect(alarms[0].id).not.toBe(firstId);
  });
});

/**
 * The uninstall question, answered where it can be observed: the alarm is the
 * app's, so nothing about it depends on the Uplink still being loaded.
 */
describe("an Uplink's alarm after the Uplink is gone", () => {
  beforeEach(() => {
    installStream();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setActiveViewClockForTests(undefined);
    setActiveTimelineStoreForTests(undefined);
    setActiveTelemetryClientForTests(undefined);
  });

  it("survives the Uplink's removal, and keeps naming the one that asked", () => {
    const svc = new AlarmHostService(null, {
      nowMs: () => 1_700_000_000_000,
      tickIntervalMs: 1000,
      storage: memoryStorage(),
      getOwltSeconds: () => 0,
    });
    const alarm = svc.addAlarm({
      name: "Launch pad upgrade complete",
      trigger: { kind: "time", ut: 1100, leadSeconds: 10 },
      requestedBy: {
        uplinkId: "gone-uplink",
        uplinkName: "Removed Uplink",
        key: "facility-upgrade:LaunchPad",
      },
    });

    /* Nothing is loaded for `gone-uplink`: no client handle, no registration,
       no bundle. The alarm is unaffected, which is the whole rule here.

       It does not FIRE, and that is nothing to do with the Uplink: a time alarm
       is the mod's to latch, and there is no mod on this fixture. What the
       Uplink's absence must not do is remove the alarm or blank its row. */
    setActiveViewClockForTests({ viewUt: () => 1200 });
    vi.advanceTimersByTime(1000);

    const after = svc.snapshot().alarms.find((a) => a.id === alarm.id);
    expect(after).toBeDefined();
    // The name was captured at request time rather than looked up, so the row
    // still reads. A lookup would go blank at exactly this moment.
    expect(after?.requestedBy?.uplinkName).toBe("Removed Uplink");
    svc.dispose();
  });
});
