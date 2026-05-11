# gonogo

A mission control SPA for [Kerbal Space Program](https://www.kerbalspaceprogram.com/).

Connect gonogo to your KSP game to get a live telemetry dashboard you can layout, resize, and share across screens.

---

## Quick start (end-to-end)

This walks you all the way from a fresh KSP install to gonogo running with every feature. If you already know your way around KSP modding and Node, skip to [Prerequisites](#prerequisites) below — this section is for someone setting up for the first time.

Every `compose` command below works with either **Docker Compose**, **Podman Compose**, or any compose compatible system. Pick whichever you have. Wherever you see:

```bash
docker compose ... 
```

You can substitute for your compose runtime or choice.

### The big picture

You'll end up with two "roles". These can be the same machine or two different machines:

- **KSP machine** — the computer running Kerbal Space Program. The KSP mods install here.
- **Mission control machine** — the computer running gonogo (its backend services + the browser).

Other devices (phones, tablets, laptops — anywhere, not just on your LAN) can connect as **station screens**. Station ↔ main-screen traffic flows via PeerJS, which uses a public broker and a TURN relay; it works across networks in principle, so a friend in another country can run a station if you share the peer code.

The one networking detail to sort out is that the mission control machine needs to know the LAN IP of the KSP machine (if they're different).

### Step 1 — Find your machine IPs

If KSP and mission control are **the same machine**, you can skip this.

If they're **different machines**, find each machine's LAN IP (usually looks like `192.168.x.x` or `10.x.x.x`):

- **Windows** — open Command Prompt, run `ipconfig`, look for "IPv4 Address"
- **macOS** — System Settings → Network → Wi-Fi → Details → TCP/IP → IP Address
- **Linux / SteamOS / Steam Deck** — open a terminal, run `ip addr show` and look for an `inet` on your Wi-Fi or Ethernet interface

Write them down:
- `KSP_MACHINE_IP` = IP of the computer running KSP
- `GONOGO_MACHINE_IP` = IP of the computer running gonogo

### Step 2 — Install KSP mods (on the KSP machine)

Drop each mod into `Kerbal Space Program/GameData/` and restart KSP. Install only the ones you want features for:

| Mod | What you get |
|-----|------|
| [Telemachus Reborn](https://github.com/TelematicusKSP/TelematicusReborn) | **Required.** All telemetry, action groups, the main dashboard. |
| [kOS](https://ksp-kos.github.io/KOS/) | The kOS Terminal component. Optional. |
| [HullcamVDSContinued](https://github.com/linuxgurugamer/HullcamVDSContinued) + [OfCourseIStillLoveYou](https://github.com/jrodrigv/OfCourseIStillLoveYou) | Live Hullcam video feeds in the Camera Feed widget. Optional. |

**For Camera Feeds on Linux (Steam Deck etc.)**, after installing OCISLY, replace the main plugin DLL with the patched build: download `OfCourseIStillLoveYou.dll` from [jonpepler/OfCourseIStillLoveYou releases](https://github.com/jonpepler/OfCourseIStillLoveYou/releases/latest) and drop it into `GameData/OfCourseIStillLoveYou/Plugins/`, overwriting the file already there. Upstream has a bug on Linux that produces all-white frames; this build fixes it. Windows users can use either.

### Step 3 — Install software on the mission control machine

Open a terminal on the mission control machine and install:

- **[Node.js v24](https://nodejs.org/)** via [nvm](https://github.com/nvm-sh/nvm)
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install 24
  ```
- **[pnpm](https://pnpm.io/installation)**
  ```bash
  npm install -g pnpm
  ```
- **Container runtime** — either [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io/docs/installation). Both work identically with the compose file in this repo.
- **git** — usually already installed. If not, grab it from your OS package manager or [git-scm.com](https://git-scm.com/).

### Step 4 — Get gonogo

In a terminal on the mission control machine:

```bash
git clone https://github.com/jonpepler/gonogo.git
cd gonogo
nvm use          # switches to Node 24 (uses .nvmrc in the repo)
pnpm install     # installs JS dependencies
```

### Step 5 — Start the backend services

gonogo's backend is a small set of containers (telnet proxy, OCISLY proxy, coturn TURN relay, and the OCISLY gRPC server itself). They all come up together via compose.

If KSP is on a **different machine**, tell the proxies where to find the OCISLY server on that machine (the OCISLY gRPC server in the compose stack binds on port 5077 of the gonogo machine — the KSP mod needs to be configured to send frames to `GONOGO_MACHINE_IP:5077` in its settings file). If KSP is on the **same machine**, leave the env var alone.

```bash
# Docker:
OCISLY_HOST=<KSP_MACHINE_IP> KOS_HOST=<KSP_MACHINE_IP> docker compose up -d --build

# Podman:
OCISLY_HOST=<KSP_MACHINE_IP> KOS_HOST=<KSP_MACHINE_IP> podman compose up -d --build
```

### Step 6 — Start the app

Still on the mission control machine:

```bash
pnpm dev
```

Open `http://localhost:5173` in your browser. You should see the main dashboard.

### Step 7 — Point gonogo at KSP

Launch a vessel in KSP, then on the main dashboard:

1. Find (or add) the **Data Source Status** widget.
2. Next to the **data** row (Telemachus), click the gear icon.
3. Set **host** to `KSP_MACHINE_IP` (or `localhost` if same machine) and port `8085`. Save.
4. Click **Reconnect**. The indicator should turn green.

Repeat for other sources if you installed them:

- **kos** data source — host is `localhost` (the telnet proxy, which runs on the mission control machine), `kosHost` is `KSP_MACHINE_IP`, `kosPort` is `5410`.
- **ocisly** (under Stream Sources) — no configuration needed, it uses the gonogo relay at `localhost:3002` automatically.

### Step 8 — Enable Camera Feeds (if installed)

If you're running the gonogo build of the OCISLY plugin (the one linked from the [Linux/Mesa note above](#prerequisites) — also the recommended path for Windows users), edit `GameData/OfCourseIStillLoveYou/settings.cfg` and set `AutoStream = true`. Every Hullcam on the active vessel will start streaming as soon as you reach the flight scene.

1. In KSP, launch a vessel with one or more Hullcams attached.
2. In gonogo, add a **Camera Feed** widget from the component picker (the + button). It should pick up the cameras automatically — switch between them or turn on cycle mode.

**With upstream OCISLY** (or with `AutoStream = false`) you have to enable each camera by hand: click the OCISLY toolbar icon to open its window, then click **Enable streaming** next to each camera you want to share.

### Step 9 — Add station screens (optional)

A station screen is any other browser on any network — phone, tablet, a laptop at a friend's house:

1. On the main screen, hover over the **+** FAB (bottom-right) — the **4-character peer code** appears.
2. On the station device, open gonogo (see note below) and visit the `/station` route.
3. Enter the peer code and click **Connect**.

**Where does the station open gonogo?** On the same LAN, `http://GONOGO_MACHINE_IP:5173/station` once `pnpm dev` is running. From anywhere else you'll need a proper deploy — see [Deployment](#deployment) below. PeerJS itself doesn't care about networks; it's just the app files that need to be served from somewhere both ends can reach.

### If anything doesn't work

- **Data Source Status widget** shows coloured indicators next to each source — green = connected, anything else means the mission-control machine can't reach that host/port.
- The **telnet proxy** is on port `3001`; the **relay** is on `3002`. `curl http://localhost:3001/status` and `curl http://localhost:3002/health` confirm they're running.
- For Camera Feed issues specifically, the [Camera Feeds](#camera-feeds-ofcourseistilloveyou-optional) section below has a fuller diagnostic walkthrough.
- Firewalls on Windows / macOS can block LAN traffic by default. If a station on the LAN can't reach the main machine, that's usually it.

---

## Prerequisites

### Software

- [Node.js](https://nodejs.org/) v24 (via [nvm](https://github.com/nvm-sh/nvm) — the repo ships an `.nvmrc`)
- [pnpm](https://pnpm.io/) v10+

### KSP Mods

| Mod                                                                                                                                                                                                                      | Purpose                                                            | Required                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------- |
| [Telemachus Reborn](https://github.com/TelematicusKSP/TelematicusReborn)                                                                                                                                                 | Streams telemetry and accepts control commands over HTTP/WebSocket | Yes                             |
| [kOS](https://ksp-kos.github.io/KOS/)                                                                                                                                                                                    | Scriptable CPU for kOS terminal integration                        | Only for kOS Terminal component |
| [HullcamVDSContinued](https://github.com/linuxgurugamer/HullcamVDSContinued) + [OfCourseIStillLoveYou](https://github.com/jrodrigv/OfCourseIStillLoveYou) (see [Camera Feeds](#camera-feeds-ofcourseistilloveyou-optional) below) | Live Hullcam video in the Camera Feed component                    | Only for Camera Feed component  |

---

## Setup

```bash
# 1. Use the right Node version
nvm use

# 2. Install dependencies
pnpm install

# 3. Start the app (Vite dev server)
pnpm dev
```

Open `http://localhost:5173` in your browser.

---

## Connecting to KSP

### Telemachus Reborn

1. Install Telemachus Reborn in your KSP `GameData` folder.
2. Start KSP and load a flight scene.
3. Telemachus starts a server on port `8085` by default.
4. In the gonogo **Data Source Status** panel, set the host to your KSP machine's IP and port `8085`, then click save and reconnect.

The app connects to `ws://host:8085/datalink` for live data and `http://host:8085/telemachus/datalink` for control actions.

#### Enabling CORS _(required to read action responses)_

By default Telemachus serves only its bundled HTML UI on its own port, so it ships without CORS headers. gonogo runs on a different origin (whatever URL you load the app from), which means **most action responses are opaque to gonogo** — the request fires and the action takes effect, but gonogo can't read what KSP sent back. For most actions that's fine (the state change arrives moments later over the WebSocket), but a handful of features need the response: mirroring local alarms into KSP's stock AlarmClock (uses the returned alarm id to delete the right alarm later), and any future feature where the action's return value isn't otherwise observable.

The **gonogo build** of Telemachus Reborn supports a config-driven CORS allowlist. After your first KSP launch with Telemachus installed, edit `GameData/Telemachus/Plugins/PluginData/Telemachus/config.xml` (Telemachus uses XML for its config) and add a new line inside the `<config>` element:

```xml
<string name="ALLOWED_ORIGINS">http://localhost:5173,https://jonpepler.github.io</string>
```

Comma-separated origins (scheme + host + optional port, no trailing slash). Add your dev origin, your production origin, and any LAN-station origins you use (e.g. `http://192.168.86.42:5173`). Restart KSP — `config.xml` is read once at plugin start, not on ModuleManager reload. Telemachus will echo `Access-Control-Allow-Origin: <origin>` for any request whose `Origin` header matches.

Default behaviour with no `ALLOWED_ORIGINS` line is the historical "no CORS headers ever," so existing setups aren't disturbed. Stock Telemachus Reborn (without the gonogo fork) has no CORS support at all — the alarm-mirror feature and any other "read the action response" feature requires the fork.

**Security note:** any origin in the allowlist can read game state AND trigger actions (launch vessels, accept contracts, fire action groups). Keep the list to origins you control. There's no authentication on Telemachus's HTTP endpoints by default; the only barrier to a malicious origin is the allowlist. Don't add wildcards or origins you don't recognise.

#### Signal loss (CommNet)

gonogo treats Telemachus as gated by the vessel's CommNet link. When `comm.connected` flips to `false` (e.g. ship behind a body with no relay path), the buffering layer drops incoming telemetry samples — widgets freeze at their last reading and the stored history shows a clean gap. A `SIGNAL LOSS` banner appears at the top of every screen with a timer. Signal returns → data flows again.

**RemoteTech is not supported.** Telemachus Reborn reads CommNet state directly from stock `Vessel.Connection`; RemoteTech's separate signal-delay / flight-computer model isn't exposed through the same keys. If you run RemoteTech, gonogo's blackout logic will reflect stock CommNet rather than RT's state. Stock CommNet alone supports the important gameplay beats — line-of-sight occlusion, relay-satellite networks, signal-strength gradient.

Kerbalism's comm system updates the same stock fields, so it works out of the box; a future upgrade could read `kerbalism.connectionLinked` directly for higher fidelity.

### kOS Terminal _(optional)_

The kOS terminal requires the **telnet proxy** — a small server that bridges the browser to kOS's telnet interface.

**Start the proxy:**

```bash
pnpm --filter @gonogo/telnet-proxy dev
# or, via compose:
docker compose up     # or: podman compose up
```

The proxy runs on port `3001` by default. It is **entirely optional** — all other features work without it. If the proxy is unreachable the kOS Terminal component will show a connection error and the rest of the dashboard is unaffected.

**Configure:**

- Proxy host/port: configure in the Data Source Status panel under the `kos` data source.
- kOS telnet host/port: defaults to `localhost:5410` (KSP default). Adjust if KSP is on a different machine.

### Camera Feeds (OfCourseIStillLoveYou) _(optional)_

The Camera Feed component streams live video from Hullcam parts via WebRTC. It requires:

- **HullcamVDSContinued** — the Hullcam parts themselves, installed in KSP.
- **OfCourseIStillLoveYou (OCISLY)** mod — a gRPC camera-capture plugin for KSP.
  - **On Linux KSP installs** (including Steam Deck), replace the main `OfCourseIStillLoveYou.dll` with the build from [jonpepler/OfCourseIStillLoveYou](https://github.com/jonpepler/OfCourseIStillLoveYou/releases/latest). Upstream has a bug in the Hullcam readback path that produces all-white frames on Mesa/OpenGL.
- **OCISLY gRPC server** — the `.NET 7` server from the mod that accepts frames from KSP. Bundled in the compose stack.
- **gonogo relay** (`packages/relay`) — gonogo's fan-out service. Polls the OCISLY server, re-encodes frames into WebRTC video streams, and distributes them to main + station screens over PeerJS. The same container also bundles a coturn TURN/STUN server (spawned as a child process) — required because WebRTC from the containerised relay can't traverse container NAT without one, and stations joining from outside the LAN need relay candidates regardless.

All three containerised services come up together — one command:

```bash
docker compose up -d --build     # or: podman compose up -d --build
pnpm dev
```

Then in KSP: launch a vessel with one or more Hullcams attached, click the OCISLY toolbar icon to open the camera list, and click **Enable streaming** next to each camera you want to share. Add a **Camera Feed** widget in gonogo and it'll pick them up.

If the OCISLY gRPC server is running somewhere other than the compose stack (e.g. directly on the KSP machine), point the relay at it:

```bash
OCISLY_HOST=<host-ip> docker compose up -d --build
```

The relay exposes a few diagnostic endpoints that are handy when something's off:

- `GET http://localhost:3002/health` — status + current proxy peer id + the public IP the bundled coturn is advertising
- `GET http://localhost:3002/ice-config` — the iceServers config the main screen fetches on boot (TURN URL + per-restart-rotated credentials)
- `GET http://localhost:3002/cameras/stats` — per-camera poll/push counters
- `GET http://localhost:3002/cameras/:id/snapshot.jpg` — most recent raw JPEG from OCISLY, useful for isolating "is the issue upstream of our WebRTC pipeline?"

### Letting friends connect from outside your LAN

Stations on the same WiFi as the main screen connect peer-to-peer with no extra setup. For anyone *off* your network — cellular phones, friends at their own house, anything behind CGNAT or a strict firewall — WebRTC needs a TURN relay to bridge the two ends. The relay container hosts coturn for exactly this; you just need to make it reachable from the public internet.

**One-time router setup:**

1. Forward the following ports on your home router to the machine running the relay:
   - **TCP 3478** — TURN signalling
   - **UDP 3478** — TURN signalling
   - **UDP 49160–49200** — TURN relay sessions (one port per active relay)
2. The relay auto-discovers its public IP at startup and advertises it to clients. If your ISP gives you a stable IP this needs no further attention. If your IP rotates, restart the relay periodically or pin it explicitly with `TURN_EXTERNAL_IP=<ip>` in compose.
3. Open the **Add Station** modal on the main screen — there's a TURN-reachability indicator at the bottom that probes coturn from the browser side. Green ✅ means a friend on cellular can connect; red ❌ usually means a port-forward is missing or the wrong IP is being advertised.

**Security:** the coturn shared secret is regenerated on every relay restart and only ever lives in the relay process's memory. The main screen fetches it from `/ice-config`; stations don't need it (they pair against the host's relay candidates over the broker). Never commit a TURN credential to source.

---

## Architecture overview

```
packages/
  core/           — Plugin registry, types, shared hooks, StreamSource primitive
  ui/             — Shared UI primitives (Modal, Tag, form controls)
  components/     — Built-in dashboard components
  serial/         — Per-screen serial input platform (physical + virtual controllers)
  data/           — Flight history + data hooks (useDataSeries, useFlight, etc.)
  app/            — Vite + React SPA (main + station screens)
  telnet-proxy/   — Fastify WebSocket-to-telnet bridge for kOS
  relay/          — gRPC→WebRTC camera fan-out for OCISLY feeds + bundled coturn (TURN/STUN) + /ice-config endpoint
```

Components self-register via `registerComponent()`. The dashboard renders whatever is registered — there is no hardcoded component list. External packages can add components using the same API.

---

## Adding components

From the dashboard, click the **+** button (bottom-right) to open the component picker. Search by name or tag, click a component to place it, then drag and resize it.

Layouts are saved automatically to `localStorage`.

---

## Physical controllers (serial input)

gonogo can take input from USB hardware controllers (throttle quadrants,
button boxes, custom panels) — or from a built-in virtual controller for
testing without hardware. Each screen has its own Serial Devices FAB
(the joystick icon, bottom-right).

For the full walkthrough — defining a device type, picking the USB port,
wiring inputs to widget actions, and writing back to the device for
displays/LEDs — see [`packages/serial/README.md`](packages/serial/README.md).

---

## Contributing

1. Fork the repo and create a branch.
2. Run `pnpm install` and `pnpm dev` to start developing.
3. Run `pnpm test` before submitting — all tests must pass.
4. Run `pnpm lint` to check TypeScript.
5. Open a pull request with a clear description of what changed and why.

CI runs on every PR. There is no required PR template, but include context for reviewers.

---

## Deployment

### Frontend (GitHub Pages)

The app is deployed to GitHub Pages at [jonpepler.github.io/gonogo](https://jonpepler.github.io/gonogo/) on every merge to `main` that passes CI.

To build locally:

```bash
pnpm build
```

Output lands in `packages/app/dist/`.

### Proxy images (GHCR)

Both proxies are published as multi-arch (`linux/amd64`, `linux/arm64`) container images to GitHub Container Registry on every merge to `main`:

- `ghcr.io/jonpepler/gonogo-telnet-proxy:latest`
- `ghcr.io/jonpepler/gonogo-relay:latest`

Tagged by commit SHA as well (`sha-<short>`). Useful for running the proxies on a dedicated mission-control box without installing a Node toolchain (swap `docker` for `podman` if you prefer):

```bash
docker run -d --name gonogo-telnet-proxy -p 3001:3001 \
  -e KOS_HOST=<ksp-host> -e KOS_PORT=5410 \
  ghcr.io/jonpepler/gonogo-telnet-proxy:latest

docker run -d --name gonogo-relay \
  -p 3002:3002 -p 3478:3478/udp -p 3478:3478/tcp -p 49160-49200:49160-49200/udp \
  -e OCISLY_HOST=<ksp-host> -e OCISLY_PORT=5077 \
  ghcr.io/jonpepler/gonogo-relay:latest
```

The bundled `docker-compose.yml` builds from local source (useful during dev so `pnpm dev`'s watcher can rebuild on code changes). For a clean deployment, write a minimal compose file that references the `ghcr.io` images directly.
