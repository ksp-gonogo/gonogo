import "@ksp-gonogo/components";
import {
  ContributionsProvider,
  getComponent,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { recordedModeFrames, setModeLayer } from "@ksp-gonogo/sitrep-client";
import {
  DashboardItemContext,
  resetModeViewForTests,
  StreamRecorder,
  TelemetryClient,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  act,
  render,
  StubTransport,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import lowpass from "../../../components/src/LandingStatus/__fixtures__/rig/landing-lowpass.replay.json";
import { ModeLayerProvider } from "./ModeLayerProvider";

interface Wire {
  type: string;
  topic: string;
  payload: unknown;
  meta: { validAt: number };
}

function parsed<T extends object>(raw: string): T {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) {
    throw new Error(`not a JSON object: ${raw.slice(0, 64)}`);
  }
  return value as T;
}

const wire = lowpass.frames
  .map((f) => parsed<Wire>(f))
  .filter((m) => m.type === "stream-data")
  .sort((a, b) => a.meta.validAt - b.meta.validAt);
const first = wire[0]?.meta.validAt ?? 0;
const last = wire[wire.length - 1]?.meta.validAt ?? 0;
/** Seconds into the flight at which the recording is started. */
const BEGAN = 60;

/*
 * A recording as the app makes one: the stream recorder on a real client,
 * started partway through a flight. The rig's recordings differ from it in two
 * ways that a replay has to survive. The recorder is handed frames the client
 * has decoded, so it writes each quantity as a magnitude and a unit, where the
 * wire holds a bare number. And a Topic the mod sends only on change is not
 * sent again after the recording starts: here the bodies arrive once, before
 * it, as they do in the game.
 */
function recordedByTheApp(): readonly string[] {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  for (const topic of new Set(wire.map((m) => m.topic))) {
    client.subscribe(topic, () => {});
  }
  const recorder = new StreamRecorder(client);
  let bodiesSent = false;
  for (const m of wire) {
    if (!recorder.recording && m.meta.validAt >= first + BEGAN) {
      recorder.start();
    }
    if (m.topic === "trackingStation.bodies") {
      if (bodiesSent) continue;
      bodiesSent = true;
    }
    transport.emit(m.topic, m.payload, m.meta as never);
  }
  return recorder.stop().frames;
}

function Tile({ id }: { id: string }) {
  const Component = getComponent(id)?.component;
  if (!Component) throw new Error(`${id} is not registered`);
  return (
    <div style={{ width: 400, height: 600 }}>
      <DashboardItemContext.Provider value={{ instanceId: id }}>
        <WidgetMetaContext.Provider
          value={{ componentId: id, contributionSlots: [] }}
        >
          <ContributionsProvider>
            <Component config={{}} id={id} w={8} h={22} />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </DashboardItemContext.Provider>
    </div>
  );
}

beforeEach(() => {
  setModeLayer(undefined);
  resetModeViewForTests();
});

describe("a replay of a recording the app's own recorder made", () => {
  it("fills the real Orbit View and Landing tiles, from a recording begun partway through the flight", async () => {
    const recorded = recordedByTheApp();
    // The recorder's form, not the wire's: a quantity is written out as its parts.
    expect(recorded.some((f) => f.includes('"magnitude"'))).toBe(true);
    // The bodies were last sent before the recording began, and are in it only as the state it began from.
    const bodies = recorded
      .map((f) => parsed<{ topic: string; carried?: boolean }>(f))
      .filter((m) => m.topic === "trackingStation.bodies");
    expect(bodies.map((m) => m.carried)).toEqual([true]);
    const fixture = setupStreamFixture({ pinnedUt: 10 });
    const view = render(
      <fixture.Provider>
        <ModeLayerProvider>
          <Tile id="orbit-view" />
          <Tile id="landing-status" />
        </ModeLayerProvider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit(
        "mode.state",
        {
          mode: "replay",
          name: "Replay",
          answers: "craft",
          modelled: false,
          inputs: [],
          timeline: {
            startUt: first,
            endUt: last,
            atUt: first + 120,
            playing: false,
            rate: 1,
            rates: [1],
            marks: [],
            launchUt: null,
          },
          noTimeline: "",
          entry: 1,
        },
        { validAt: 5 },
      );
      setModeLayer({
        mode: "replay",
        entry: 1,
        modelled: false,
        frames: recordedModeFrames("replay", recorded),
      });
    });
    // The craft is in a level 5 km orbit about the Mun. Orbit View names the body from the bodies, and Landing reads its air from them.
    await waitFor(() => {
      const text = view.container.textContent ?? "";
      expect(text).toContain("Stable orbit");
      expect(text).toMatch(/Ap5\.0\s*km/);
      expect(text).toContain("Mun · vacuum");
      expect(text).toMatch(/Altitude ASL5\.00\s*km/);
    });
    await act(async () => {});
  });
});
