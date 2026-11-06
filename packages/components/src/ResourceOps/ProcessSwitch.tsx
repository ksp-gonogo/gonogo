import type { CommandReply } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  type CommandButtonHandle,
  Inline,
} from "@ksp-gonogo/ui-kit";

export type ProcessSwitchHandles = Readonly<{
  start: CommandButtonHandle<CommandReply<"vessel.converter.start">>;
  stop: CommandButtonHandle<CommandReply<"vessel.converter.stop">>;
}>;

/**
 * The start or stop control for one drill or converter: the opposite of the
 * state it is in. Drawn only for a unit that has a part id and a run state
 * that is current, so a held channel or an unread state offers neither.
 */
export function ProcessSwitch({
  handles,
  partId,
  converterName,
  title,
  running,
  held,
}: Readonly<{
  handles: ProcessSwitchHandles;
  partId: string | null | undefined;
  converterName: string | null | undefined;
  title: string;
  running: boolean | null | undefined;
  held: boolean;
}>) {
  if (held || !partId || running === null || running === undefined) {
    return null;
  }
  const args = { partId, converterName: converterName || undefined };
  return (
    <Inline>
      {running ? (
        <CommandButton
          size="sm"
          handle={handles.stop}
          args={args}
          commandLabel={`Stop ${title}`}
          label="Stop"
        />
      ) : (
        <CommandButton
          size="sm"
          handle={handles.start}
          args={args}
          commandLabel={`Start ${title}`}
          label="Start"
        />
      )}
    </Inline>
  );
}
