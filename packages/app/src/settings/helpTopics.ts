import {
  LOCAL_APP_URL,
  MOD_LOG_COMMAND,
  SETUP_LINKS,
} from "../firstRun/setupGuide";

/** One block of a help topic: a paragraph, a list, or a command to copy. */
export type HelpBlock =
  | { kind: "text"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "link"; label: string; href: string }
  | { kind: "command"; command: string; label: string };

export interface HelpTopic {
  id: string;
  title: string;
  blocks: readonly HelpBlock[];
}

const text = (value: string): HelpBlock => ({ kind: "text", text: value });
const list = (...items: string[]): HelpBlock => ({ kind: "list", items });

/*
 * The install topic leads with CKAN and gives the zip from the releases page as
 * the fallback for a mod CKAN does not list.
 */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "mods",
    title: "Which mod you need",
    blocks: [
      text(
        "Gonogo is built for KSP 1.12. One mod is required: the Gonogo mod.",
      ),
    ],
  },
  {
    id: "install",
    title: "Installing the Gonogo mod",
    blocks: [
      text(
        "Mods go in the GameData folder of your KSP install. On Steam, right-click Kerbal Space Program in your library, then Manage, then Browse local files. Inside you will see GameData with Squad already in it.",
      ),
      text(
        "The easiest way to install the Gonogo mod is CKAN, a mod manager for KSP: install CKAN by following its own guide, then search it for Gonogo and install it.",
      ),
      text(
        "If CKAN does not list it, download the Gonogo zip from the releases page, unzip it and copy the folders inside its GameData into your own GameData, so that Squad and Gonogo sit side by side. You never replace your GameData folder. To reinstall or update a mod, delete its folder first and copy the new one in, rather than copying over the old one.",
      ),
      {
        kind: "link",
        label: "Gonogo releases page",
        href: `${SETUP_LINKS.source}/releases`,
      },
      text(
        "The mod listens on port 8090 on every network interface, with no password, and that port accepts commands that act on your game. Keep it to a network you trust and do not forward it to the internet.",
      ),
    ],
  },
  {
    id: "connect",
    title: "Connecting to KSP on another computer",
    blocks: [
      text(
        "In Settings, Connection, press the gear on the Telemetry stream row and set Host to the KSP computer's address. Run setup again, on the same page, shows how to find the address. The firewall on the KSP computer must accept incoming connections on port 8090.",
      ),
    ],
  },
  {
    id: "checks",
    title: "Checking telemetry is arriving",
    blocks: [
      text(
        "1. Did the mod start? Search KSP.log in your KSP install folder for the mod's lines:",
      ),
      {
        kind: "command",
        command: MOD_LOG_COMMAND.posix,
        label: "mod log command",
      },
      {
        kind: "command",
        command: MOD_LOG_COMMAND.windows,
        label: "Windows mod log command",
      },
      text(
        'A working start prints a line beginning "[Gonogo] Started". No Gonogo lines at all means KSP never loaded the mod: check that GameData/Gonogo/Plugins exists and holds every DLL it shipped with. A line beginning "[Gonogo] Failed to start" is followed by the reason, and a port already in use is the usual one.',
      ),
      text(
        "2. Does the app say it is connected? Under Connection, the Telemetry stream row reads CONNECTED from the KSP main menu on. Anything else with a started mod means a wrong Host or a firewall on the KSP computer. Windows and macOS both block incoming local-network connections by default.",
      ),
      text(
        "3. Does a widget draw? Load any save and add Tracking Station, which needs no vessel. If it draws, the stream is arriving.",
      ),
    ],
  },
  {
    id: "empty",
    title: "Connected, but vessel widgets stay empty",
    blocks: [
      list(
        "No craft in flight. Vessel data is sent only in the flight scene, with a craft under your control",
        "No signal. With CommNet on, a craft with no connection to a command centre sends no telemetry until it has one",
      ),
    ],
  },
  {
    id: "stations",
    title: "Adding a station screen",
    blocks: [
      text(
        "A station is another device, such as a tablet or a phone, that shows its own dashboard from this screen.",
      ),
      text(
        "Open the green menu button in the bottom-right corner and press Add station. That window has the link to open on the other device.",
      ),
    ],
  },
  {
    id: "controls",
    title: "Physical controls",
    blocks: [
      text(
        "Each screen keeps its own input devices, in Settings, Devices. The keyboard is always there. To bind a control, open a widget's settings, go to Inputs, press Bind and then press the key, button or axis.",
      ),
      text(
        "To allow USB serial on a plain http address you trust, open this page in Chrome, add the address to the list on it and relaunch Chrome. It turns off a browser protection for that address, so use it only for your own network.",
      ),
      {
        kind: "command",
        command: "chrome://flags/#unsafely-treat-insecure-origin-as-secure",
        label: "Chrome page to copy into the address bar",
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    blocks: [
      text(
        "Ctrl on Windows and Linux, Cmd on a Mac. They do nothing while you are typing in a field or a dialog is open.",
      ),
      list(
        "Ctrl or Cmd with Z: undo the last layout change or layout switch",
        "Ctrl or Cmd with Shift and Z, or Ctrl with Y: redo it",
        "Ctrl or Cmd with K: open Add widget",
        "Ctrl or Cmd with /: open Help",
        "In Add widget: Up, Down, Home and End move through the list, Shift and Enter ticks or unticks a widget, Enter adds every ticked widget (or the highlighted one when none is ticked), Escape closes",
      ),
    ],
  },
  {
    id: "delay",
    title: "Signal delay",
    blocks: [
      text(
        "Signal delay is a setting of each save, in the Gonogo section of the game's Difficulty settings. With the game's CommNet option disabled, every craft counts as connected and nothing is delayed.",
      ),
    ],
  },
  {
    id: "report",
    title: "Reporting a problem",
    blocks: [
      text(
        "The guide says what a bug report needs and where to find each part.",
      ),
      {
        kind: "link",
        label: "Reporting a problem",
        href: SETUP_LINKS.reporting,
      },
    ],
  },
  {
    id: "app",
    title: "Running the app",
    blocks: [
      text(
        `The app is served by the Gonogo container at ${LOCAL_APP_URL}. Run setup again, in Settings, Connection, checks the app and the KSP connection.`,
      ),
    ],
  },
];
