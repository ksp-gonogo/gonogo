import { MutedIcon, SpeakerIcon, ToggleButton } from "@ksp-gonogo/ui-kit";

/**
 * Tune one conversation out, beside the key that talks on it.
 *
 * **This is the tuning control, and there is no other one.** Real mission
 * control tunes by a per-loop monitor the operator sets deliberately, not by
 * which loop is on the screen in front of them, so what this widget offers is
 * a mute the operator chooses and the radio remembers. Everything not muted is
 * monitored, which is why there is no matching "monitor" control to forget to
 * press.
 *
 * Beside talk, because they are the two halves of the same question about one
 * conversation: whether this operator is speaking on it and whether they are
 * hearing it.
 *
 * The LABEL stays "Mute <name>" in both states and `aria-pressed` carries which
 * one it is in, the APG toggle-button pattern: a label that flipped to "Unmute"
 * would change what the control is called at the same instant it changed state,
 * and a screen reader would read the new name against the old expectation.
 */
export function RadioMute({
  muted,
  threadName,
  onToggle,
}: {
  muted: boolean;
  /** What the operator calls this conversation, as the inbox names it. */
  threadName: string;
  onToggle: () => void;
}) {
  return (
    <ToggleButton
      size="sm"
      tone="warn"
      active={muted}
      aria-label={`Mute ${threadName}`}
      onClick={onToggle}
    >
      {muted ? (
        <MutedIcon size={14} aria-hidden="true" />
      ) : (
        <SpeakerIcon size={14} aria-hidden="true" />
      )}
    </ToggleButton>
  );
}
