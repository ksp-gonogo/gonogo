import {
  AvatarStack,
  BroadcastIcon,
  MutedIcon,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import type { DetectedTransmission } from "../detected";
import { namesOf } from "../groups";
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
 * Drawn when nothing is happening too, and always the same size. A lamp that
 * appeared only while it mattered, or grew a name per speaker, would shift the
 * bar under the operator's eye at the exact instant they needed to read it, and
 * an instrument that is dark is itself a reading. Who is talking is a stack of
 * initials badges with the full names in their tips, so a new speaker fills a
 * place that was already reserved.
 */
export function RadioIndicator({
  live,
  detected = [],
  nameFor,
  onOpen,
}: {
  live: readonly RadioLight[];
  /**
   * Keyings this vantage can detect without being in their group. Shown as
   * who is on the air, never as something to open: there is no audio and no
   * thread to go to.
   */
  detected?: readonly DetectedTransmission[];
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
  onOpen: (light: RadioLight) => void;
}) {
  /*
   * How many of them the operator is actually hearing AT ONCE.
   *
   * The listener sums every transmission addressed to it, so two unmuted
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
  const overlapping = audible > 1;
  const busy = live.length > 0 || detected.length > 0;
  const speakers = [
    ...live.map((one) => ({
      id: one.transmissionId,
      name: namesOf(one.with, nameFor),
      tone: one.muted ? ("neutral" as const) : ("info" as const),
      onSelect: () => onOpen(one),
    })),
    ...detected.map((one) => ({
      id: one.transmissionId,
      name: detectedName(one, nameFor),
      tone: "neutral" as const,
    })),
  ];
  return (
    /*
     * ONE region for every speaker. A live region per speaker would announce
     * the same transmission twice when two loops open together, and `polite`
     * because a transmission is a state change worth being told about rather
     * than something that must interrupt: `assertive` belongs to an abort.
     */
    <Radio__Indicator
      role="status"
      aria-live="polite"
      data-tone={overlapping ? "warn" : busy ? "info" : "neutral"}
    >
      {/* Shape, not only colour: a heard speaker and a muted one differ by the glyph as well as the edge. */}
      {live.length > 0 && live.every((one) => one.muted) ? (
        <MutedIcon size="var(--icon-size-control)" aria-hidden="true" />
      ) : (
        <BroadcastIcon size="var(--icon-size-control)" aria-hidden="true" />
      )}
      {/* Empty it still holds its places, so going quiet never narrows the bar. */}
      <AvatarStack items={speakers} max={MAX_SPEAKERS} />
      {!busy && <VisuallyHidden>Quiet</VisuallyHidden>}
      {overlapping && (
        <VisuallyHidden>
          {audible} at once, talking over each other
        </VisuallyHidden>
      )}
      {live.map((one) => (
        <VisuallyHidden key={one.transmissionId}>
          {namesOf(one.with, nameFor)} transmitting
          {one.muted ? ", muted" : ""}
        </VisuallyHidden>
      ))}
      {detected.map((one) => (
        <VisuallyHidden key={one.transmissionId}>
          {detectedName(one, nameFor)} transmitting, not addressed to you
        </VisuallyHidden>
      ))}
    </Radio__Indicator>
  );
}

/** Places in the stack, which is also what fixes the indicator's width. */
const MAX_SPEAKERS = 3;

const Radio__Indicator = styled.div`
  display: flex;
  align-items: center;
  flex: none;
  gap: var(--gap-glyph-box);
  /* Exactly one control high with or without a badge, so a new speaker never moves the bar. */
  block-size: var(--control-height);
  min-height: var(--control-height);
  padding-inline: var(--gap-glyph-box);
  border: 1px solid var(--color-neutral-mark);
  border-radius: var(--radius-regular);
  font-size: var(--font-size-compact);
  /* The icon's box is the stack's height, so the two share a centre line. */
  & > svg {
    flex: none;
    display: block;
  }
  &[data-tone="info"] {
    border-color: var(--color-info-mark);
  }
  &[data-tone="warn"] {
    border-color: var(--color-warn-mark);
  }
`;

/** Who is on the air and to whom. The speaker is among the addressed, so naming them again says nothing. */
function detectedName(
  one: DetectedTransmission,
  nameFor: (id: RecipientId) => string,
): string {
  const author = one.authorName === "" ? nameFor(one.from) : one.authorName;
  const to = namesOf(
    one.to.filter((id) => id !== one.from),
    nameFor,
  );
  return `${author} at ${nameFor(one.from)} to ${to}`;
}
