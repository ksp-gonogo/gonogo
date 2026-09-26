import {
  type CommandButtonHandle,
  commandLossSentence,
  Spinner,
  useCommandButton,
} from "@ksp-gonogo/ui-kit";
import { type LaunchDirectorActionId, useBindPress } from "./actions";
import { ArmButton, ConfirmButton } from "./styles";

/**
 * The pad/flight action button. Behaviour is the shared `useCommandButton`;
 * the chrome is local because each verb carries its own colour. Every button
 * carries a pending state, for idempotency and honesty alike.
 */
export function ArmedButton({
  handle,
  args,
  commandLabel,
  label,
  confirmLabel,
  kind,
  disabled,
  pendingLabel,
  bindAs,
}: {
  handle: CommandButtonHandle;
  args?: unknown;
  commandLabel?: string;
  label: string;
  confirmLabel: string;
  kind: "launch" | "recover" | "revert";
  disabled?: boolean;
  pendingLabel?: string;
  /** The action that presses this control from a bound input. */
  bindAs?: LaunchDirectorActionId;
}) {
  const {
    isArmed,
    isPending,
    isRefused,
    isLost,
    refusalText,
    hasFailure,
    press,
  } = useCommandButton({ handle, args, commandLabel });
  // Mirrors which render takes a click: pending never, refused and lost always, the rest unless disabled.
  useBindPress(
    bindAs,
    press,
    !isPending && (isRefused || isLost || disabled !== true),
  );

  if (isPending) {
    return (
      <ConfirmButton type="button" $kind={kind} disabled aria-busy="true">
        <Spinner size={12} /> {pendingLabel ?? "Working..."}
      </ConfirmButton>
    );
  }
  if (isRefused) {
    return (
      <ConfirmButton
        type="button"
        $kind={kind}
        onClick={() => press(true)}
        title={refusalText ?? undefined}
        aria-label={refusalText ?? undefined}
        data-launch-action={`refused-${kind}`}
      >
        Refused
      </ConfirmButton>
    );
  }
  if (isLost) {
    // Not the resting render: a recover or revert nobody answered may already have happened.
    const sentence = commandLossSentence({ label: commandLabel });
    return (
      <ConfirmButton
        type="button"
        $kind={kind}
        onClick={() => press(true)}
        title={sentence}
        aria-label={sentence}
        data-launch-action={`lost-${kind}`}
      >
        No reply
      </ConfirmButton>
    );
  }
  if (isArmed) {
    return (
      <ConfirmButton
        type="button"
        onClick={() => press(true)}
        $kind={kind}
        disabled={disabled}
        data-launch-action={`confirm-${kind}`}
      >
        {confirmLabel}
      </ConfirmButton>
    );
  }
  return (
    <ArmButton
      type="button"
      onClick={() => press(true)}
      $kind={kind}
      disabled={disabled}
      data-failed={hasFailure ? "true" : undefined}
      data-launch-action={`arm-${kind}`}
    >
      {label}
    </ArmButton>
  );
}
