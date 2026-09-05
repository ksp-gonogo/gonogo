/**
 * The listening model, through the whole widget: audio follows an explicit
 * monitor and NEVER the conversation that happens to be open.
 *
 * The unit suites own the arithmetic (`RadioSession.test.ts`) and the drawn
 * controls (`RadioIndicator.test.tsx`, `RadioMute.test.tsx`). What only the
 * assembled widget can show is the failure they were all written against: the
 * radio used to be mounted inside the composer, so stepping back to the inbox
 * tore the session down and cut off whoever was mid-sentence, and opening
 * another conversation built a fresh one that could not place the keying it was
 * already hearing. Which loop an operator could HEAR was a consequence of where
 * they were looking.
 *
 * Nothing internal is mocked. The real log, the real session, the real delay
 * arithmetic and the real controls all run; what is substituted is the two ends
 * that need a browser (`RadioBackend`) and the capability globals the shipped
 * detect reads, which jsdom does not have.
 */
import { clearRegistry } from "@ksp-gonogo/core";
import { RADIO_REQUIRED_GLOBALS } from "@ksp-gonogo/sitrep-sdk/media";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommcastWidget } from "./CommcastComponent";
import { CommcastLog } from "./CommcastLog";
import { CommcastLogProvider } from "./CommcastLogContext";
import type { RadioBackend } from "./radio/backend";
import { RadioBackendProvider } from "./radio/backend";
import type { RadioDecoderLike } from "./radio/RadioSession";
import type { RadioFrame } from "./radio/wire";

const ARES = "vessel:ares";
const WOOMERA = "ground:woomera";
const KSC = "ksc";
const LIGHT_TIME = 240;

/**
 * Spoken far enough in the past that the crossing is already over at the
 * fixture's clock, so one frame releases the chunk and the test is about the
 * MONITOR rather than about the delay, which its own suite covers.
 */
const SPOKEN_UT = -1000;

const TOPICS = [
  "commandCentre.roster",
  "commandCentre.separation",
  "comms.delay",
  "comms.link",
];

const ROSTER = [
  { id: ARES, displayName: "Ares 4", active: true },
  { id: WOOMERA, displayName: "Woomera Range", active: true },
];

const PAIRS = [
  { from: KSC, to: ARES, oneWaySeconds: LIGHT_TIME },
  { from: ARES, to: KSC, oneWaySeconds: LIGHT_TIME },
  { from: KSC, to: WOOMERA, oneWaySeconds: 3 },
  { from: WOOMERA, to: KSC, oneWaySeconds: 3 },
];

const unmounts: Array<() => void> = [];
const restores: Array<() => void> = [];

/**
 * Put jsdom into the capability state the radio needs, by moving the globals
 * the shipped detect actually reads.
 *
 * Forced this way rather than by stubbing `radioSupportStatus`, for the reason
 * the render probe forces it the same way: the real detect then runs, so this
 * suite cannot go on being right about a verdict the shipped code has stopped
 * producing.
 */
function stubGlobal(name: string, value: unknown): void {
  const had = name in globalThis;
  const before = (globalThis as Record<string, unknown>)[name];
  Object.defineProperty(globalThis, name, { configurable: true, value });
  restores.push(() => {
    if (had) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: before,
      });
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  });
}

beforeEach(() => {
  stubGlobal("isSecureContext", true);
  for (const name of RADIO_REQUIRED_GLOBALS) stubGlobal(name, class {});
});

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  for (const restore of restores.splice(0)) restore();
  clearRegistry();
  localStorage.clear();
});

/** Every chunk that reached a decoder, in the order it was played. */
function recordingBackend() {
  const played: string[] = [];
  const backend: RadioBackend = {
    startCapture: () =>
      Promise.reject(new Error("this suite never keys the microphone")),
    createDecoder: (): RadioDecoderLike => ({
      decode: (bytes) => {
        played.push(String.fromCharCode(...bytes));
      },
      reset: () => {},
      close: () => {},
    }),
  };
  return { played, backend };
}

