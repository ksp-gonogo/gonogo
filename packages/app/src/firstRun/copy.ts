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
  "welcome.advance": "Get started",
  "welcome.parts":
    "Gonogo has two parts: this app, which runs in a container on your computer, and the Gonogo mod, which runs inside KSP and sends the game's data to it.",
  "welcome.steps":
    "The next steps check the container, the connection to KSP and any Uplinks. A step only tells you what to do if something is not ready.",
  "welcome.noBlock":
    "No step blocks the next, so you can carry on and come back later.",

  "container.heading": "Start the container",
  "container.advance": "Connect to KSP",
  "container.instruction":
    "Start the Gonogo container. It serves this app and the relay that lets other screens join yours. The command ends with the image tag of this build, {tag}.",
  "container.runCommandLabel": "run command",
  "container.powershellNote":
    "Written for PowerShell, the default terminal on Windows. In Command Prompt, type ^ in place of the ` that ends each line.",
  "container.check.checking": "Checking the container at {url}",
  "container.check.pass": "The container is running",
  "container.check.fail": "No answer from the container at {url}",
  "container.hint.status":
    "This checks again every few seconds. To see if the container is running:",
  "container.statusCommandLabel": "container status command",
  "container.hint.fix":
    "If that lists no container, run the command above. If it lists one, port 3002 was not published: remove it and run the command above again, unchanged. The [networking guide](relayPorts) covers the ports.",
  "container.recheck": "Check again",

  "connect.heading": "Connect to KSP",
  "connect.advance": "Check Uplinks",
  "connect.instruction":
    "Start KSP with the Gonogo mod installed and wait for the main menu. If KSP runs on another computer, press the gear below and set Host to its address.",
  "connect.twoComputers":
    "Optional tip: if KSP pauses when its window is not in front, the dashboard stops updating while you look at it. With KSP closed, check that settings.cfg in the KSP install folder has the line SIMULATE_IN_BACKGROUND = True, or keep the dashboard on a second screen or device.",
  "connect.trust":
    "Port 8090 has no password and accepts commands that fly your ship. Keep it to a network you trust and never forward it to the internet.",
  "connect.confirm":
    'To confirm the mod started, run this in your KSP install folder. It prints a line beginning "[Gonogo] Started".',
  "connect.logCommandLabel": "mod log command",
  "connect.hint.address":
    "To find the KSP computer's address, run the command for its system on that computer. The address usually starts 192.168. or 10.",
  "connect.address.windows": "On Windows, look for IPv4 Address:",
  "connect.address.macos": "On macOS:",
  "connect.address.linux":
    "On Linux or a Steam Deck, look for inet on your active connection:",
  "connect.addressCommandLabel": "address command",
  "connect.check.pass": "Connected to KSP at {address}",
  "connect.check.checking": "Trying to reach KSP at {address}",
  "connect.check.fail": "Not connected to KSP at {address}",
  "connect.check.retrying":
    "No answer from KSP at {address} yet. Still trying, and this turns green when it connects",
  "connect.hint.notRunning":
    "KSP is not running yet: start it and wait for the main menu",
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
  "uplinks.check.none":
    "No Uplinks installed, which is fine: they are optional",
  "uplinks.check.allWorking":
    "{installed} {installed?Uplink|Uplinks} installed, all working",
  "uplinks.check.attention":
    "{installed} {installed?Uplink|Uplinks} installed, {attention} {attention?needs|need} attention",
  "uplinks.summary":
    "{loaded} of {installed} installed {installed?Uplink has|Uplinks have} a loaded client",
  "uplinks.summaryRefused":
    "{summary}; {refused} refused for a contract mismatch",
  "uplinks.find.label": "Find Uplinks",
  "uplinks.find.search":
    "Uplinks are add-ons that connect Gonogo to other mods. In CKAN, search for:",
  "uplinks.find.searchLabel": "CKAN search",
  "uplinks.find.devReleases":
    "If that finds none, allow development releases in CKAN's settings. The [CKAN user guide](ckanUserGuide) covers installing.",
  "uplinks.hint.attention":
    "A row that is not working says why. Settings, Uplinks, has the same readings.",
  "uplinks.row.version": "v{version}",
  "uplinks.row.contractMismatch":
    "Built for contract {declared}; this mod speaks {core}. The mod refused it, so none of its channels or commands are running.",
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
  "health.row.container": "Container",
  "health.row.connection": "KSP connection",
  "health.row.uplinks": "Uplinks",
  "health.hint.log":
    "The container's own log usually says why something is not working:",
  "health.logCommandLabel": "container log command",
  "health.hint.guides":
    "Settings, Help, has more checks for the KSP side. For KSP on another computer, see the [networking guide](networking).",
  "health.hint.uplinks":
    "Each row on the Uplinks step says why. Uplinks are optional, so Gonogo still works.",

  "done.heading": "Done",
  "done.advance": "Finish",
  "done.next":
    "Load a save in KSP, then press the + button in the bottom-right corner of the dashboard to add widgets.",
  "done.settings":
    "This setup opens by itself once. Settings, behind the same + button, keeps the same readings: the KSP connection under Connection and each Uplink under Uplinks. Run setup again, under Connection, reopens it.",

  "settings.heading": "Setup",
  "settings.label": "First-run setup",
  "settings.description":
    "Open the setup again. It checks the container, the connection to KSP and your Uplinks.",
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
