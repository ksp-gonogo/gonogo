/**
 * The flags `pnpm dev` takes, turned into the environment the dev server reads.
 *
 * `scripts/dev.sh` runs this before it touches podman, so a mistyped flag stops
 * the stack from starting rather than being noticed after the relay is up.
 *
 * Exit codes: 0 with a shell statement on stdout to `eval`, 10 with the usage on
 * stdout for `--help` (nothing should start), 2 with the problem on stderr.
 */

import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEV_USAGE = `pnpm dev [--uplink <path>]...

  --uplink <path>   serve an Uplink you are building into this app. <path> is
                    the Uplink's directory, the one holding uplink.json. Repeat
                    the flag for several. The app loads each one's own build
                    output (run \`gonogo-uplink bundle --watch\` in its client)
                    and reloads the page when it is rebuilt
  --help            print this and exit`;

/**
 * @param {readonly string[]} argv
 * @param {string} cwd where the command was typed, which relative paths are against
 * @returns {{ uplinks: string[] } | { help: string } | { error: string }}
 */
export function parseDevArgs(argv, cwd) {
  const uplinks = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: DEV_USAGE };
    if (arg === "--uplink") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: `--uplink needs a path\n\n${DEV_USAGE}` };
      }
      uplinks.push(isAbsolute(value) ? value : resolve(cwd, value));
      i++;
      continue;
    }
    return { error: `unknown flag ${arg}\n\n${DEV_USAGE}` };
  }
  return { uplinks };
}

const shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // pnpm runs a root script from the root, so INIT_CWD is where the author typed it.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const parsed = parseDevArgs(process.argv.slice(2), cwd);
  if ("help" in parsed) {
    console.log(parsed.help);
    process.exit(10);
  }
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(2);
  }
  console.log(
    `export GONOGO_LOCAL_UPLINKS=${shellQuote(parsed.uplinks.join("\n"))}`,
  );
}
