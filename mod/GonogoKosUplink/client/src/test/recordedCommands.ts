import type { GeneratedCommandArgsMap } from "../__generated__/command-map";

/** A dispatch record with this Uplink's own args type in place of `unknown`. */
type Typed<R, C extends keyof GeneratedCommandArgsMap> = Omit<
  R,
  "command" | "args"
> & { command: C; args: GeneratedCommandArgsMap[C] };

/**
 * Every dispatch of `command`, in order, with its args typed by this Uplink's
 * generated args map, so a contract change breaks the test that reads them.
 *
 * A transport carries every Uplink's commands and cannot know whose it is
 * holding, so it records `args` as `unknown`. The one step from there to this
 * Uplink's own map is here, and no test takes it.
 */
export function sentCommands<
  C extends keyof GeneratedCommandArgsMap,
  R extends { command: string; args: unknown },
>(commands: readonly R[], command: C): Typed<R, C>[] {
  return commands.filter(
    (entry): entry is R & Typed<R, C> => entry.command === command,
  );
}

/** The first dispatch of `command`, or `undefined` if none was made. */
export function sentCommand<
  C extends keyof GeneratedCommandArgsMap,
  R extends { command: string; args: unknown },
>(commands: readonly R[], command: C): Typed<R, C> | undefined {
  return sentCommands(commands, command)[0];
}

/**
 * Record a dispatch with its args typed by this Uplink's generated args map.
 *
 * Typing at the PUSH rather than at each read, for a test that keeps a handle
 * on the array and waits for it to fill: a filtered copy is a snapshot, and a
 * `waitFor` over one never sees the dispatch it is waiting for.
 */
export function recordDispatch<C extends keyof GeneratedCommandArgsMap>(
  into: Array<{ command: string; args: GeneratedCommandArgsMap[C] }>,
  command: string,
  args: unknown,
): void {
  into.push({ command, args } as {
    command: string;
    args: GeneratedCommandArgsMap[C];
  });
}
