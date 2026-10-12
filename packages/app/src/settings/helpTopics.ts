import {
  ADDRESS_COMMAND,
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
 * The mod is not published to a mod manager yet, so the install topic describes
 * the zip from the releases page and no other route. When a listing exists this
 * is the one place that gains the mod-manager step.
 */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "mods",
    title: "Which mod you need",
    blocks: [
      text(
        "Gonogo is built for KSP 1.12. One mod is required: the Gonogo mod, which streams the game's telemetry, career state, science and comms to this app over one WebSocket on port 8090.",
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
        "Download the Gonogo zip from the releases page, unzip it and copy the folders inside its GameData into your own GameData, so that Squad and Gonogo sit side by side. You never replace your GameData folder. To reinstall or update a mod, delete its folder first and copy the new one in, rather than copying over the old one.",
      ),
      {
        kind: "link",
        label: "Gonogo releases page",
        href: `${SETUP_LINKS.source}/releases`,
      },
      text(
        "The mod is not in a mod manager yet, so the zip is the only route, and until a release carries it there is nothing to download.",
      ),
      text(
        "The mod loads before the main menu and stays loaded across scene changes, so a dashboard can connect from the main menu. Data starts flowing once a save is loaded. It listens on every network interface at port 8090, with no password, and that port accepts commands that act on your game. Keep it to a network you trust and do not forward it to the internet. A friend elsewhere joins with the share code from Add station instead.",
      ),
    ],
  },
  {
    id: "connect",
    title: "Connecting to KSP on another computer",
    blocks: [
      text(
        "The browser you opened this screen in connects to the game directly, so the address you give it must be reachable from this computer, and the firewall that matters is the one on the KSP computer. It must accept incoming connections on port 8090.",
      ),
      text(
        "KSP pauses when its window is not in front, so with both on one computer the dashboard stops getting data whenever you switch to it. A second computer avoids that.",
      ),
      text(
        "Set the address under Connection, Game host: press the gear on the Telemetry stream row, set Host to the KSP computer's address and press Save. It takes effect at once. To find the KSP computer's address, run the command for its system on that computer:",
      ),
      {
        kind: "command",
        command: ADDRESS_COMMAND.windows,
        label: "Windows address command",
      },
      {
        kind: "command",
        command: ADDRESS_COMMAND.macos,
        label: "macOS address command",
      },
      {
        kind: "command",
        command: ADDRESS_COMMAND.linux,
        label: "Linux address command",
      },
      text(
        "The address usually starts 192.168. or 10. Station screens need none of this: a station gets everything from the main screen and never talks to KSP.",
      ),
    ],
  },
  {
    id: "checks",
    title: "Checking telemetry is arriving",
    blocks: [
      text(
        "Work down these in order: each one tells you which half of the path is broken.",
      ),
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
        "2. Does the app say it is connected? Under Connection, the Telemetry stream row reads CONNECTED once the browser has an open socket to the mod. Expect that from the main menu, before any save is loaded. DISCONNECTED, ERROR or RECONNECTING with a started mod means the problem is between the two computers: a wrong Host, or a firewall on the KSP computer. Windows and macOS both block incoming local-network connections by default.",
      ),
      text(
        "3. Does a widget draw? Load any save, then add System View from the Add a widget button. It draws from the bodies alone, with no vessel and no flight scene. If it draws, the stream is arriving.",
      ),
    ],
  },
  {
    id: "empty",
    title: "Connected, but vessel widgets stay empty",
    blocks: [
      text(
        "The connection is working and the game has nothing about a craft to send yet. There are two causes:",
      ),
      list(
        "No craft in flight. Vessel data is sent only in the flight scene, with a craft under your control. The Space Center, Tracking Station and editor send the bodies and nothing about a vessel. Launch something, or switch to a craft already in flight, and give the app a few seconds",
        "No signal. With CommNet on, the mod holds back a craft's telemetry while it has no connection to a command centre, as mission control would lose it. A craft with no antenna, out of range of every ground station or behind a body delivers nothing. Its widgets say they are waiting if nothing has arrived since the page opened, or keep the last value and mark it as held. Get it a link, through the KSC or a relay, and the widgets fill in",
      ),
    ],
  },
  {
    id: "stations",
    title: "Adding a station screen",
    blocks: [
      text(
        "A station is any other browser that joins the session: a tablet, a phone, a second laptop. It never talks to KSP. It gets everything through this screen's browser tab, so a station works only while this tab stays open and awake.",
      ),
      text(
        "Hover the + button in the bottom-right corner, or Tab to it, and press Add station. The window shows a six-character share code, as a link and as a QR code. On the other device scan the QR code or open the link and it connects with nothing to type. Otherwise open the station page and type the code on the Connect to Mission Control screen.",
      ),
      text(
        "The station remembers the code and reconnects by itself while this tab is open. New share code in the same window drops every connected station, and they all need the new code.",
      ),
      text(
        "Both devices need internet access, even on the same WiFi, because the two browsers meet through a public broker before they connect directly. The broker carries no telemetry.",
      ),
    ],
  },
  {
    id: "station-trouble",
    title: "A station will not connect",
    blocks: [
      text(
        "Work down these in order. The station's own status line says which applies.",
      ),
      list(
        "Can't reach the peer broker: the station has no internet route. Load any website on it, and check it is not on a guest network or a captive portal that blocks outbound connections",
        "Broker doesn't know that code: check the code against the Add station window, that this tab is still open and awake, and that the code was not regenerated",
        "Reconnecting after a working session: this screen went away, by refresh, sleep or restart. A station retries by itself for five minutes",
        "Connects, then fails to open a channel: guest and public WiFi often block device-to-device traffic. Put both devices on your normal network",
        "The station's connect screen has a Download logs button, and the lines beginning [PeerClient] name the code being targeted and the reason for each retry",
      ),
      text(
        "A station on another network, such as a phone on cellular, also needs a relay with forwarded ports, described in the networking guide on the project page.",
      ),
    ],
  },
  {
    id: "app",
    title: "Running the app",
    blocks: [
      text(
        `The app is served by the Gonogo container at ${LOCAL_APP_URL}. Settings, Connection, Run setup again re-opens the first-run checks for the container and the KSP connection.`,
      ),
    ],
  },
];
