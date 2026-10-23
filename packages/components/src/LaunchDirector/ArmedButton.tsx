import { classifyCommandRejection } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  type CommandButtonHandle,
  commandRefusalSentence,
  Text,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import { type LaunchDirectorActionId, useBoundPress } from "./actions";

/**
 * The pad/flight action button: a `CommandButton` whose tone carries the verb.
 * A launch is the filled go control of its group, and a recover or revert is
 * the quiet one that arms in the destructive tone. A refusal's reason is written
 * beside the control, since the button itself only says "Refused".
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
  const [refusal, setRefusal] = useState<string | null>(null);
  const choice = JSON.stringify(args);
  // biome-ignore lint/correctness/useExhaustiveDependencies: another choice of craft or vessel is the trigger
  useEffect(() => setRefusal(null), [choice]);
  const reasoned: CommandButtonHandle = {
    ...handle,
    send: (...sendArgs: Parameters<CommandButtonHandle["send"]>) => {
      setRefusal(null);
      return handle.send(...sendArgs).catch((err: unknown) => {
        const rejection = classifyCommandRejection(err);
        if (rejection.kind === "refused") {
          setRefusal(commandRefusalSentence(rejection));
        }
        throw err;
      });
    },
  };
  return (
    <>
      <CommandButton
        handle={reasoned}
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
      {/* The button's own live region announces the refusal, so this line is for sight only. */}
      {refusal !== null && (
        <Text level="muted" size="xs">
          {refusal}
        </Text>
      )}
    </>
  );
}
