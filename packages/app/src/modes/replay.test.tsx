import "fake-indexeddb/auto";
import {
  clearRegistry,
  registerDataSource,
  ScreenProvider,
} from "@ksp-gonogo/core";
import {
  FlightsFab,
  FlightsManager,
  MissionHistorySource,
  MissionStore,
} from "@ksp-gonogo/data";
import { type ModeLayer, setModeLayer } from "@ksp-gonogo/sitrep-client";
import {
  getModes,
  Quality,
  readingSource,
  registerMode,
  Staleness,
  stillTrue,
} from "@ksp-gonogo/sitrep-sdk";
import {
  resetModeViewForTests,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MissionBanner } from "../components/MissionBanner";
import { ModeFrame } from "../components/ModePane/ModeFrame";
import orbitFrame from "./__fixtures__/orbit-frame.json";
import { ModeHost } from "./ModeHost";
import { ModeLayerProvider } from "./ModeLayerProvider";

/*
 * A recorded flight of a craft called Recorder, three minutes long, with the
 * orbit growing halfway through, an event, and one frame of the dashboard's
 * own that a recording made off the wire also holds.
 */
const T0 = 5000;
const recorded = (
  topic: string,
  payload: unknown,
  validAt: number,
  type = "stream-data",
): string =>
  JSON.stringify({
    type,
    topic,
    ...(type === "event" ? { name: "staged" } : {}),
    payload,
    meta: {
      source: "vessel:rec",
      validAt,
      seq: validAt,
      deliveredAt: validAt + 2,
      vantage: "meta",
      quality: Quality.OnRails,
      active: true,
      staleness: Staleness.Fresh,
      timelineEpoch: 3,
    },
  });
const orbit = (sma: number, epoch: number) => ({
  ...orbitFrame.payload,
  sma,
  epoch,
  patches: [],
});
const craft = {
  vesselId: "rec",
  name: "Recorder",
  vesselType: 0,
  situation: 6,
  parentBodyIndex: 1,
  launchUt: T0 - 100,
};
const FRAMES = [
  recorded("vessel.identity", craft, T0),
  recorded("vessel.orbit", orbit(800_000, T0), T0),
  recorded("vessel.orbit", orbit(950_000, T0 + 90), T0 + 90),
  recorded("flight.started", { vesselId: "rec" }, T0 + 1, "event"),
  recorded("vessel.identity", craft, T0 + 180),
  recorded("mode.state", { mode: "live" }, T0 + 5),
];

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
const replay = (flight: string, atUt: number | undefined) => ({
  mode: "replay",
  name: "Replay",
  answers: "craft",
  modelled: false,
  inputs: [
    { key: "flight", value: flight },
    { key: "title", value: "Recorder" },
  ],
  timeline:
    atUt === undefined
      ? null
      : {
          startUt: T0,
          endUt: T0 + 180,
          atUt,
          playing: false,
          rate: 1,
          rates: [0.5, 1, 2, 5, 10, 50],
          marks: [],
          launchUt: T0 - 100,
        },
  noTimeline: "",
  entry: 1,
});

let said = orbitFrame.meta.validAt;
function parsed<T extends object>(raw: string): T {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) {
    throw new Error(`not a JSON object: ${raw.slice(0, 64)}`);
  }
  return value as T;
}

function say(
  fixture: ReturnType<typeof setupStreamFixture>,
  state: unknown,
): void {
  said += 1;
  fixture.emit("mode.state", state, { validAt: said });
}

function Tiles() {
  const reading = useTelemetry("vessel.orbit");
  const sma = stillTrue(reading, undefined)?.sma;
  const from = readingSource(reading);
  const name = stillTrue(useTelemetry("vessel.identity"), undefined)?.name;
  return (
    <>
      <output aria-label="orbit">
        {sma === undefined
          ? "none"
          : `${Math.round(Number(sma))} ${from ? `${from.mode} ${from.modelled ? "modelled" : "observed"}` : "live"}`}
      </output>
      <output aria-label="craft">{name ?? "not known"}</output>
    </>
  );
}

let kept = 0;

async function keptFlight(): Promise<string> {
  kept += 1;
  const id = `flight-${kept}`;
  const store = new MissionStore({ dbName: `replay-test-${kept}` });
  await store.saveMission({
    meta: {
      id,
      vesselName: "Recorder",
      launchedAt: 1,
      firstFrameUt: T0 + 2,
      lastFrameUt: T0 + 182,
      frameCount: FRAMES.length,
    },
    fixture: {
      subscribedTopics: ["vessel.orbit", "vessel.identity"],
      frames: FRAMES,
    },
  });
  registerDataSource(new MissionHistorySource(store));
  return id;
}

const commands = (fixture: ReturnType<typeof setupStreamFixture>) =>
  fixture.transport.sentCommands.map((c) => [c.command, c.args]);

beforeEach(() => {
  setModeLayer(undefined);
  resetModeViewForTests();
});
afterEach(() => clearRegistry());