function scene() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS, pinnedUt: 10 });
  /*
   * The clock's own frame loop is self-rescheduling and would pump the radio
   * whenever the machine felt like it, which is both non-deterministic and a
   * render outside `act`. Suspended before anything can subscribe, so
   * `emitFrame` is the only frame source and every release happens where the
   * test asked for it.
   */
  fixture.store.clock.suspendFrames();
  const log = new CommcastLog({ screenKey: "screen-under-test" });
  log.setVantage(KSC);
  const radio = recordingBackend();

  const mount = () => {
    const view = render(
      <fixture.Provider>
        <CommcastLogProvider log={log}>
          <RadioBackendProvider value={radio.backend}>
            <CommcastWidget id="w1" config={{}} w={6} h={8} />
          </RadioBackendProvider>
        </CommcastLogProvider>
      </fixture.Provider>,
    );
    unmounts.push(view.unmount);
    act(() => {
      fixture.emit("commandCentre.roster", ROSTER, { vantage: KSC });
      fixture.emit(
        "commandCentre.separation",
        { pairs: PAIRS },
        { vantage: KSC },
      );
      fixture.store.beginFrame();
    });
    return view;
  };

  return {
    fixture,
    log,
    played: radio.played,
    mount,
    /** Key up and say one word: the transmission is left OPEN, which is what
     *  the light reports on. */
    begin(id: string, from: string, word: string) {
      const authorStationKey = `station-${from}`;
      const frames: RadioFrame[] = [
        {
          kind: "start",
          transmissionId: id,
          authorStationKey,
          transmission: {
            id,
            to: [KSC],
            from,
            authorStationKey,
            authorName: from === ARES ? "Jeb" : "Woomera Range",
            authorSeat: from === ARES ? "pilot" : "mission-control",
            startedUt: SPOKEN_UT,
            separationSeconds: null,
          },
        },
        {
          kind: "chunk",
          transmissionId: id,
          authorStationKey,
          seq: 0,
          ut: SPOKEN_UT,
          bytes: Uint8Array.from(word, (c) => c.charCodeAt(0)),
        },
      ];
      act(() => {
        for (const frame of frames) log.receiveRadio(frame);
        // The frame that lets the delay clock release what has crossed, and
        // the only one this suite ever mints.
        fixture.store.clock.emitFrame();
      });
    },
    /** Key down. The envelope is retired once its audio has all played. */
    finish(id: string) {
      act(() => {
        log.receiveRadio({
          kind: "end",
          transmissionId: id,
          authorStationKey: `station-${id}`,
          ut: SPOKEN_UT,
        });
        fixture.store.clock.emitFrame();
      });
    },
  };
}

/** A whole keying, opened and closed. */
function say(
  s: ReturnType<typeof scene>,
  id: string,
  from: string,
  word: string,
): void {
  s.begin(id, from, word);
  s.finish(id);
}

describe("Commcast radio, monitored rather than tuned by the open view", () => {
  it("plays a conversation the operator is not looking at", async () => {
    /*
     * The defect, at widget level. This test never opens a conversation: the
     * screen is on the inbox from mount to assertion, and the words are heard
     * anyway. With the radio mounted in the composer there was no session at
     * all here.
     */
    const s = scene();
    s.mount();
    expect(await screen.findByText(/No conversations/)).toBeInTheDocument();

    s.begin("t1", ARES, "hi");
    expect(s.played).toEqual(["hi"]);
    expect(screen.getByRole("status")).toHaveTextContent("Ares 4 transmitting");

    // And the lamp goes out with the keying, rather than standing lit.
    s.finish("t1");
    expect(screen.getByRole("status")).toHaveTextContent("Quiet");
  });

  it("keeps hearing a conversation the operator navigates away from", async () => {
    // The failure that named the whole design: glancing somewhere else must
    // never silence somebody mid-sentence.
    const s = scene();
    s.mount();
    s.begin("t1", ARES, "one");
    await userEvent.click(screen.getByRole("button", { name: "Ares 4" }));
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    s.finish("t1");

    say(s, "t2", WOOMERA, "two");
    await userEvent.click(screen.getByRole("button", { name: "Inbox" }));
    say(s, "t3", ARES, "three");

    expect(s.played).toEqual(["one", "two", "three"]);
  });

  it("silences a muted conversation, wherever the operator then goes", async () => {
    const s = scene();
    s.mount();
    s.begin("t1", ARES, "one");
    // Reached through the light, which is the only route to a correspondent
    // this vantage has never exchanged a written word with.
    await userEvent.click(screen.getByRole("button", { name: "Ares 4" }));
    await userEvent.click(screen.getByRole("button", { name: "Mute Ares 4" }));
    await userEvent.click(screen.getByRole("button", { name: "Inbox" }));
    s.finish("t1");

    s.begin("t2", ARES, "two");
    expect(s.played).toEqual(["one"]);
    // Shown, and marked unheard. Mute is tuning, not a cut: the operator chose
    // not to hear this loop, not to stop knowing that it is busy.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Ares 4");
    expect(status).toHaveTextContent("muted");
    s.finish("t2");
  });

  it("mutes ONE conversation, not the radio", async () => {
    const s = scene();
    s.mount();
    await userEvent.click(screen.getByRole("button", { name: /New message/ }));
    await userEvent.click(screen.getByRole("button", { name: /Ares 4/ }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Mute Ares 4" }));

    say(s, "t1", ARES, "ares");
    say(s, "t2", WOOMERA, "woomera");
    expect(s.played).toEqual(["woomera"]);
  });

  it("remembers the mute across a reload", async () => {
    /*
     * A persistent operator decision, which is what makes it a monitor rather
     * than a view state. One that evaporated on reload would quietly put a loop
     * they had tuned out back in their ear.
     */
    const first = scene();
    first.mount();
    first.begin("t1", ARES, "one");
    await userEvent.click(screen.getByRole("button", { name: "Ares 4" }));
    await userEvent.click(screen.getByRole("button", { name: "Mute Ares 4" }));
    first.finish("t1");
    for (const unmount of unmounts.splice(0)) unmount();

    const second = scene();
    second.mount();
    say(second, "t2", ARES, "two");
    expect(second.played).toEqual([]);
  });
});
