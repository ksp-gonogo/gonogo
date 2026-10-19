# Networking

Two computers matter in a gonogo session:

- The **KSP computer** runs Kerbal Space Program with the Gonogo mod
- The **main screen computer** runs gonogo (the container from the [README](../README.md#host-it-yourself)) and the browser tab you open the main screen in

A **station** is any other browser that joins: a tablet, a phone, a friend's laptop. Stations never talk to KSP. They get everything through the main screen tab, so stations only have data while that tab stays open and the computer stays awake.

## Connecting the main screen to KSP

If KSP runs on the same computer as gonogo, there is nothing to set up. KSP stops simulating when its window is minimised, so either keep it visible, set `SIMULATE_IN_BACKGROUND = True` in `settings.cfg` in the KSP install folder (with KSP closed), or use two computers.

If KSP is on a second computer, give the main screen that computer's address on your network. Find it there:

- **Windows**: run `ipconfig`, look for "IPv4 Address"
- **macOS**: System Settings, Network, Wi-Fi, Details, TCP/IP
- **Linux, SteamOS, Steam Deck**: run `ip addr show`, look for an `inet` address on your active connection

It usually looks like `192.168.x.x` or `10.x.x.x`. Enter it in **Settings, Connection, Telemetry stream**, or in the **Connect to KSP** step of the setup that opens on a first run.

If it won't connect, a firewall on the KSP computer is the usual cause. It must allow incoming connections on port 8090 (and 8088 for camera feeds).

## Adding stations

Open **Add station** on the main screen. It shows a link and a share code. A friend opens the link, enters the code, and you approve them.

- Friends on your LAN join with nothing to set up
- Most friends over the internet join with nothing to set up either
- Some networks can't connect directly: phones on mobile data, strict work or university networks, and carrier-grade NAT (an internet provider sharing one address between many customers). For those, you forward the relay ports to the main screen computer, as described below

The share code stays the same until you press **New share code**, or until the main screen browser's site data is cleared. Codes aren't case-sensitive and never contain `0`, `O`, `1`, `I` or `L`.

### What the chips mean

Each connected station gets a chip in the Add station panel showing how it is connected:

| Chip | Meaning |
| --- | --- |
| **direct (LAN)** | The station is on your LAN and talks straight to the main screen |
| **direct (internet)** | The station is elsewhere and found a direct route to the main screen. Nothing was forwarded |
| **relayed** | The station couldn't connect directly, so its data goes through the relay on the main screen computer. This only works with the ports below forwarded |
| **path unknown** | The connection is up but the browser hasn't reported how yet |

The status line at the bottom of the panel tells you whether the relay can be reached from outside. It only matters for stations that can't connect directly. Green means the relay answered; it doesn't prove a friend on mobile data can get through, only a friend connecting does.

## Cross-internet stations (cellular, remote networks)

Only needed for stations that can't connect directly. The relay runs inside the same container as the app, on the main screen computer. In your router, forward these ports to that computer:

| Port | Protocol | Purpose |
| --- | --- | --- |
| `3478` | TCP and UDP | Relay connections |
| `49160-49199` | UDP | Relay sessions, one port per relayed station |

Some routers want one entry per port, so about forty in all. Don't forward `3002` (the relay's status port, published on `127.0.0.1` only so it stays on this computer) or `8080` (a remote station loads the app from the public site, not from your machine).

Give the main screen computer a fixed address on your LAN first (a reservation in the router is easiest). If its address changes, every forward silently points at nothing.

The relay finds your public address on its own at startup. If it guesses wrong (more than one internet connection, IPv6, a changing address on a dynamic DNS name), set `TURN_EXTERNAL_IP=<your public IP>` on the container. If your provider puts you behind carrier-grade NAT, forwarding can't help, because the main screen has no public address to reach.

If the main screen runs from a source checkout with `pnpm dev`, put `TURN_EXTERNAL_IP=<your public IP>` in the repo-root `.env`, since dev mode defaults to the LAN address.

## A station won't connect

- **Is the main screen tab open and awake?** If it closed or the computer slept, every station stops
- **Is the share code right?** Copy it from the Add station panel the friend is joining. After **New share code**, the old one stops working
- **Is the friend on mobile data or a strict network?** Check the status line in the Add station panel. If it says the relay can't be reached from outside, check the forwards above, the fixed LAN address, and `TURN_EXTERNAL_IP`
- **Is a relayed station slow?** Relayed stations send everything through the main screen computer's internet upload
- **Does nothing connect, even on your LAN?** Stations need an internet connection to find the main screen, so check that both ends are online

More steps are in the app under **Settings, Help**, **A station will not connect**.

## Privacy

To work out a route between two devices, each asks a public Google or Cloudflare server what its own public address is. Those servers see that address at join time and carry no game data or share code.

## For people running their own build

- The main screen looks for the relay at `http://localhost:3002`. A build with the relay on another machine sets `VITE_RELAY_URL` to its address at build time
- The relay answers only the gonogo app's own pages. A main screen served from another address or site needs that origin in `RELAY_APP_ORIGINS` (comma-separated)
- `GET /health`, `/version` and `/ice-config` on port 3002 report the relay status, the image version and the relay address and credentials the main screen reads on boot
- To run the relay on its own on a public host, use the `ghcr.io/ksp-gonogo/gonogo-relay` image with the same ports and `RELAY_PUBLIC=1`. Keep `3002` closed to the internet
- `TURN_MIN_PORT` and `TURN_MAX_PORT` widen the relay session range for more relayed stations; publish and forward the same range
