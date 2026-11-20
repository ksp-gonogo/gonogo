import { type ModeLayer, setModeLayer } from "@ksp-gonogo/sitrep-client";
import {
  type ModeId,
  Quality,
  readingSource,
  registerMode,
  registerModeSource,
  Staleness,
  stillTrue,
} from "@ksp-gonogo/sitrep-sdk";
import {
  resetModeViewForTests,
  useEvents,
  useModeSync,
  useModeTimeline,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  act,
  fireEvent,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { registerAugment, TONE_MARK } from "@ksp-gonogo/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { ModeFrame } from "../components/ModePane/ModeFrame";
import orbitFrame from "./__fixtures__/orbit-frame.json";
import { ModeHost } from "./ModeHost";
import { ModeLayerProvider } from "./ModeLayerProvider";

/*
 * A mode that stands for any that answers for the craft: its source supplies
 * the orbit it hears, and the same orbit twice the size from `LATER` on, over
 * a timeline with one mark. It publishes only on a current orbit, so a test
 * can tell what the source was told about each value.
 */
const MODE = "test.flight" as ModeId;
const now = orbitFrame.meta.validAt;
const LATER = now + 1000;
const END = now + 2000;
const BIG = Math.round(Number(orbitFrame.payload.sma) * 2);
const heard: boolean[] = [];
let started = 0;

function parsed<T extends object>(raw: string): T {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) {
    throw new Error(`not a JSON object: ${raw.slice(0, 64)}`);
  }
  return value as T;
}

registerModeSource(MODE, {
  start: ({ watch, publish }) => {
    started += 1;
    return watch("vessel.orbit", (payload, validAt, current) => {
      heard.push(current);
      if (!current || payload == null) return;
      const orbit = parsed<Record<string, unknown>>(JSON.stringify(payload));
      publish({
        startUt: validAt ?? now,
        endUt: END,
        marks: [{ ut: LATER, label: "Step" }],
        samples: [
          {
            topic: "vessel.orbit",
            validAt: validAt ?? now,
            payload: orbit,
            quality: Quality.OnRails,
          },
          {
            topic: "vessel.orbit",
            validAt: LATER,
            payload: { ...orbit, sma: BIG },
            quality: Quality.OnRails,
          },
        ],
      });
    });
  },
});

// How a screen presents a mode the mod declares: registered under the mode's id, with the colour it is drawn in.
registerMode({
  id: "test.coloured" as ModeId,
  name: "Coloured",
  useActive: () => false,
  tone: "caution",
});

registerAugment({
  id: "test.flight.notes",
  augments: `mode-sections.${MODE}` as never,
  label: "Notes",
  component: () => <span>notes</span>,
});

const live = {
  mode: "live",
  name: "Live",
  answers: "nothing",
  modelled: false,
  inputs: [],
  timeline: null,
  noTimeline: "",
  entry: 0,
};
const flight = (atUt: number | undefined, playing = false) => ({
  mode: MODE,
  name: "Test Flight",
  answers: "craft",
  modelled: true,
  inputs: [],
  timeline:
    atUt === undefined
      ? null
      : {
          startUt: now,
          endUt: END,
          atUt,
          playing,
          rate: 1,
          rates: [1, 10, 100, 1000],
          marks: [{ ut: LATER, label: "Step" }],
          launchUt: null,
        },
  noTimeline: "",
  entry: 1,
});

let said = now;

/** Publishes `mode.state` as the mod does: each value later than the last. */
function say(
  fixture: ReturnType<typeof setupStreamFixture>,
  state: unknown,
): void {
  said += 1;
  fixture.emit("mode.state", state, { validAt: said });
}

const identity = {
  vesselId: "v1",
  name: "Hopper",
  vesselType: 0,
  situation: 6,
  parentBodyIndex: 1,
  launchUt: now - 600,
};

/** What tiles see: the orbit and which mode supplied it, the craft's name, and whether the orbit is carried to the moment on screen. */
function Tiles() {
  const reading = useTelemetry("vessel.orbit");
  const orbit = stillTrue(reading, undefined);
  const from = readingSource(reading);
  const craft = stillTrue(useTelemetry("vessel.identity"), undefined);
  return (
    <>
      <output aria-label="orbit">
        {orbit
          ? `${Math.round(Number(orbit.sma))} ${from?.mode ?? "live"}`
          : "none"}
      </output>
      <output aria-label="carried">{reading.reckoning.status}</output>
      <output aria-label="craft">{craft?.name ?? "not known"}</output>
    </>
  );
}

