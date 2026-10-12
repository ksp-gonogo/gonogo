export const wantsHelp = (argv: readonly string[]): boolean =>
  argv.includes("--help") || argv.includes("-h");

export interface FlagSpec {
  verb: string;
  usage: string;
  /** Flags that take the next argument as their value. */
  values?: readonly string[];
  /** Flags that take no value. */
  switches?: readonly string[];
  /** How many bare arguments the verb accepts. */
  positionals?: number;
}

export interface ParsedFlags {
  values: Map<string, string>;
  switches: Set<string>;
  positionals: string[];
}

/**
 * One `uplink-tools` verb's arguments, split into flag values, switches and
 * positional words. It throws on any flag the verb does not read: a flag that
 * belongs to another verb is the likeliest typo, and ignoring it would run a
 * command that looks right and does something else. Useful for telling the
 * author at once that they typed the wrong flag. Used by every `uplink-tools`
 * command that takes flags.
 */
export function parseFlags(
  argv: readonly string[],
  spec: FlagSpec,
): ParsedFlags {
  const valued = new Set(spec.values ?? []);
  const switched = new Set(spec.switches ?? []);
  const parsed: ParsedFlags = {
    values: new Map(),
    switches: new Set(),
    positionals: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (valued.has(arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} needs a value\n\n${spec.usage}`);
      }
      parsed.values.set(arg, value);
      continue;
    }
    if (switched.has(arg)) {
      parsed.switches.add(arg);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(
        `${arg} is not an option of ${spec.verb}\n\n${spec.usage}`,
      );
    }
    parsed.positionals.push(arg);
  }
  if (parsed.positionals.length > (spec.positionals ?? 0)) {
    throw new Error(
      `${spec.verb} does not take "${parsed.positionals[spec.positionals ?? 0]}"\n\n${spec.usage}`,
    );
  }
  return parsed;
}
