/*
 * Every sentence, label and heading the first-run setup shows an operator,
 * keyed `step.field`. The steps render from here and spell none of their own,
 * so the whole wizard's wording is read, reviewed and rewritten in one place:
 * the review sheet lists each key as a prose item, and `prose-apply` writes an
 * edited export back into this table.
 *
 * Commands and addresses are not copy. They are data, in `setupGuide.ts`.
 *
 * A value is one plain string literal, which is what lets a script rewrite it.
 * Three marks are read inside it:
 *
 *   {name}             a value the step fills in
 *   {name?one|other}   `one` when that value is 1, `other` when it is not
 *   [words](link)      `words` as a link to `SETUP_LINKS[link]`
 */

export const WIZARD_COPY = {
  "shell.title": "Set up Gonogo",
  "shell.stepHeading": "Step {index} of {total}: {heading}",
  "shell.back": "Back",

  "welcome.heading": "Welcome",
  "welcome.advance": "Setup",
  "welcome.parts":
    "Gonogo has two parts: this app, which runs in a container, and the Gonogo mod, which runs inside KSP and sends the game's data to it.",
  "welcome.steps":
    "The next steps check the container, the connection to KSP and for any installed Uplinks.",

  "container.heading": "Start the app",
  "container.advance": "Connect to KSP",
  "container.instruction":
    "In a terminal, start the Gonogo container. It serves this app and the relay that lets other screens join yours. You can change `{tag}` to a specific version if you want.",
  "container.runCommandLabel": "run command",
  "container.powershellNote":
    "Written for PowerShell. If you're using Command Prompt, type ^ in place of the ` that ends each line.",
  "container.check.checking": "Checking the app at {url}",
  "container.check.pass": "The app is running",
  "container.check.fail": "No answer from the app at {url}",
  "container.hint.status":
    "This checks again every few seconds. To see if the app is running:",
  "container.statusCommandLabel": "app status command",
  "container.hint.fix":
    "If that lists no container, run the command above. If it lists one, port 3002 was not published: remove it and run the command above again, unchanged. The [networking guide](relayPorts) covers configuring ports.",
  "container.recheck": "Check again",

  "connect.heading": "Connect to KSP",
  "connect.advance": "Check Uplinks",
  "connect.instruction":
    "Start KSP with the Gonogo mod installed and wait for the main menu. If KSP runs on another computer, press the gear below and set Host to its IP address.",
  "connect.twoComputers":
    "By default, KSP will not run when minimised. If that's an issue for you, check that settings.cfg in the KSP install folder has the line SIMULATE_IN_BACKGROUND = True, or keep the dashboard on a second screen or device.",
  "connect.confirm":
    'To confirm the mod started, run this in your KSP install folder. It prints a line beginning "[Gonogo] Started". If nothing appears, try the previous step again.',
  "connect.logCommandLabel": "mod log command",
  "connect.hint.address":
    "To find the KSP computer's address, run the command:",
  "connect.address.windows": "On Windows, look for IPv4 Address:",
  "connect.address.macos": "On macOS:",
  "connect.address.linux": "On Linux, look for inet on your active connection:",
  "connect.addressCommandLabel": "address command",
  "connect.check.pass": "Connected to KSP at {address}",
  "connect.check.checking": "Trying to reach KSP at {address}",
  "connect.check.fail": "Not connected to KSP at {address}",
  "connect.check.retrying":
    "No answer from KSP at {address} yet. Still trying.",
  "connect.hint.notRunning":
    "KSP may not be running yet: start it and wait for the main menu",
  "connect.hint.notInstalled":
    "The command above prints nothing: the mod is not installed. The [KSP setup guide](kspSetup) covers installing it",
  "connect.hint.blocked":
    'The command prints "[Gonogo] Started" and this still fails: the Host is wrong, or a firewall on the KSP computer is blocking port 8090. See the [networking guide](networking)',

  "uplinks.heading": "Uplinks",
  "uplinks.advance": "Review setup",
  "uplinks.check.waiting":
    "Waiting for the mod to list its Uplinks. This needs the KSP connection.",
  "uplinks.check.noConnection":
    "Not connected to KSP, so the mod cannot list its Uplinks. Fix the connection on the Connect to KSP step",
  "uplinks.check.none": "No Uplinks installed. If this is expected, continue.",
  "uplinks.check.allWorking":
    "{installed} {installed?Uplink|Uplinks} installed, all reporting healthy",
  "uplinks.check.attention":
    "{installed} {installed?Uplink|Uplinks} installed, {attention} {attention?needs|need} attention",
  "uplinks.summary":
    "Client loaded for {loaded} of {installed} {installed?Uplink|Uplinks} that {installed?has|have} one",
  "uplinks.summaryRefused":
    "{summary}; {refused} refused due to a contract mismatch",
  "uplinks.find.label": "Find Uplinks",
  "uplinks.find.search":
    "Uplinks are add-ons that integrate Gonogo with other mods. In CKAN, search for:",
  "uplinks.find.searchLabel": "CKAN search",
  "uplinks.hint.attention":
    "Open each Uplink marked as needing attention and read the reason it gives. Settings, Uplinks, shows the same readings.",
  "uplinks.row.version": "v{version}",
  "uplinks.row.contractMismatch":
    "Built for contract {declared}; this mod needs {core}. The mod refused it, so none of its channels or commands are running.",
  "uplinks.row.loaded": "Client loaded",
  "uplinks.row.loading": "Client loading",
  "uplinks.row.quarantined": "Client quarantined",
  "uplinks.row.refused": "Refused: contract mismatch",
  "uplinks.row.unavailable": "Mod reports unavailable",
  "uplinks.row.noClient": "No client loaded",
  "uplinks.row.modOnly": "Adds data, no widgets",
  "uplinks.row.details": "Details",

  "health.heading": "Health check",
  "health.advance": "Next",
  "health.fix": "Go back to a step to fix what it reports.",
  "health.verdict.checking": "Checking your setup",
  "health.verdict.allWorking": "Everything is working",
  "health.verdict.needLook": "{bad} of {total} checks {bad?needs|need} a look",
  "health.row.container": "App",
  "health.row.connection": "KSP connection",
  "health.row.uplinks": "Uplinks",
  "health.hint.log":
    "The app's own log usually says why something is not working:",
  "health.logCommandLabel": "app log command",
  "health.hint.guides":
    "Settings, Help, has more checks for the KSP side. For KSP on another computer, see the [networking guide](networking).",
  "health.hint.uplinks":
    "Gonogo will still function but some Uplinks need attention before they can work. Each listing comes from an Uplink.",

  "done.heading": "Done",
  "done.advance": "Finish",
  "done.next":
    "Load a save in KSP, then press the + button in the bottom-right corner of the dashboard to add widgets.",
  "done.settings":
    "This setup opens by itself once. Settings, behind the same + button, keeps the same readings: the KSP connection under Connection and each Uplink under Uplinks. Run setup again, under Connection, reopens it.",

  "settings.heading": "Setup",
  "settings.label": "First-run setup",
  "settings.description":
    "Open the setup again. It checks the app, the connection to KSP and your Uplinks.",
  "settings.action": "Run setup again",
} as const;