function TimelineProbe() {
  const timeline = useModeTimeline();
  const [synced, setSynced] = useModeSync();
  return (
    <>
      <output aria-label="at">
        {timeline ? Math.round(timeline.at) : "none"}
      </output>
      <button type="button" onClick={() => setSynced(!synced)}>
        {synced ? "synced" : "own"}
      </button>
      <button type="button" onClick={() => timeline?.seek(now + 500)}>
        seek
      </button>
    </>
  );
}

const SMALL = Math.round(Number(orbitFrame.payload.sma));
const setRanges = (fixture: ReturnType<typeof setupStreamFixture>) =>
  fixture.transport.sentCommands.filter(
    (c) => c.command === "mode.timeline.setRange",
  );

// Before, not after: the layer and the screen's place are shared by the page, and clearing them under a tree still mounted re-renders it outside the test.
beforeEach(() => {
  setModeLayer(undefined);
  resetModeViewForTests();
  heard.length = 0;
});

describe("a mode that answers for the craft, from the hosting screen to a station", () => {
  it("answers on the hosting screen, sends the layer on, tells the mod the range, and leaves the rest of the craft not known", async () => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    const sent: (ModeLayer | null)[] = [];
    const relay = {
      setModeLayer: (layer: ModeLayer | null) => sent.push(layer),
    };
    render(
      <fixture.Provider>
        <ModeHost relay={relay} />
        <ModeLayerProvider>
          <Tiles />
        </ModeLayerProvider>
      </fixture.Provider>,
    );
    act(() => {
      say(fixture, live);
      fixture.emit("vessel.orbit", orbitFrame.payload, { validAt: now });
      fixture.emit("vessel.identity", identity, { validAt: now });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toBe(`${SMALL} live`),
    );
    expect(screen.getByLabelText("craft").textContent).toBe("Hopper");

    act(() => say(fixture, flight(undefined)));
    await waitFor(() => expect(sent.at(-1)?.frames).toHaveLength(2));
    const layer = sent.at(-1) as ModeLayer;
    expect(layer.modelled).toBe(true);
    expect(JSON.parse(layer.frames[0] ?? "").meta.mode).toBe(MODE);
    expect(setRanges(fixture)).toHaveLength(1);
    expect(setRanges(fixture)[0]?.args).toMatchObject({
      mode: MODE,
      startUt: now,
      endUt: END,
      marks: [{ label: "Step" }],
    });
    expect(setRanges(fixture)[0]?.vantage).toBe("meta");

    act(() => say(fixture, flight(LATER + 10)));
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toBe(`${BIG} ${MODE}`),
    );
    // The supplied coast is carried to the moment on screen, as a live orbit is.
    expect(screen.getByLabelText("carried").textContent).toBe("available");
    // The mode answers for the whole craft: what it supplied nothing for is not known, never the live craft's.
    expect(screen.getByLabelText("craft").textContent).toBe("not known");

    act(() => say(fixture, live));
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toBe(`${SMALL} live`),
    );
    expect(screen.getByLabelText("craft").textContent).toBe("Hopper");
    expect(sent.at(-1)).toBeNull();
    await act(async () => {});
  });

  it("keeps the source running when the relay is replaced, and gives the new relay the layer", async () => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    const first: (ModeLayer | null)[] = [];
    const second: (ModeLayer | null)[] = [];
    const host = (sent: (ModeLayer | null)[]) => (
      <fixture.Provider>
        <ModeHost
          relay={{ setModeLayer: (l: ModeLayer | null) => sent.push(l) }}
        />
      </fixture.Provider>
    );
    const before = started;
    const { rerender } = render(host(first));
    act(() => say(fixture, flight(undefined)));
    await waitFor(() => expect(started).toBeGreaterThan(before));
    act(() =>
      fixture.emit("vessel.orbit", orbitFrame.payload, { validAt: now }),
    );
    await waitFor(() => expect(first.at(-1)?.frames).toHaveLength(2));
    const starts = started;

    rerender(host(second));
    expect(started).toBe(starts);
    expect(second).toEqual([first.at(-1)]);
    // The relay that was replaced is not told the mode ended.
    expect(first.at(-1)).not.toBeNull();

    act(() => say(fixture, live));
    await waitFor(() => expect(second.at(-1)).toBeNull());
    await act(async () => {});
  });

  it("shows a station the same from the layer the host sent, with no source of its own", async () => {
    const host = setupStreamFixture({ pinnedUt: now + 60 });
    const sent: (ModeLayer | null)[] = [];
    const relay = { setModeLayer: (l: ModeLayer | null) => sent.push(l) };
    const hostView = render(
      <host.Provider>
        <ModeHost relay={relay} />
      </host.Provider>,
    );
    // Held by the page already, as the tiles hold it, so the source hears it the moment it subscribes.
    host.subscribe("vessel.orbit");
    act(() => say(host, flight(undefined)));
    // The source subscribes once its mode is on, and keeps quiet until it hears the craft.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(sent).toEqual([]);
    act(() => host.emit("vessel.orbit", orbitFrame.payload, { validAt: now }));
    await waitFor(() => expect(sent.at(-1)?.frames).toHaveLength(2));
    const layer = sent.at(-1) as ModeLayer;
    hostView.unmount();

    const station = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <station.Provider>
        <ModeLayerProvider>
          <Tiles />
        </ModeLayerProvider>
      </station.Provider>,
    );
    act(() => {
      station.emit("vessel.orbit", orbitFrame.payload, { validAt: now });
      say(station, flight(LATER + 10));
      // What `mode-layer` does on arrival from the host.
      setModeLayer(JSON.parse(JSON.stringify(layer)));
    });
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toBe(`${BIG} ${MODE}`),
    );
    expect(station.transport.sentCommands).toEqual([]);
    await act(async () => {});
  });

  it("leaves every tile on the live game while the mode has supplied nothing", async () => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <fixture.Provider>
        <ModeLayerProvider>
          <Tiles />
        </ModeLayerProvider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.orbit", orbitFrame.payload, { validAt: now });
      fixture.emit("vessel.identity", identity, { validAt: now });
      say(fixture, { ...flight(undefined), noTimeline: "Nothing to show" });
      setModeLayer({ mode: MODE, entry: 1, modelled: true, frames: [] });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByLabelText("orbit").textContent).toBe(`${SMALL} live`);
    expect(screen.getByLabelText("craft").textContent).toBe("Hopper");
  });
});

