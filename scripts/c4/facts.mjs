/**
 * Hand-written facts for the C4 model: what the code cannot say on its own.
 *
 * Everything else in the diagram is read from the tree by `generate.mjs`. This
 * file holds the descriptions of people and outside services, a one-line
 * purpose for each derived element where its name is not enough, and the
 * relationships that are runtime behaviour rather than an import (which arrow
 * carries telemetry, which carries commands, which is signalling).
 *
 * Every element id named here must exist in the generated model, or the
 * generator stops and names it: a rename in the code then shows up as a
 * failed run, never as an arrow quietly pointing at nothing.
 */

/** People who use or extend the system. */
export const people = {
  operator: {
    title: "Operator",
    description:
      "Plays KSP and runs the mission from the main screen on the same machine",
  },
  crew: {
    title: "Station crew",
    description:
      "Friends on their own devices, on the LAN or across the internet, each running a station screen",
  },
  author: {
    title: "Uplink author",
    description:
      "Writes an Uplink for another KSP mod: a C# half for the game and a client half of widgets",
  },
};

/** Outside services and systems, keyed by element id. */
export const externals = {
  ksp: {
    title: "Kerbal Space Program",
    technology: "Unity, Mono",
    description:
      "The game. The Gonogo mod and every Uplink's C# half load into its one process",
  },
  broker: {
    title: "PeerJS broker",
    technology: "0.peerjs.com, WSS",
    description:
      "Public signalling server. Stations find the main screen through it; it carries no telemetry",
  },
  stun: {
    title: "Public STUN servers",
    technology: "stun.l.google.com:19302, stun.cloudflare.com:3478",
    description:
      "Google and Cloudflare. Each tells a device its public address and port at join time, so two devices can open a direct internet path. Two providers, so one being down does not take that path with it",
  },
  cdn: {
    title: "jsDelivr CDN",
    technology: "HTTPS",
    description:
      "Serves released Uplink client bundles from the gonogo-uplinks repository",
  },
  npm: {
    title: "npm registry",
    description: "Hosts the three published packages an Uplink author installs",
  },
  nugetOrg: {
    title: "nuget.org",
    description:
      "Hosts KspGonogo.Sitrep.Contract, the one package an Uplink's C# half references",
  },
  ckan: {
    title: "CKAN and SpaceDock",
    description: "Where players install the Gonogo mod and its Uplinks",
  },
  devDocs: {
    title: "Uplink developer docs",
    technology: "GitHub Pages",
    description:
      "The author-facing site at /uplink-dev-docs/, built from its own repository",
  },
  axiom: {
    title: "Axiom",
    technology: "HTTPS",
    description:
      "Log store. Only builds with a token ship to it, and only with the operator's consent",
  },
};

/** Children of the KSP element that are not wrapped mods. */
export const kspParts = {
  stock: {
    title: "Stock game",
    description: "Vessels, orbits, CommNet, career, science and the rest",
  },
  breakingGround: {
    title: "Breaking Ground DLC",
    description: "Robotic parts and deployed surface science",
  },
  makingHistory: {
    title: "Making History DLC",
    description: "Mission builder and its stock missions",
  },
};

/** The Uplinks that wrap a DLC rather than a separate mod (their uplink.json has no `mod`). */
export const uplinkWraps = {
  breakingGround: "ksp.breakingGround",
  makingHistory: "ksp.makingHistory",
};

/** Containers inside the gonogo system that have no package of their own to read. */
export const containers = {
  main: {
    title: "Main screen",
    technology: "React SPA in a browser, route /",
    description:
      "The one consumer of the Sitrep stream. Hosts the dashboard and shares data with every station",
  },
  station: {
    title: "Station screen",
    technology: "Same SPA build, route /station",
    description:
      "A peer of the main screen with its own layout in localStorage. Never talks to KSP",
  },
  relay: {
    title: "Relay container",
    technology: "Node, Fastify, coturn, one container",
    description:
      "Hands out TURN credentials and runs the TURN server for stations with no direct path. The all-in-one bundle image also runs a static server for the app on :8080",
  },
  mod: {
    title: "Gonogo mod",
    technology: "C#, GameData/Gonogo, codename Sitrep",
    description:
      "Runs inside KSP, samples game state, applies commands, and streams Topics over a WebSocket",
  },
  site: {
    title: "Website",
    technology: "GitHub Pages, ksp-gonogo.github.io",
    description:
      "The landing page, the release app at /app/ and the release candidate at /rc/",
  },
  devtools: {
    title: "Development tooling",
    technology: "TS and C#, never shipped",
    description:
      "Storybook, test helpers, the TS reference ports behind the golden fixtures, and the mod's analysis tools",
  },
};

