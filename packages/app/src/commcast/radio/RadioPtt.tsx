import {
  BroadcastIcon,
  Text,
  ToggleButton,
  usePanelDelay,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import { useId } from "react";
import styled from "styled-components";
import type { RadioControl } from "./useRadio";

/**
 * The push-to-talk key, at the top right of the widget's own bar, opposite the
 * heading that says which view the operator is in.
 *
 * **A LATCH, not hold-to-talk, and that is an accessibility decision rather
 * than a preference.** Press-and-hold on a real `<button>` has no keyboard
 * equivalent: `keydown` autorepeats, and a Space or Enter `keyup` is not
 * guaranteed to pair with the `keydown` that started it. A latching toggle is
 * operable identically by mouse, touch and keyboard, and `ToggleButton` carries
 * `aria-pressed` for it automatically. Hold-to-talk on pointer events may be
 * ADDED later; it must never become the only way to key the microphone.
 *
 * **The label is FIXED, and the state is carried beside it.** It used to read
 * "Talk" and then "On air", which is two words of different width on the one
 * control an operator presses twice in a row: the second press lands where the
 * first one was and the button is no longer there. The pressed state is the
 * filled tone plus `aria-pressed`, exactly as `RadioMute` next to it does it,
 * and the accessible name stays "Talk" through every state so a screen reader
 * is never told the control was renamed at the instant it changed.
 *
 * The state is announced once through a polite live region, and the input LEVEL
 * deliberately is not: a meter updating at frame rate through `aria-live` floods
 * a screen reader with a reading nobody asked to hear continuously.
 */
/** One captured chunk is 20 ms, so a light-time converts to that many samples. */
const CHUNK_SECONDS = 0.02;

/**
 * The light-time to the far end, in captured chunks: how many samples of the
 * ribbon fit in the gap, and so what fraction of it the trace has filled.
 *
 * **Fractional, and never rounded or floored.** It used to be
 * `max(1, round(...))`, and both halves of that were wrong below one chunk: a
 * few hundred kilometres of low orbit is well under a millisecond, so the gap
 * holds a twentieth of a single 20 ms sample, and a span of 1 told the rail the
 * gap held a whole one. Drawn against a fixed pitch that came back out as a
 * full-width sawtooth from two samples: confident, legible, identical for every
 * transmission at low orbit, and saying nothing. `RailCrossing` limits its
 * turning points to the samples actually behind them, and it can only do that
 * if it is handed the real number.
 *
 * `undefined` when there is no separation to convert, which is the prop's
 * documented "caller does not know" reading: the trace falls back to the
 * retained ring's own length rather than scaling against a gap of zero.
 *
 * Exported so the render harness can ask the same question the key asks rather
 * than restate the arithmetic. A restated copy agrees with itself forever, and
 * a picture drawn from one is a picture of the harness.
 */
export function crossingSpanSamples(
  separationSeconds: number | null | undefined,
): number | undefined {
  if (separationSeconds == null || !Number.isFinite(separationSeconds)) {
    return undefined;
  }
  if (separationSeconds <= 0) return undefined;
  return separationSeconds / CHUNK_SECONDS;
}

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
   *
   * **Through `usePanelDelay`, the seam the one rail reads.** The ribbon is a
   * mark inside `ControlDelayStream` now rather than a component of its own, and
   * that component is reached from a registered handle, so voice arrives the way
   * every other continuous entry does. The handle is honest by OMISSION: there
   * is nothing discrete in flight, nothing to refuse, lose or dismiss, and no
   * must-consume token to mark, because none of those are a transmission's. What
   * it does claim is the one thing that is true, that this is a stream.
   */
  const label = `Your transmission crossing to ${targetName ?? "the far end"}`;
  usePanelDelay(
    radio.transmitting
      ? {
          inFlight: [],
          shape: "stream",
          effectiveDelaySeconds: separationSeconds ?? null,
          ariaLabel: label,
          ribbons: [
            {
              id: "radio.voice",
              label,
              oneWaySeconds: separationSeconds ?? null,
              amplitudes: radio.amplitudes,
              spanSamples: crossingSpanSamples(separationSeconds),
            },
          ],
        }
      : null,
  );

  const reasonId = useId();
  const blocked = radio.unavailable ?? radio.fault;
  return (
    <Radio__Ptt>
      {/* No `aria-label`: the word inside the button IS the accessible name, so
          it cannot drift from what the operator can see, and it stays "Talk"
          whatever the key is doing. `aria-pressed` says which state it is in
          and the live region below says it out loud once. */}
      <ToggleButton
        size="sm"
        tone="nogo"
        active={radio.transmitting}
        disabled={radio.unavailable !== null}
        {...(blocked === null ? {} : { "aria-describedby": reasonId })}
        onClick={radio.toggle}
      >
        <BroadcastIcon size={14} aria-hidden="true" />
        Talk
      </ToggleButton>
      {/*
        This operator's OWN key, and only that. Reception is announced by the
        transmission light instead, which is drawn in every view rather than
        only inside a conversation: audio follows an explicit monitor, so what
        arrives may be on a loop this composer is not for, and announcing it
        here would both miss those and say it twice for the ones it caught.

        The opening state is announced HERE rather than put in the name, for the
        same reason the on-air state is: the microphone takes a moment to open
        and a control that renames itself twice in that moment is a control an
        assistive technology reports three times.
      */}
      <VisuallyHidden role="status" aria-live="polite">
        {radio.opening
          ? "Opening microphone"
          : radio.transmitting
            ? "Transmitting"
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
  gap: var(--gap-related);
  min-width: 0;
`;
