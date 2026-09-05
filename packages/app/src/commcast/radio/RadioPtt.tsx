import {
  BroadcastIcon,
  Text,
  ToggleButton,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import { useId } from "react";
import styled from "styled-components";
import type { RadioControl } from "./useRadio";

/**
 * The push-to-talk key, at the head of the composer bar so the operator's eye
 * finds "talk" before "type".
 *
 * **A LATCH, not hold-to-talk, and that is an accessibility decision rather
 * than a preference.** Press-and-hold on a real `<button>` has no keyboard
 * equivalent: `keydown` autorepeats, and a Space or Enter `keyup` is not
 * guaranteed to pair with the `keydown` that started it. A latching toggle is
 * operable identically by mouse, touch and keyboard, and `ToggleButton` carries
 * `aria-pressed` for it automatically. Hold-to-talk on pointer events may be
 * ADDED later; it must never become the only way to key the microphone.
 *
 * The state is announced once through a polite live region, and the input LEVEL
 * deliberately is not: a meter updating at frame rate through `aria-live` floods
 * a screen reader with a reading nobody asked to hear continuously.
 */
export function RadioPtt({ radio }: { radio: RadioControl }) {
  const reasonId = useId();
  const blocked = radio.unavailable ?? radio.fault;
  const label = radio.opening
    ? "Opening microphone"
    : radio.transmitting
      ? "Stop transmitting"
      : "Transmit";
  return (
    <Radio__Ptt>
      <ToggleButton
        size="sm"
        tone="nogo"
        active={radio.transmitting}
        disabled={radio.unavailable !== null}
        aria-label={label}
        {...(blocked === null ? {} : { "aria-describedby": reasonId })}
        onClick={radio.toggle}
      >
        <BroadcastIcon size={14} aria-hidden="true" />
        {radio.transmitting ? "On air" : "Talk"}
      </ToggleButton>
      {/*
        One region, whose text changes. Both states it reports are at the
        operator's OWN present: transmitting is now, and a received transmission
        is announced at the instant its audio is played here, which is already
        one light-time after it was spoken. Nothing here can say that somebody
        is speaking who cannot yet be heard, which would be the
        faster-than-light channel the delay model exists to avoid.
      */}
      <VisuallyHidden role="status" aria-live="polite">
        {radio.transmitting
          ? "Transmitting"
          : radio.reception.playing
            ? `Receiving from ${radio.reception.playing.authorName}`
            : ""}
      </VisuallyHidden>
      {blocked !== null && (
        <Text id={reasonId} size="xs" tone="faint">
          {blocked}
        </Text>
      )}
    </Radio__Ptt>
  );
}

const Radio__Ptt = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
`;