/**
 * One-line purposes, keyed by the generated element id (relative to the
 * gonogo system). Anything not listed falls back to its package description
 * or its source path.
 */
export const describe = {
  "main.app":
    "The app shell: screens, the peer host, the telemetry provider, the Uplink loader and settings",
  "main.components":
    "The built-in widget library; every widget self-registers on import",
  "main.core":
    "Plugin registry, shared types, React contexts, the GO/NO-GO system",
  "main.data":
    "Series reads over the telemetry store, for plots and sparklines",
  "main.logger": "ConsoleLogger, the log ring buffer and the tag registry",
  "main.serial":
    "Serial, gamepad and keyboard input mapped onto widget actions",
  "main.sitrepClient": "The app-side spine and hooks over the Sitrep stream",
  "main.theme": "The typed theme contract and the default dark theme",
  "main.ui": "Dashboard chrome, settings-modal furniture, peer banners",
  "main.app.alarms": "Alarm clock and its peer-shared alarm state",
  "main.app.analytics": "Analytics consent",
  "main.app.backup": "Export and import of the whole saved setup",
  "main.app.commcast": "Addressed broadcast of messages to stations",
  "main.app.components": "App-level panels and modals",
  "main.app.dataSources":
    "The Sitrep Stream data source and its host seed from the relay",
  "main.app.firstRun": "First-run setup",
  "main.app.goNoGo": "The GO/NO-GO poll across stations",
  "main.app.logs": "Log viewer and bug report export",
  "main.app.maneuverTriggers": "Maneuver-node driven triggers",
  "main.app.missionProfiles": "Saved mission profiles",
  "main.app.notes": "Shared mission notes",
  "main.app.peer":
    "PeerJS host: approves stations, fans out telemetry, relays commands and Uplink bundles",
  "main.app.pushToMain": "Widgets a station pushes to the main screen",
  "main.app.screens": "Main, station and pilot screens, and the route switch",
  "main.app.settings": "The settings modal",
  "main.app.sound": "Audio cues",
  "main.app.stationApproval": "The operator's approval of a new station",
  "main.app.stationIdentity": "A station's local identity",
  "main.app.telemetry":
    "SitrepTelemetryProvider: the WebSocket to the mod, vantage and the peer relay of the stream",
  "main.app.trajectory": "Trajectory prediction helpers",
  "main.app.uplinks":
    "Uplink loader: reads the mod's roster, checks compatibility and integrity, imports each client bundle",
  "station.peer":
    "PeerJS client: joins the main screen, receives the stream, sends votes and commands",
  "station.dashboard":
    "The same dashboard and widget library as the main screen, with its own layout",
  "station.uplinks":
    "Loads the Uplink bundles the main screen announces, fetched over the peer link",
  "station.identity":
    "Station key and name in localStorage, and the approval wait",
  "relay.index": "Fastify server and process lifecycle",
  "relay.turnRoutes":
    "GET /ice-config: TURN credentials with a secret rotated on each restart",
  "relay.coturnManager":
    "Spawns coturn, the TURN server process that carries relayed traffic",
  "relay.turnSupervisor": "Restarts coturn and reports its health",
  "relay.appOrigins": "Which page origins may call the relay",
  "relay.analyticsConfig":
    "POST /analytics-config: the main screen's analytics consent",
  "relay.bootstrapConfig":
    "GET /bootstrap-config: republishes KSP_HOST so the app seeds its data source",
  "relay.discoverPublicIp": "Finds the public IP coturn advertises",
  "relay.config": "Environment configuration",
  "mod.plugin":
    "The only assembly that touches KSP and Unity. Holds the core Uplinks and the game backends",
  "mod.host":
    "ChannelEngine, view providers, the delay and comms model, Uplink discovery",
  "mod.core":
    "KSP-free courier and store: delay rings, journeys, subscriptions. Cannot reference Unity",
  "mod.transport":
    "WebSocket listener (vendored Fleck, compiled in); Gonogo.KSP binds it on :8090",
  "mod.propagation": "Orbit propagation, visibility and contact planning",
  "mod.contract":
    "The wire contract: payload types, Topic and command ids. Generates the TypeScript SDK",
  "mod.host.viewProviders":
    "Turn game snapshots into Topic payloads, one provider per area",
  "mod.host.commandProviders":
    "Validate and route commands to the game actuators",
  "mod.host.channelEngine":
    "Owns channels, gates, command groups, store and forward",
  "mod.host.uplinkDiscovery":
    "Finds each installed Uplink's plugin and registers it with the host",
  "mod.host.Comms":
    "Signal delay, contact, silence and the believed state at each command centre",
  "mod.host.CommandCentres": "Command centre registry and the home election",
  "mod.plugin.coreUplinks":
    "The Uplinks built into the mod, one per core domain",
  "mod.plugin.CurrencyDelay": "Delays career currency changes by signal time",
  "mod.plugin.SilenceTracking": "Tracks when each vessel was last heard",
  "devtools.sitrepServer":
    "TS reference port of the courier, archive and clock; writes golden fixtures the C# port must match",
  "devtools.sitrepKernel":
    "TS reference capability kernel; writes golden fixtures the C# port must match",
  sdk: "Generated wire contract plus the hooks an Uplink client uses",
  uikit: "The design system, the only UI package an Uplink may import",
  uplinkTools:
    "The uplink-tools command: scaffolds, codegens, pages and bakes an Uplink",
  nuget:
    "KspGonogo.Sitrep.Contract: the contract assembly, its test support and the codegen twin",
};

