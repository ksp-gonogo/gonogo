import { AudioInputPicker } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { RADIO_CAPTURE_CONSTRAINTS } from "./webaudio";

/**
 * Which microphone the key transmits from.
 *
 * The kit already owns every hard part of this: `AudioInputPicker` asks for
 * permission, lists what the browser will admit to, opens the chosen input and
 * keeps an insecure origin, a refused permission and an absent device as three
 * distinguishable sentences. What was missing was a consumer, so the radio
 * opened `getUserMedia` with fixed constraints and never asked. This is that
 * consumer and nothing more.
 *
 * It lives on the widget's own view rather than inside a conversation, for the
 * reason the radio itself does: the microphone is a property of this console,
 * not of whoever the operator happens to be talking to.
 *
 * **The stream this opens is the audition, never the transmission.** The picker
 * holds an input open while it is on screen so the operator can pick against a
 * device that is actually running, and closes it when this unmounts; the radio
 * opens its own at key-down, from the id remembered here. Two openings of one
 * device is what every browser does for two tabs, and the alternative, handing
 * the picker's stream to the transmitter, would tie the ability to talk to
 * whether a settings panel was on screen.
 *
 * The constraints are the radio's own, so what is auditioned is processed the
 * way what is transmitted will be.
 */
export function RadioInput({
  id,
  deviceId,
  onChoose,
}: {
  /** Names this panel for the `aria-controls` of whatever discloses it. */
  id: string;
  /** The remembered choice, or `null` for the browser's default. */
  deviceId: string | null;
  onChoose: (deviceId: string | null) => void;
}) {
  return (
    <Radio__Input id={id}>
      <AudioInputPicker
        label="Microphone"
        /*
         * The remembered device rides in as a constraint, so the first request
         * opens the one the operator chose rather than the browser's default
         * and then having to be corrected. `useAudioInput` overrides this the
         * moment a selection is made, which is exactly what the picker is for.
         */
        constraints={{
          ...RADIO_CAPTURE_CONSTRAINTS,
          ...(deviceId === null ? {} : { deviceId: { exact: deviceId } }),
        }}
        onStream={(stream) => {
          /*
           * Read off the TRACK rather than off whatever was asked for: a
           * constraint names a device, the settings name the one that actually
           * opened, and on a `deviceId` the browser could not honour those are
           * two different devices. Remembering the request would write down a
           * choice the operator never got.
           *
           * A null stream is the picker closing, not a choice being withdrawn,
           * so the remembered device stands.
           */
          if (stream === null) return;
          const opened = stream.getAudioTracks()[0]?.getSettings?.().deviceId;
          if (opened) onChoose(opened);
        }}
      />
    </Radio__Input>
  );
}

const Radio__Input = styled.div`
  padding: var(--space-6) 0;
  min-width: 0;
`;