export type CopyKey = keyof typeof WIZARD_COPY;

type Value = string | number;

/** The names a string's `{name}` and `{name?one|other}` marks ask for. */
type Names<S extends string> = S extends `${string}{${infer Mark}}${infer Rest}`
  ? (Mark extends `${infer Name}?${string}` ? Name : Mark) | Names<Rest>
  : never;

/**
 * What a call must pass for one key: every name its string asks for. A name the
 * string does not use is allowed, so a rewrite that drops a value from a
 * sentence compiles, while one that asks for a value no step supplies does not.
 */
type Values<K extends CopyKey> = [Names<(typeof WIZARD_COPY)[K]>] extends [
  never,
]
  ? [values?: Record<string, Value>]
  : [
      values: Record<Names<(typeof WIZARD_COPY)[K]>, Value> &
        Record<string, Value>,
    ];

const MARK = /\{(\w+)(?:\?([^|}]*)\|([^}]*))?\}/g;
const LINK = /\[([^\]]+)\]\((\w+)\)/g;

function fill(template: string, values: Record<string, Value>): string {
  return template.replace(MARK, (mark, name: string, one, other) => {
    const value = values[name];
    if (value === undefined) return mark;
    if (one === undefined) return String(value);
    return value === 1 ? one : other;
  });
}

/** A run of a sentence: plain words, or words that link to `SETUP_LINKS[link]`. */
export interface CopyRun {
  text: string;
  link?: string;
}

/** A sentence in the table's marks, with these values filled in, as the runs a step draws. */
export function runsOf(
  template: string,
  values: Record<string, Value> = {},
): CopyRun[] {
  const out: CopyRun[] = [];
  let at = 0;
  for (const match of template.matchAll(LINK)) {
    if (match.index > at)
      out.push({ text: fill(template.slice(at, match.index), values) });
    out.push({ text: fill(match[1], values), link: match[2] });
    at = match.index + match[0].length;
  }
  if (at < template.length)
    out.push({ text: fill(template.slice(at), values) });
  return out;
}

/** One key's sentence with its values filled in, as the runs a step draws. */
export function runs<K extends CopyKey>(
  key: K,
  ...[values]: Values<K>
): CopyRun[] {
  return runsOf(WIZARD_COPY[key], values);
}

/** One key's sentence with its values filled in, a link reduced to its words. */
export function say<K extends CopyKey>(key: K, ...values: Values<K>): string {
  return runs(key, ...values)
    .map((run) => run.text)
    .join("");
}
