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
  pendingLabel,
  bindAs,
}: {
  handle: CommandButtonHandle;
  args?: unknown;
  commandLabel?: string;
  label: string;
  confirmLabel: string;
  kind: "launch" | "recover" | "revert";
  pendingLabel?: string;
  /** The action that presses this control from a bound input. */
  bindAs?: LaunchDirectorActionId;
}) {
  const {
    isArmed,
    isPending,
    isRefused,
    isLost,
    isBlocked,
    isShowingReason,
    refusalText,
    hasFailure,
    press,
  } = useCommandButton({ handle, args, commandLabel });
  useBindPress(bindAs, press, !isPending);

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
  if (isBlocked) {
    // aria-disabled, not disabled, so a press can show the command's own reason.
    return (
      <ArmButton
        type="button"
        onClick={() => press(true)}
        $kind={kind}
        aria-disabled="true"
        aria-label={refusalText ?? undefined}
        title={refusalText ?? undefined}
        data-gate="blocked"
        data-launch-action={`blocked-${kind}`}
      >
        {isShowingReason ? refusalText : label}
      </ArmButton>
    );
  }
  if (isArmed) {
    return (
      <ConfirmButton
        type="button"
        onClick={() => press(true)}
        $kind={kind}
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
      data-failed={hasFailure ? "true" : undefined}
      data-launch-action={`arm-${kind}`}
    >
      {label}
    </ArmButton>
  );
}
