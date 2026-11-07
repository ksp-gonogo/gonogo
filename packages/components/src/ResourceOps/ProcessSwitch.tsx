import type { CommandReply } from "@ksp-gonogo/sitrep-sdk";
import { Button, type CommandButtonHandle, Inline } from "@ksp-gonogo/ui-kit";

export type ProcessSwitchHandles = Readonly<{
  start: CommandButtonHandle<CommandReply<"vessel.converter.start">>;
  stop: CommandButtonHandle<CommandReply<"vessel.converter.stop">>;
}>;

/**
 * The start or stop control for one drill or converter: the opposite of the
 * state it is in. Drawn only for a unit that has a part id and a run state
 * that is current, so a held channel or an unread state offers neither. A
 * unit carrying a provider extension bag comes from a modelling mod's own
 * backend, whose units the stock converter command cannot resolve, so it
 * offers neither either.
 */
export function ProcessSwitch({
  handles,
  partId,
  converterName,
  title,
  running,
  held,
  extensions,
}: Readonly<{
  handles: ProcessSwitchHandles;
  partId: string | null | undefined;
  converterName: string | null | undefined;
  title: string;
  running: boolean | null | undefined;
  held: boolean;
  extensions?: Readonly<Record<string, unknown>> | null;
}>) {
  if (extensions != null && Object.keys(extensions).length > 0) {
    return null;
  }
  if (held || !partId || running === null || running === undefined) {
    return null;
  }
  const args = { partId, converterName: converterName || undefined };
  return (
    <Inline>
      {running ? (
        <Button
          size="sm"
          variant="ghost"
          command={handles.stop.with(args, { label: `Stop ${title}` })}
        >
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          command={handles.start.with(args, { label: `Start ${title}` })}
        >
          Start
        </Button>
      )}
    </Inline>
  );
}
