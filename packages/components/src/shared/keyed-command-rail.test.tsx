import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { act, render, waitFor, within } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionGroupComponent } from "../ActionGroup/index";
import { NavballComponent } from "../Navball/index";
import { setupStreamFixture } from "../test/setupStreamFixture";

/*
 * A command sent by a key bound on a station (the widget's Inputs tab, through
 * the input dispatcher) is the same dispatch as a click, so it is drawn on every
 * screen of the centre: the station that sent it and the main screen, which
 * learns of it from the centre's queue.
 */

afterEach(() => clearActionHandlers());

const T0 = 350296488.3;
const DELAY = 27;
const PRESS = { kind: "button", value: true } as const;

const GROUPS = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

const CONTROL = {
  sas: false,
  sasMode: 0,
  rcs: false,
  gear: false,
  brakes: false,
  lights: false,
  throttle: 0,
  actionGroups: GROUPS,
};

interface Case {
  name: string;
  widget: (id: string) => ReactElement;
  action: string;
  command: string;
}

const CASES: Case[] = [
  {
    name: "Action Group Light",
    widget: (id) => (
      <ActionGroupComponent
        config={{ actionGroupId: "Light" }}
        id={id}
        w={6}
        h={6}
      />
    ),
    action: "toggle",
    command: "vessel.control.setLights",
  },
  {
    name: "Navball RCS",
    widget: (id) => (
      <NavballComponent config={{ controlMode: true }} id={id} w={8} h={15} />
    ),
    action: "toggle-rcs",
    command: "vessel.control.setRcs",
  },
];

function mountScreen(c: Case, instanceId: string) {
  const fixture = setupStreamFixture({ pinnedUt: T0, suspendFrames: true });
  fixture.transport.holdCommands();
  const { container } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        {c.widget(instanceId)}
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  const meta = { validAt: T0 - DELAY, deliveredAt: T0 };
  act(() => {
    fixture.emit("comms.link", { connected: true }, meta);
    fixture.emit("comms.delay", { oneWaySeconds: DELAY, source: 1 }, meta);
    fixture.emit("vessel.control", CONTROL, meta);
  });
  const phases = () =>
    Array.from(
      container.querySelectorAll("[data-panel-rail-frame] [data-phase]"),
    ).map((el) => el.getAttribute("data-phase"));
  return { fixture, rail: () => within(container), phases };
}

/** Presses the bound key on the station, and puts the dispatch on both screens' queue as the mod does. */
async function keyOnStation(c: Case, extra: Record<string, unknown> = {}) {
  const main = mountScreen(c, "main-1");
  const station = mountScreen(c, "station-1");
  await waitFor(() =>
    expect(station.fixture.transport.sentCommands).toHaveLength(0),
  );
  act(() => {
    dispatchAction("station-1", c.action, PRESS);
  });
  const sent = station.fixture.transport.sentCommands;
  expect(sent.map((s) => s.command)).toEqual([c.command]);
  const pending = {
    pending: [
      {
        id: "engine-1",
        clientRequestId: sent[0].requestId,
        command: c.command,
        label: sent[0].label ?? "",
        topic: "",
        vantage: "ground:Kerbin: KSC",
        dispatchedAt: T0,
        oneWaySeconds: DELAY,
        ...extra,
      },
    ],
  };
  const meta = { validAt: T0 - DELAY, deliveredAt: T0 };
  act(() => {
    main.fixture.emit("system.uplink.pending", pending, meta);
    station.fixture.emit("system.uplink.pending", pending, meta);
  });
  return { main, station };
}

describe.each(CASES)("$name sent by a bound key on a station", (c) => {
  it("is drawn in flight on the station's rail and on the main screen's", async () => {
    const { main, station } = await keyOnStation(c);
    for (const screen of [station, main]) {
      expect(
        screen.rail().getByRole("img", { name: /1 in flight/ }),
      ).toBeTruthy();
      expect(screen.phases()).toContain("in-transit");
    }
    expect(main.fixture.transport.sentCommands).toHaveLength(0);
    await act(async () => {});
  });

  it("is drawn unanswered on both rails once the centre finds its reply overdue", async () => {
    const { main, station } = await keyOnStation(c, {
      replyOverdueUt: T0 - 1,
    });
    for (const screen of [station, main]) {
      expect(screen.phases()).toContain("overdue");
    }
    await act(async () => {});
  });
});

describe("a throttle input sent by a bound key on a station, accepted with a warning", () => {
  const WARNING =
    "A continuous input is lost if it has to wait, and this centre's plan says it would wait at Duna Relay.";
  const navball: Case = CASES[1];
  const railText = (screen: ReturnType<typeof mountScreen>) =>
    screen
      .rail()
      .queryAllByText(/warning/)
      .map((el) => el.textContent)
      .join("|");

  it("shows the warning on the station's rail and on the main screen's", async () => {
    const main = mountScreen(navball, "main-1");
    const station = mountScreen(navball, "station-1");
    act(() => {
      dispatchAction("station-1", "throttle-full", PRESS);
    });
    await waitFor(() =>
      expect(
        station.fixture.transport.sentCommands.map((s) => s.command),
      ).toEqual(["vessel.control.setThrottle"]),
    );
    const [sent] = station.fixture.transport.sentCommands;
    const pending = {
      pending: [
        {
          id: "engine-1",
          clientRequestId: sent.requestId,
          command: sent.command,
          label: sent.label ?? "",
          topic: "",
          vantage: "ground:Kerbin: KSC",
          dispatchedAt: T0,
          oneWaySeconds: null,
          predictedHeldAt: "relay-1",
          predictedReplyUt: T0 + 2 * DELAY,
          commandedValue: 1,
          warning: WARNING,
        },
      ],
    };
    const meta = { validAt: T0 - DELAY, deliveredAt: T0 };
    act(() => {
      station.fixture.transport.emitRaw({
        type: "command-accepted",
        requestId: sent.requestId,
        warning: WARNING,
      });
      main.fixture.emit("system.uplink.pending", pending, meta);
      station.fixture.emit("system.uplink.pending", pending, meta);
    });

    for (const screen of [station, main]) {
      await waitFor(() => expect(railText(screen)).toContain("1 warning"));
    }
    expect(main.fixture.transport.sentCommands).toHaveLength(0);
    await act(async () => {});
  });
});

describe.each(
  CASES,
)("$name sent by a bound key on a station and refused by the craft", (c) => {
  it("says the command failed on the station's rail and on the main screen's", async () => {
    const { main, station } = await keyOnStation(c);
    const [sent] = station.fixture.transport.sentCommands;
    station.fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: "modeUnavailable",
    }));
    const queue = {
      pending: [],
      settled: [
        {
          id: "engine-1",
          clientRequestId: sent.requestId,
          command: c.command,
          label: sent.label ?? "",
          topic: "",
          vantage: "ground:Kerbin: KSC",
          settledAt: T0 + 1,
          outcome: "refused",
          code: "modeUnavailable",
        },
      ],
    };
    const meta = { validAt: T0 + 1 - DELAY, deliveredAt: T0 + 1 };
    await act(async () => {
      station.fixture.transport.answerHeldCommands();
      main.fixture.scrubTo(T0 + 1);
      station.fixture.scrubTo(T0 + 1);
      main.fixture.emit("system.uplink.pending", queue, meta);
      station.fixture.emit("system.uplink.pending", queue, meta);
    });
    for (const screen of [station, main]) {
      await waitFor(() =>
        expect(screen.rail().getByText("1 command failed")).toBeTruthy(),
      );
    }
    await act(async () => {});
  });
});