describe("a recorded flight played back as a mode", () => {
  it("is supplied whole by the hosting screen, over the flight's own time, and shown on its tiles as observed", async () => {
    const flight = await keptFlight();
    const fixture = setupStreamFixture({ pinnedUt: said + 600 });
    const sent: (ModeLayer | null)[] = [];
    const relay = { setModeLayer: (l: ModeLayer | null) => sent.push(l) };
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
      fixture.emit("vessel.orbit", orbitFrame.payload, {
        validAt: orbitFrame.meta.validAt,
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toMatch(/ live$/),
    );

    act(() => say(fixture, replay(flight, undefined)));
    await waitFor(() => expect(sent.at(-1)?.frames.length).toBe(5));
    const layer = sent.at(-1) as ModeLayer;
    expect(layer.modelled).toBe(false);
    // The dashboard's own frame in the recording is left out; the event is kept.
    const topics = layer.frames.map((f) => JSON.parse(f).topic);
    expect(topics).not.toContain("mode.state");
    expect(topics).toContain("flight.started");
    expect(JSON.parse(layer.frames[0] ?? "").meta.mode).toBe("replay");

    const range = fixture.transport.sentCommands
      .filter((c) => c.command === "mode.timeline.setRange")
      .at(-1);
    expect(range?.args).toMatchObject({
      mode: "replay",
      startUt: T0,
      endUt: T0 + 180,
      launchUt: T0 - 100,
      rates: [0.5, 1, 2, 5, 10, 50],
      noTimeline: "",
    });

    act(() => say(fixture, replay(flight, T0 + 10)));
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toBe(
        "800000 replay observed",
      ),
    );
    expect(screen.getByLabelText("craft").textContent).toBe("Recorder");

    act(() => say(fixture, replay(flight, T0 + 120)));
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toBe(
        "950000 replay observed",
      ),
    );

    act(() => say(fixture, live));
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toMatch(/ live$/),
    );
    await act(async () => {});
  });

  it("is shown on a station from what the host sent, which keeps no recordings and runs no source", async () => {
    const flight = await keptFlight();
    const host = setupStreamFixture({ pinnedUt: said + 600 });
    const sent: (ModeLayer | null)[] = [];
    const relay = { setModeLayer: (l: ModeLayer | null) => sent.push(l) };
    const hostView = render(
      <host.Provider>
        <ModeHost relay={relay} />
      </host.Provider>,
    );
    act(() => say(host, replay(flight, undefined)));
    await waitFor(() => expect(sent.at(-1)?.frames.length).toBe(5));
    const layer = parsed<ModeLayer>(JSON.stringify(sent.at(-1)));
    hostView.unmount();
    clearRegistry();

    const station = setupStreamFixture({ pinnedUt: said + 600 });
    render(
      <station.Provider>
        <ModeLayerProvider>
          <Tiles />
        </ModeLayerProvider>
      </station.Provider>,
    );
    act(() => {
      say(station, replay(flight, T0 + 120));
      setModeLayer(layer);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toBe(
        "950000 replay observed",
      ),
    );
    expect(screen.getByLabelText("craft").textContent).toBe("Recorder");
    expect(station.transport.sentCommands).toEqual([]);
    await act(async () => {});
  });

  it("says so when the flight named is not one the hosting screen keeps", async () => {
    await keptFlight();
    const fixture = setupStreamFixture({ pinnedUt: said + 600 });
    render(
      <fixture.Provider>
        <ModeHost />
      </fixture.Provider>,
    );
    act(() => say(fixture, replay("no-such-flight", undefined)));
    await waitFor(() =>
      expect(
        fixture.transport.sentCommands
          .filter((c) => c.command === "mode.timeline.setRange")
          .at(-1)?.args,
      ).toMatchObject({ noTimeline: "Recording not found" }),
    );
    await act(async () => {});
  });
});

