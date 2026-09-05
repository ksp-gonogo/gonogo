import { createContext, useContext } from "react";
import type { RadioDecoderLike } from "./RadioSession";
import type { StartRadioCapture } from "./RadioTransmitter";
import {
  startWebAudioCapture,
  WebAudioRadioSink,
  WebCodecsRadioDecoder,
} from "./webaudio";

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
  /** A fresh decode-and-play chain for one screen's listening half. */
  createDecoder(): RadioDecoderLike;
}

/** The real one: WebCodecs Opus over Web Audio, which is all `webaudio.ts` is. */
export const WEB_AUDIO_RADIO_BACKEND: RadioBackend = {
  startCapture: startWebAudioCapture,
  createDecoder: () => new WebCodecsRadioDecoder(new WebAudioRadioSink()),
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
