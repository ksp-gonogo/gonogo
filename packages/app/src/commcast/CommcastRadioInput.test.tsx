/**
 * The microphone an operator CHOOSES is the one the key transmits from.
 *
 * `RadioInput.test.tsx` owns the panel, `inputDevice.test.ts` owns the storage,
 * and neither can show the thing that was actually missing: the picker had no
 * consumer at all, so a choice made in it reached nothing. This is the whole
 * path, through the assembled widget: open the panel, grant access, select a
 * device, go into a conversation, key, and read what the capture was asked for.
 *
 * Nothing internal is mocked. What is substituted is the two ends that need a
 * browser (`RadioBackend`, `navigator.mediaDevices`) and the capability globals
 * the shipped detect reads, which jsdom does not have. A microphone cannot be
 * opened in CI, which is the reason that seam exists.
 */
import { clearRegistry } from "@ksp-gonogo/core";
import { RADIO_REQUIRED_GLOBALS } from "@ksp-gonogo/sitrep-sdk/media";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommcastWidget } from "./CommcastComponent";
import { CommcastLog } from "./CommcastLog";
import { CommcastLogProvider } from "./CommcastLogContext";
import type { RadioBackend } from "./radio/backend";
import { RadioBackendProvider } from "./radio/backend";
import type { RadioCaptureOptions } from "./radio/RadioTransmitter";

const ARES = "vessel:ares";
const KSC = "ksc";

const TOPICS = [
  "commandCentre.roster",
  "commandCentre.separation",
  "comms.delay",
  "comms.link",
];

const ROSTER = [{ id: ARES, displayName: "Ares 4", active: true }];
const PAIRS = [
  { from: KSC, to: ARES, oneWaySeconds: 3 },
  { from: ARES, to: KSC, oneWaySeconds: 3 },
];

const DEVICES = [
  { deviceId: "builtin", label: "Built-in Microphone" },
  { deviceId: "headset", label: "Comms Headset" },
];

const unmounts: Array<() => void> = [];
const restores: Array<() => void> = [];

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

function stubMediaDevices(opens: string): void {
  const track = {
    kind: "audio",
    label: DEVICES.find((d) => d.deviceId === opens)?.label ?? "",
    stop: () => {},
    getSettings: () => ({ deviceId: opens }),
  };
  const before = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: () =>
        Promise.resolve(
          DEVICES.map((d) => ({ ...d, kind: "audioinput", groupId: "" })),
        ),
      /* Only what the code under test reads, rather than a whole
         `MediaStream`: `defineProperty` takes its value untyped, so asserting
         a plain object into that interface would buy nothing and would hide
         the day another of its members starts being read. */
      getUserMedia: () =>
        Promise.resolve({
          getTracks: () => [track],
          getAudioTracks: () => [track],
        }),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  restores.push(() => {
    if (before) Object.defineProperty(navigator, "mediaDevices", before);
    else Reflect.deleteProperty(navigator as object, "mediaDevices");
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

function scene() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS, pinnedUt: 10 });
  fixture.store.clock.suspendFrames();
  const log = new CommcastLog({ screenKey: "screen-under-test" });
  log.setVantage(KSC);

  /** Every capture the key opened, with what it asked for. */
  const captures: Array<RadioCaptureOptions | undefined> = [];
  const backend: RadioBackend = {
    startCapture: (_onChunk, options) => {
      captures.push(options);
      return Promise.resolve({ stop: () => {} });
    },
    createReceiver: () => ({
      openStream: () => ({
        decode: () => {},
        reset: () => {},
        close: () => {},
      }),
      close: () => {},
    }),
  };

  const view = render(
    <fixture.Provider>
      <CommcastLogProvider log={log}>
        <RadioBackendProvider value={backend}>
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
  return { captures };
}

/**
 * Into a conversation with Ares 4, which is where the key lives.
 *
 * Composed rather than opened off an inbox row, because this vantage has never
 * exchanged a word with anybody: a fresh screen's inbox is empty and the
 * recipient picker is the only route in.
 */
async function openThread(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New message" }));
  await user.click(screen.getByText("Ares 4"));
  await user.click(screen.getByRole("button", { name: "Open" }));
}

describe("Commcast radio, the microphone the operator chose", () => {
  it("keys the device picked in the panel, not the browser's default", async () => {
    /*
     * The wiring that did not exist. `AudioInputPicker` shipped with fourteen
     * tests and NO consumer, while the radio opened `getUserMedia` with fixed
     * constraints and never asked which input to use.
     */
    stubMediaDevices("headset");
    const s = scene();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Microphone/ }));
    await user.click(
      screen.getByRole("button", { name: "Request microphone access" }),
    );
    await screen.findByRole("combobox", { name: "Microphone" });

    // Into a conversation, which is where the key lives: the choice is a
    // property of this console and outlives whoever it is aimed at.
    await openThread(user);
    await user.click(screen.getByRole("button", { name: "Talk" }));

    await waitFor(() => expect(s.captures).toHaveLength(1));
    expect(s.captures[0]).toEqual({ deviceId: "headset" });
  });

  it("keys the browser's default when nothing has been chosen", async () => {
    // The state every screen starts in, and the one an unreadable setting
    // falls back to. A null is a request for whatever the machine offers.
    stubMediaDevices("builtin");
    const s = scene();
    const user = userEvent.setup();

    await openThread(user);
    await user.click(screen.getByRole("button", { name: "Talk" }));

    await waitFor(() => expect(s.captures).toHaveLength(1));
    expect(s.captures[0]).toEqual({ deviceId: null });
  });
});