describe("the world under a mode", () => {
  function World() {
    const bodies = useTelemetry("trackingStation.bodies");
    const craft = useTelemetry("vessel.identity");
    return (
      <>
        <output aria-label="bodies">{bodies.state}</output>
        <output aria-label="identity">{craft.state}</output>
      </>
    );
  }

  it("is read from the live game, while a craft Topic the mode does not hold is not known", async () => {
    const station = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <station.Provider>
        <ModeLayerProvider>
          <Tiles />
          <World />
        </ModeLayerProvider>
      </station.Provider>,
    );
    // The live game has the bodies and a craft of its own.
    act(() => {
      station.emit("trackingStation.bodies", { bodies: [] }, { validAt: now });
      station.emit("vessel.identity", identity, { validAt: now });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("identity").textContent).toBe("observed"),
    );
    // A mode that holds the orbit and nothing else.
    act(() => {
      say(station, flight(now + 10));
      setModeLayer({
        mode: MODE,
        entry: 1,
        modelled: true,
        frames: [
          JSON.stringify({
            ...orbitFrame,
            meta: { ...orbitFrame.meta, mode: MODE },
          }),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toBe(
        `${SMALL} ${MODE}`,
      ),
    );
    expect(screen.getByLabelText("bodies").textContent).toBe("observed");
    expect(screen.getByLabelText("identity").textContent).toBe("pending");
    await act(async () => {});
  });
});

describe("the events a widget may ask for", () => {
  function Events({ wide = true }: { wide?: boolean }) {
    const events = useEvents(now, now + (wide ? 2000 : 10));
    return (
      <output aria-label="events">
        {events.map((e) => `${Math.round(e.ut - now)}:${e.label}`).join(" | ")}
      </output>
    );
  }

  it("are each stage the craft fired, from the history the screen holds, and the mode's marks while a mode is on", async () => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <fixture.Provider>
        <ModeLayerProvider>
          <Events />
        </ModeLayerProvider>
      </fixture.Provider>,
    );
    // The live craft says which stage it is on, and that changes twice.
    act(() => {
      fixture.emit("vessel.structure", { currentStage: 3 }, { validAt: now });
      fixture.emit(
        "vessel.structure",
        { currentStage: 2 },
        { validAt: now + 5 },
      );
      fixture.emit(
        "vessel.structure",
        { currentStage: 2 },
        { validAt: now + 8 },
      );
      fixture.emit(
        "vessel.structure",
        { currentStage: 1 },
        { validAt: now + 20 },
      );
    });
    await waitFor(() =>
      expect(screen.getByLabelText("events").textContent).toBe(
        "5:Stage 2 | 20:Stage 1",
      ),
    );
    // Under a mode, the events are the mode's: its own marks, and nothing of the live craft's.
    act(() => {
      say(fixture, flight(now + 10));
      setModeLayer({
        mode: MODE,
        entry: 1,
        modelled: true,
        frames: [
          JSON.stringify({
            ...orbitFrame,
            meta: { ...orbitFrame.meta, mode: MODE },
          }),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("events").textContent).toBe("1000:Step"),
    );
    await act(async () => {});
  });

  it("are only those between the two moments asked for", async () => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <fixture.Provider>
        <Events wide={false} />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.structure", { currentStage: 3 }, { validAt: now });
      fixture.emit(
        "vessel.structure",
        { currentStage: 2 },
        { validAt: now + 5 },
      );
      fixture.emit(
        "vessel.structure",
        { currentStage: 1 },
        { validAt: now + 20 },
      );
    });
    // The stretch asked for ends ten seconds in, before the second stage.
    await waitFor(() =>
      expect(screen.getByLabelText("events").textContent).toBe("5:Stage 2"),
    );
    await act(async () => {});
  });
});

describe("what a mode's source is told about each value it watches", () => {
  it("says which sample is held and which is fresh", async () => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    const sent: (ModeLayer | null)[] = [];
    const relay = { setModeLayer: (l: ModeLayer | null) => sent.push(l) };
    render(
      <fixture.Provider>
        <ModeHost relay={relay} />
        <ModeFrame titleFor={(m) => m.name}>
          <span />
        </ModeFrame>
      </fixture.Provider>,
    );
    fixture.subscribe("vessel.orbit");
    // The mod still holds the range and the place from before the page was opened.
    act(() => say(fixture, flight(now + 500)));
    // A screen that subscribes during a blackout is sent the last sample from before contact was lost.
    act(() =>
      fixture.emit("vessel.orbit", orbitFrame.payload, {
        validAt: now,
        staleness: Staleness.LastBeforeBlackout,
      }),
    );
    await waitFor(() => expect(heard).toEqual([false]));
    // The source kept quiet, so the timeline the mod holds stands and the screen says what it is waiting on.
    expect(setRanges(fixture)).toEqual([]);
    expect(sent).toEqual([]);
    expect(
      screen.getAllByText("Waiting for the craft", {
        ignore: "[data-live-region]",
      }),
    ).toHaveLength(1);
    expect(screen.getByRole("slider", { name: "Timeline" })).toBeTruthy();

    act(() =>
      fixture.emit("vessel.orbit", orbitFrame.payload, { validAt: now + 1 }),
    );
    await waitFor(() => expect(heard).toEqual([false, true]));
    await waitFor(() => expect(setRanges(fixture)).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryAllByText("Waiting for the craft")).toEqual([]),
    );
    await act(async () => {});
  });
});

