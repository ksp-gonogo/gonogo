import {
  BroadcastIcon,
  Text,
  ToggleButton,
  usePanelCrossing,
  VisuallyHidden,
  VOICE_RAIL_TAGS,
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
/** One captured chunk is 20 ms, so a light-time converts to that many samples. */
const CHUNK_SECONDS = 0.02;

export function RadioPtt({
  radio,
  targetName,
  separationSeconds,
}: {
  radio: RadioControl;
  /** Who the key is aimed at, for the crossing's accessible name. */
  targetName?: string;
  /** One-way light-time to them, or null when there is none to draw. */
  separationSeconds?: number | null;
}) {
  /*
   * The operator's own voice, handed to the rail to draw crossing the gap.
   * Registered only while keyed: an idle transmitter publishes nothing, so the
   * rail has no ribbon rather than an empty one.
   */
  usePanelCrossing(
    radio.transmitting
      ? {
          tags: VOICE_RAIL_TAGS,
          label: `Your transmission crossing to ${targetName ?? "the far end"}`,
          amplitudes: radio.amplitudes,
          spanSamples: Math.max(
            1,
            Math.round((separationSeconds ?? 0) / CHUNK_SECONDS),
          ),
        }
      : null,
  );

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
        This operator's OWN key, and only that. Reception is announced by the
        transmission light instead, which is drawn in every view rather than
        only inside a conversation: audio follows an explicit monitor, so what
        arrives may be on a loop this composer is not for, and announcing it
        here would both miss those and say it twice for the ones it caught.
      */}
      <VisuallyHidden role="status" aria-live="polite">
        {radio.transmitting ? "Transmitting" : ""}
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
