import {
  BroadcastIcon,
  MutedIcon,
  StatusIndicator,
  TextButton,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import type { RecipientId } from "../types";
import type { RadioLight } from "./RadioSession";

/**
 * The transmission light: somebody is talking, and this is which loop.
 *
 * **The second half is the reason it exists.** Audio follows an explicit
 * monitor rather than the open thread, so a voice can arrive on a conversation
 * the operator is not looking at, and without a light naming it they would hear
 * a stranger with no way to tell which of their correspondences it came from.
 * That is why this is drawn in the bar of EVERY view rather than inside a
 * conversation: an off-screen transmission is the case it is for.
 *
 * It is read off the audio (`RadioReception.live`), not off the envelope, so it
 * lights when the words are heard and never a light-minute before, and a
 * conversation with no path to this vantage never lights at all.
 *
 * Drawn when nothing is happening too. A lamp that appeared only while it
 * mattered would shift the bar under the operator's eye at the exact instant
 * they needed to read it, and an instrument that is dark is itself a reading.
 */
export function RadioIndicator({
  live,
  nameFor,
  onOpen,
}: {
  live: readonly RadioLight[];
  nameFor: (id: RecipientId) => string;
  /**
   * Go to the conversation a lamp names.
   *
   * The name is a control rather than a caption because the mute lives beside
   * the key, inside a conversation, and radio leaves no transcript: a
   * correspondent this vantage has only ever HEARD has no inbox row to open,
   * so without this the one loop an operator most wants to tune out is the one
   * they cannot reach. It opens the existing thread view and adds no surface.
   */
  onOpen: (ids: readonly RecipientId[]) => void;
}) {
  /*
   * How many of them the operator is actually hearing AT ONCE.
   *
   * The listener sums every transmission it has a path to, so two unmuted
   * lamps mean two voices in the same ear at the same moment, and the second
   * one is why the first has suddenly become hard to follow. Two lamps side by
   * side do not say that on their own: they read equally well as "two loops
   * are busy", which is the state a moment earlier and the state a moment
   * later. Naming the overlap is the difference between an operator asking
   * somebody to say again and an operator asking one of them to stand by.
   *
   * Only ever drawn above one, because "1 at once" is not a reading.
   */
  const audible = live.filter((one) => !one.muted).length;
  return (
    /*
     * ONE region for every lamp. A live region per lamp would announce the same
     * transmission twice when two loops open together, and `polite` because a
     * transmission is a state change worth being told about rather than
     * something that must interrupt: `assertive` belongs to an abort.
     */
    <Radio__Indicator role="status" aria-live="polite">
      {live.length === 0 && (
        <StatusIndicator tone="neutral">Quiet</StatusIndicator>
      )}
      {audible > 1 && (
        <StatusIndicator tone="warn">
          {audible} at once
          {/* The sentence a screen reader needs, since "2 at once" beside two
              names is only legible as a picture. */}
          <VisuallyHidden> talking over each other</VisuallyHidden>
        </StatusIndicator>
      )}
      {live.map((one) => (
        <StatusIndicator
          key={one.transmissionId}
          tone={one.muted ? "neutral" : "info"}
          {...(one.muted ? {} : { pulse: "slow" as const })}
        >
          {/* Shape, not only colour: a muted lamp and a live one differ by the
              glyph as well as the dot, so the difference survives a monitor
              nobody calibrated and an operator who cannot tell the two dots
              apart. */}
          {one.muted ? (
            <MutedIcon size={12} aria-hidden="true" />
          ) : (
            <BroadcastIcon size={12} aria-hidden="true" />
          )}
          <TextButton type="button" onClick={() => onOpen(one.with)}>
            {one.with.map(nameFor).join(", ")}
          </TextButton>
          {/* The verb the name needs to mean anything read aloud. On screen the
              pulsing dot says it, which is why it is not drawn twice. */}
          <VisuallyHidden> transmitting</VisuallyHidden>
          {one.muted && <VisuallyHidden>, muted</VisuallyHidden>}
        </StatusIndicator>
      ))}
    </Radio__Indicator>
  );
}

const Radio__Indicator = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
`;