/**
 * Which app modules the station runs, as station components. The station is
 * the same build as the main screen; these are the parts that behave
 * differently there.
 */
export const stationComponents = {
  peer: "PeerJS client",
  dashboard: "Dashboard",
  uplinks: "Station Uplink loader",
  identity: "Station identity",
};

/**
 * Runtime relationships the import graph cannot show. `kind` is one of
 * telemetry, command, signalling, relayed or uses (the default). Endpoints
 * are full element ids.
 */
export const relations = [
  { from: "operator", to: "gonogo.main", title: "runs the mission from" },
  { from: "operator", to: "ksp", title: "plays" },
  { from: "operator", to: "ckan", title: "installs the mod and Uplinks from" },
  { from: "crew", to: "gonogo.station", title: "watches and votes from" },
  {
    from: "author",
    to: "gonogo.uplinkTools",
    title: "scaffolds and builds an Uplink with",
  },
  { from: "author", to: "devDocs", title: "reads" },

  {
    from: "gonogo.mod.plugin",
    to: "ksp.stock",
    title: "samples game state, applies commands",
    technology: "in process, main thread",
  },
  {
    from: "gonogo.mod.plugin",
    to: "ksp.breakingGround",
    title: "reads robotics and deployed science",
  },
  {
    from: "gonogo.mod.plugin",
    to: "ksp.makingHistory",
    title: "reads missions",
  },
  {
    from: "gonogo.mod.transport",
    to: "gonogo.main.app.telemetry",
    kind: "telemetry",
    title: "Topic stream",
    technology: "WebSocket ws://host:8090",
  },
  {
    from: "gonogo.main.app.telemetry",
    to: "gonogo.mod.transport",
    kind: "command",
    title: "commands, delay-aware",
    technology: "WebSocket ws://host:8090",
  },
  {
    from: "gonogo.main.app.telemetry",
    to: "gonogo.main.sitrepClient",
    title: "feeds the spine",
  },

  {
    from: "gonogo.main.app.peer",
    to: "broker",
    kind: "signalling",
    title: "registers the main screen's peer id",
    technology: "PeerJS over WSS",
  },
  {
    from: "gonogo.station.peer",
    to: "broker",
    kind: "signalling",
    title: "finds the main screen",
    technology: "PeerJS over WSS",
  },
  {
    from: "gonogo.main.app.peer",
    to: "stun",
    kind: "signalling",
    title: "learns its public address",
    technology: "STUN",
  },
  {
    from: "gonogo.station.peer",
    to: "stun",
    kind: "signalling",
    title: "learns its public address",
    technology: "STUN",
  },
  {
    from: "gonogo.main.app.peer",
    to: "gonogo.station.peer",
    kind: "telemetry",
    title: "telemetry and Uplink bundles",
    technology: "WebRTC, direct on the LAN or over the internet",
  },
  {
    from: "gonogo.station.peer",
    to: "gonogo.main.app.peer",
    kind: "command",
    title: "votes and commands",
    technology: "WebRTC",
  },
  {
    from: "gonogo.station.peer",
    to: "gonogo.relay.coturnManager",
    kind: "relayed",
    title: "relayed path when no direct path works",
    technology: "TURN, UDP or TCP :3478",
  },
  {
    from: "gonogo.main.app.peer",
    to: "gonogo.relay.coturnManager",
    kind: "relayed",
    title: "relayed path when no direct path works",
    technology: "TURN, UDP or TCP :3478",
  },
  {
    from: "gonogo.main.app.peer",
    to: "gonogo.relay.turnRoutes",
    title: "fetches TURN credentials, hands them to stations",
    technology: "HTTP GET /ice-config, relay :3002 (VITE_RELAY_URL)",
  },
  {
    from: "gonogo.main.app.peer",
    to: "gonogo.relay.analyticsConfig",
    title: "posts analytics consent",
    technology: "HTTP POST",
  },
  {
    from: "gonogo.main.app.dataSources",
    to: "gonogo.relay.bootstrapConfig",
    title: "reads the KSP host seed",
    technology: "HTTP GET",
  },
  {
    from: "gonogo.station.peer",
    to: "gonogo.station.dashboard",
    title: "feeds",
  },
  {
    from: "gonogo.station.uplinks",
    to: "gonogo.station.peer",
    title: "fetches bundles through",
  },
  {
    from: "gonogo.station.dashboard",
    to: "gonogo.main.components",
    title: "runs the same widget library as",
  },
  { from: "gonogo.station.dashboard", to: "gonogo.uikit", title: "imports" },
  { from: "gonogo.station.dashboard", to: "gonogo.sdk", title: "imports" },

  {
    from: "gonogo.main.app.uplinks",
    to: "cdn",
    title: "fetches released Uplink bundles",
    technology: "HTTPS, sha256 checked",
  },
  {
    from: "gonogo.mod.host.uplinkDiscovery",
    to: "gonogo.mod.host.channelEngine",
    title: "announces installed Uplinks",
    technology: "system.uplinks Topic",
  },
  {
    from: "gonogo.main.app.uplinks",
    to: "gonogo.main.app.telemetry",
    title: "reads the installed Uplinks through",
    technology: "system.uplinks Topic",
  },
  {
    from: "gonogo.main.logger",
    to: "axiom",
    title: "ships logs, with consent",
    technology: "HTTPS",
  },
  {
    from: "gonogo.relay.index",
    to: "axiom",
    title: "ships logs, with consent",
    technology: "HTTPS",
  },
  {
    from: "gonogo.site",
    to: "gonogo.main",
    title: "serves the app build",
    technology: "HTTPS",
  },
  { from: "gonogo.sdk", to: "npm", title: "published to" },
  { from: "gonogo.uikit", to: "npm", title: "published to" },
  { from: "gonogo.uplinkTools", to: "npm", title: "published to" },
  { from: "gonogo.nuget", to: "nugetOrg", title: "published to" },
  { from: "gonogo.nuget", to: "gonogo.mod.contract", title: "packs" },
  { from: "gonogo.mod.contract", to: "gonogo.sdk", title: "generates" },
  { from: "gonogo.mod", to: "ckan", title: "released to" },
];
