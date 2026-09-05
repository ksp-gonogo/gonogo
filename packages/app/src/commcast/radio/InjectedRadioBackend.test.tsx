import { act, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { RadioBackend } from "./backend";
import { useRadioBackend, WEB_AUDIO_RADIO_BACKEND } from "./backend";
import { InjectedRadioBackend } from "./InjectedRadioBackend";

/**
 * The provider that lets a browser test drive the radio without a microphone.
 *
 * Both directions are exercised deliberately. A seam that silently accepted
 * anything present would take the real microphone away from an operator whose
 * page happened to carry that global, and a seam that never accepted anything
 * would report a clean pass while the Playwright scene ran on WebCodecs, so
 * "swaps" and "refuses" are each planted rather than assumed.
 */

const BACKEND_KEY = "__gonogoRadioBackend";
const CHANGED_EVENT = "gonogo:radio-backend";

function stubBackend(): RadioBackend {
  return {
    startCapture: () => Promise.resolve({ stop: () => {} }),
    createReceiver: () => ({
      openStream: () => ({
        decode: () => {},
        reset: () => {},
        close: () => {},
      }),
      close: () => {},
    }),
  };
}

/** Install `held` the way a page does, event included. */
function install(held: unknown): void {
  act(() => {
    (globalThis as Record<string, unknown>)[BACKEND_KEY] = held;
    globalThis.dispatchEvent(new Event(CHANGED_EVENT));
  });
}

function Probe({ expected }: { expected: RadioBackend }) {
  return <div>{useRadioBackend() === expected ? "match" : "other"}</div>;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[BACKEND_KEY];
});

describe("InjectedRadioBackend", () => {
  it("leaves the real backend in place when the page installed nothing", () => {
    render(
      <InjectedRadioBackend>
        <Probe expected={WEB_AUDIO_RADIO_BACKEND} />
      </InjectedRadioBackend>,
    );

    expect(screen.getByText("match")).toBeTruthy();
  });

  it("swaps to the page's backend, on a page that has already booted", () => {
    const injected = stubBackend();
    render(
      <InjectedRadioBackend>
        <Probe expected={injected} />
      </InjectedRadioBackend>,
    );
    // Mounted on the real one: the swap below is what is being measured, so
    // starting already matched would prove nothing.
    expect(screen.getByText("other")).toBeTruthy();

    install(injected);

    expect(screen.getByText("match")).toBeTruthy();
  });

  it("refuses a half-installed handle rather than disabling the microphone", () => {
    render(
      <InjectedRadioBackend>
        <Probe expected={WEB_AUDIO_RADIO_BACKEND} />
      </InjectedRadioBackend>,
    );

    // A capture with no decoder: the shape a broken install produces, and the
    // one that would look like a dead radio rather than a dead install.
    install({ startCapture: () => Promise.resolve({ stop: () => {} }) });

    expect(screen.getByText("match")).toBeTruthy();
  });
});
