import { CommandButton, type CommandButtonHandle } from "@ksp-gonogo/ui-kit";
import { type LaunchDirectorActionId, useBoundPress } from "./actions";

/**
 * The pad/flight action button: a `CommandButton` whose tone carries the verb.
 * A launch is the filled go control of its group, and a recover or revert is
 * the quiet one that arms in the destructive tone.
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
  const onPressReady = useBoundPress(bindAs);
  return (
    <CommandButton
      handle={handle}
      args={args}
      commandLabel={commandLabel}
      label={label}
      confirmLabel={confirmLabel}
      pendingLabel={pendingLabel}
      variant={kind === "launch" ? "primary" : "ghost"}
      tone={kind === "launch" ? "go" : "neutral"}
      confirmTone={kind === "launch" ? "go" : "nogo"}
      onPressReady={onPressReady}
      data-launch-action={`arm-${kind}`}
    />
  );
}