describe("the pane's position", () => {
  it("slides out and back by the arrow on its rule, and the Timeline has no control for it", async () => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <fixture.Provider>
        <ModeFrame titleFor={(m) => m.name}>
          <span />
        </ModeFrame>
      </fixture.Provider>,
    );
    act(() => say(fixture, flight(now + 10)));
    const arrow = await screen.findByRole("button", {
      name: "Minimise Test Flight pane",
    });
    const timeline = screen.getByRole("region", { name: "Timeline" });
    expect(timeline.contains(arrow)).toBe(false);
    expect(screen.getByRole("region", { name: "Notes" })).toBeTruthy();

    act(() => arrow.click());
    const back = screen.getByRole("button", { name: "Show Test Flight pane" });
    expect(timeline.contains(back)).toBe(false);
    // Slid out, the pane's sections are out of reach, and the Timeline stays.
    expect(screen.queryByRole("region", { name: "Notes" })).toBeNull();
    expect(screen.getByRole("slider", { name: "Timeline" })).toBeTruthy();

    act(() => back.click());
    expect(screen.getByRole("region", { name: "Notes" })).toBeTruthy();
    await act(async () => {});
  });
});

describe("the switch that takes a screen off the shared timeline", () => {
  it("is offered on a screen that does not host, and not on the one that does", async () => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    const view = render(
      <fixture.Provider>
        <ModeFrame titleFor={(m) => m.name} ownPlace>
          <span />
        </ModeFrame>
      </fixture.Provider>,
    );
    act(() => say(fixture, flight(now + 10)));
    const sync = await screen.findByText("Sync timeline");
    // The mode's colour is given to the slider's own track, and the switch sits outside it, so the switch keeps the kit's colours and its knob shows.
    const track = screen
      .getByRole("slider", { name: "Timeline" })
      .closest("[data-track]");
    expect(track).not.toBeNull();
    expect(track?.contains(sync)).toBe(false);
    const coloured = [...document.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("\n")
      .split("}")
      .filter(
        (rule) =>
          rule.includes("--color-accent-fg:var(--mode-rule)") ||
          rule.includes("--color-accent-fg: var(--mode-rule)"),
      );
    // One rule sets it, and it is the track's.
    expect(coloured).toHaveLength(1);
    expect(
      [...(track?.classList ?? [])].some((c) => coloured[0]?.includes(`.${c}`)),
    ).toBe(true);
    view.unmount();

    const host = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <host.Provider>
        <ModeFrame titleFor={(m) => m.name}>
          <span />
        </ModeFrame>
      </host.Provider>,
    );
    act(() => say(host, flight(now + 10)));
    await screen.findByRole("slider", { name: "Timeline" });
    expect(screen.queryByText("Sync timeline")).toBeNull();
    await act(async () => {});
  });
});

