import { createContext, useContext } from "react";
import type { RadioReceiver } from "./RadioSession";
import type { StartRadioCapture } from "./RadioTransmitter";
import { startWebAudioCapture, WebAudioRadioReceiver } from "./webaudio";

/**
 * The two places the radio touches the browser, named as one thing and handed
 * in rather than reached for.
 *
 * `RadioSession` and `RadioTransmitter` are already free of the browser: the
 * microphone and the decoder are both injected into them. `useRadio` was where
 * that stopped, because it constructed the real ones itself, so the moment the
 * radio was mounted inside a widget there was no way to run it without a device
 * and a secure context. A render harness cannot have either, and neither can an
 * automated exercise of a keying end to end.
 *
 * A microphone is also the one input an operator's machine may legitimately not
 * be able to give: an insecure origin refuses it, a machine with no input device
 * has none, and a future "choose your input" setting picks between several. So
 * this is a seam the feature wants anyway, not scaffolding for the tests.
 */
export interface RadioBackend {
  /** Open the microphone and encode it, one callback per 20 ms chunk. */
  startCapture: StartRadioCapture;
  /**
   * One screen's listening half: a single output that every transmission opens
   * its own decode stream on, and that sums them.
   *
   * A receiver rather than a decoder, because the mix has to be built at the
   * listener and therefore has to be a thing the backend owns. See
   * {@link RadioReceiver}.
   */
  createReceiver(): RadioReceiver;
}

/** The real one: WebCodecs Opus over Web Audio, which is all `webaudio.ts` is. */
export const WEB_AUDIO_RADIO_BACKEND: RadioBackend = {
  startCapture: startWebAudioCapture,
  createReceiver: () => new WebAudioRadioReceiver(),
};

/**
 * The backend the radio under this tree runs on.
 *
 * Defaulted rather than nullable, so the app wires nothing and gets the real
 * one, and only a harness that means to substitute has to say so.
 */
const RadioBackendContext = createContext<RadioBackend>(
  WEB_AUDIO_RADIO_BACKEND,
);

export const RadioBackendProvider = RadioBackendContext.Provider;

export function useRadioBackend(): RadioBackend {
  return useContext(RadioBackendContext);
}