describe("a screen's header in a replay", () => {
  it("names the recorded craft once it is inside the mode's values, and the live one outside them", async () => {
    const active = (name: string) =>
      recorded("ksp.activeVessel", { vesselId: "rec", name }, T0);
    const station = setupStreamFixture({ pinnedUt: said + 600 });
    render(
      <station.Provider>
        <ScreenProvider value="station">
          <section aria-label="outside">
            <MissionBanner />
          </section>
          <ModeLayerProvider>
            <section aria-label="inside">
              <MissionBanner />
            </section>
          </ModeLayerProvider>
        </ScreenProvider>
      </station.Provider>,
    );
    act(() => {
      station.emit("spaceCenter.scene", { scene: "Flight" });
      station.emit("ksp.activeVessel", { vesselId: "live", name: "Live One" });
      say(station, replay("any", T0 + 10));
      setModeLayer({
        mode: "replay",
        entry: 1,
        modelled: false,
        frames: [
          JSON.parse(JSON.stringify(active("Recorder"))),
          recorded("spaceCenter.scene", { scene: "Flight" }, T0),
        ].map((raw) => {
          const frame = JSON.parse(raw);
          return JSON.stringify({
            ...frame,
            meta: { ...frame.meta, timelineEpoch: 0, mode: "replay" },
          });
        }),
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("inside").textContent).toContain("Recorder"),
    );
    expect(screen.getByLabelText("inside").textContent).not.toContain(
      "Live One",
    );
    expect(screen.getByLabelText("outside").textContent).toContain("Live One");
    // The date inside is the replay's moment, taken up a frame after the craft's name.
    const date = (where: string) =>
      screen.getByLabelText(where).textContent?.split("Command centre")[0];
    await waitFor(() => expect(date("inside")).not.toBe(date("outside")));
    await act(async () => {});
  });
});

describe("starting a replay from the flights window as the app opens it", () => {
  it("reaches the mod, though the window is drawn outside the screen's own stream", async () => {
    const flight = await keptFlight();
    const station = setupStreamFixture({ pinnedUt: said + 600 });
    // The app's own order: the window layer is above the stream, and a window's content is drawn in that layer.
    render(
      <ModalProvider>
        <station.Provider>
          <ScreenProvider value="station">
            <Tiles />
            <FlightsFab />
          </ScreenProvider>
        </station.Provider>
      </ModalProvider>,
    );
    act(() => {
      station.emit("vessel.orbit", orbitFrame.payload, {
        validAt: orbitFrame.meta.validAt,
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("orbit").textContent).toMatch(/ live$/),
    );
    // Replay is given another colour for this test, so the control is seen to take the mode's and not one of its own.
    const replay = getModes().find((m) => m.id === "replay");
    if (!replay) throw new Error("replay is not registered");
    act(() => registerMode({ ...replay, tone: "caution" }));
    act(() => screen.getByRole("button", { name: "Flight history" }).click());
    const button = await screen.findByRole("button", {
      name: /replay recorder/i,
    });
    // Opening the window gives its content the stream and takes nothing from the tiles behind it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(screen.getByLabelText("orbit").textContent).toMatch(/ live$/);
    // The control is drawn in the colour the replay mode declares, which is the one its pane and Timeline take.
    const styles = [...document.querySelectorAll("style")]
      .map((sheet) => sheet.textContent ?? "")
      .join("\n")
      .replace(/\s+/g, "");
    expect(
      [...button.classList].some((c) =>
        styles.includes(
          `.${c}:hover{border-color:var(--color-caution-mark);color:var(--color-caution-mark);}`,
        ),
      ),
    ).toBe(true);
    act(() => registerMode(replay));
    act(() => button.click());
    await waitFor(() =>
      expect(commands(station)).toEqual([
        ["mode.setInput", { mode: "replay", key: "flight", value: flight }],
        ["mode.setInput", { mode: "replay", key: "title", value: "Recorder" }],
        ["mode.enter", { mode: "replay" }],
      ]),
    );
    await act(async () => {});
  });
});

describe("starting a replay", () => {
  it("is done from a station's flights list by naming the flight to the mod and entering the mode", async () => {
    const flight = await keptFlight();
    const station = setupStreamFixture({ pinnedUt: said + 600 });
    render(
      <station.Provider>
        <FlightsManager screen="station" />
      </station.Provider>,
    );
    const button = await screen.findByRole("button", {
      name: /replay recorder/i,
    });
    act(() => button.click());
    await waitFor(() =>
      expect(commands(station)).toEqual([
        ["mode.setInput", { mode: "replay", key: "flight", value: flight }],
        ["mode.setInput", { mode: "replay", key: "title", value: "Recorder" }],
        ["mode.enter", { mode: "replay" }],
      ]),
    );
    expect(
      station.transport.sentCommands.every((c) => c.vantage === "meta"),
    ).toBe(true);
    await act(async () => {});
  });
});

describe("leaving a replay", () => {
  it("returns a screen to Live when the Timeline's exit is pressed, with the pane and Timeline the app mounts", async () => {
    const fixture = setupStreamFixture({ pinnedUt: said + 600 });
    render(
      <fixture.Provider>
        <ModeFrame titleFor={(m) => m.name} ownPlace>
          <Tiles />
        </ModeFrame>
      </fixture.Provider>,
    );
    act(() => say(fixture, replay("flight-1", T0 + 30)));
    const exit = await screen.findByRole("button", { name: /^Exit replay/ });
    act(() => exit.click());
    expect(fixture.transport.sentCommands.at(-1)).toMatchObject({
      command: "mode.exit",
      args: { mode: "replay" },
    });
    // The mod answers by saying the mode is live again.
    act(() => say(fixture, { ...live, entry: 2 }));
    await waitFor(() =>
      expect(screen.queryByRole("slider", { name: "Timeline" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /^Exit replay/ })).toBeNull();
    // And back in: the pane mounts afresh.
    act(() => say(fixture, { ...replay("flight-1", T0 + 30), entry: 3 }));
    await screen.findByRole("slider", { name: "Timeline" });
    await act(async () => {});
  });
});