describe("the colour a mode declares", () => {
  /** The colour set on the piece of the pane that holds the Timeline's track, which the track, the rule and the arrow all read. */
  const ruleRound = (slider: HTMLElement) =>
    slider
      .closest<HTMLElement>("[data-mode]")
      ?.style.getPropertyValue("--mode-rule");

  it.each([
    ["a mode registered with a colour", "test.coloured", "caution"],
    ["replay", "replay", "go"],
    ["a mode that declares none", MODE, "info"],
  ] as const)("reaches the pane and the Timeline's track for %s", async (_, id, tone) => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <fixture.Provider>
        <ModeFrame titleFor={(m) => m.name}>
          <span />
        </ModeFrame>
      </fixture.Provider>,
    );
    act(() => say(fixture, { ...flight(now + 10), mode: id }));
    const slider = await screen.findByRole("slider", { name: "Timeline" });
    expect(slider.closest("[data-track]")).not.toBeNull();
    expect(ruleRound(slider)).toBe(TONE_MARK[tone]);
    await act(async () => {});
  });
});

describe("the Timeline's playback rate", () => {
  it.each([
    ["held", false, "mode.timeline.pause"],
    ["playing", true, "mode.timeline.play"],
  ] as const)("is set with one command while the timeline is %s, which leaves it %s", async (_, playing, command) => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <fixture.Provider>
        <ModeFrame titleFor={(m) => m.name}>
          <span />
        </ModeFrame>
      </fixture.Provider>,
    );
    act(() => say(fixture, flight(now + 10, playing)));
    const rate = await screen.findByLabelText("Playback rate");
    act(() => {
      fireEvent.change(rate, { target: { value: "10" } });
    });
    expect(
      fixture.transport.sentCommands.map((c) => [c.command, c.args]),
    ).toEqual([[command, { mode: MODE, rate: 10 }]]);
    await act(async () => {});
  });
});

describe("a screen's place on the timeline", () => {
  it("follows the shared position while synced, and keeps its own and sends nothing with sync off", async () => {
    const fixture = setupStreamFixture({ pinnedUt: now + 60 });
    render(
      <fixture.Provider>
        <TimelineProbe />
      </fixture.Provider>,
    );
    act(() => say(fixture, flight(now + 10)));
    await waitFor(() =>
      expect(screen.getByLabelText("at").textContent).toBe(
        String(Math.round(now + 10)),
      ),
    );

    act(() => screen.getByText("synced").click());
    act(() => screen.getByText("seek").click());
    expect(screen.getByLabelText("at").textContent).toBe(
      String(Math.round(now + 500)),
    );
    expect(fixture.transport.sentCommands).toEqual([]);

    // The shared timeline moves on without this screen.
    act(() => say(fixture, flight(now + 20)));
    await act(async () => {});
    expect(screen.getByLabelText("at").textContent).toBe(
      String(Math.round(now + 500)),
    );

    act(() => screen.getByText("own").click());
    await waitFor(() =>
      expect(screen.getByLabelText("at").textContent).toBe(
        String(Math.round(now + 20)),
      ),
    );

    act(() => screen.getByText("seek").click());
    expect(screen.getByLabelText("at").textContent).toBe(
      String(Math.round(now + 500)),
    );
    await waitFor(() =>
      expect(fixture.transport.sentCommands.at(-1)).toMatchObject({
        command: "mode.timeline.seek",
        args: { mode: MODE, ut: now + 500 },
      }),
    );
    await act(async () => {});
  });
});
