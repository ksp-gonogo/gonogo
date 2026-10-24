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

Open **Add station** on the main screen. It shows a link and a share code. A friend opens the link, enters the code, and you approve them. The link points at the public site for the version you run: `https://ksp-gonogo.github.io/app/station` if you run a release, `https://ksp-gonogo.github.io/rc/station` if you run the release candidate (`:rc`) image. A friend on another network opens that same address.

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
| `49160-49169` | UDP | Relay sessions: a relayed station on a device with one network holds 2 of them at a time (each extra network adapter, such as a VPN, holds more), so 10 serve up to 5 such players |

Plan on 2 session ports per internet player plus `3478`: the default 10 cover up to 5 players. Forward the whole range: the relay picks session ports at random within it, so forwarding only the first few is not safe. Some routers want one entry per port, so eleven in all. Don't forward `3002` (the relay's status port, published on `127.0.0.1` only so it stays on this computer) or `8080` (a remote station loads the app from the public site, not from your machine).

The relay first asks your router to open these ports itself (NAT-PMP, then UPnP for a router that does not answer NAT-PMP). When that works, the Add station window needs nothing from you, and the relay deletes the forwards when it stops. If the window says the router refused or did not answer, forward the ports by hand as above.

The relay finds the router by itself. A container that shares the computer's network (Docker or Podman on Linux with `--network host`) reads the real default route. A container on Docker Desktop, Podman's virtual machine or Docker's own bridge cannot see the router, so the relay asks the usual router addresses and then the `.1` and `.254` address of every `192.168.x.x` network, and uses whichever answers. `pnpm dev` does better: it reads the router and this computer's address from the computer's default route and passes them in as `ROUTER_IP` and `LAN_IP`. A router on any other kind of network, or one that answers only UPnP, needs both set by hand on the container:

- `ROUTER_IP`: the router's address, the "Default Gateway" in `ipconfig` on Windows or the `via` address of `ip route get 1.1.1.1` on Linux. The relay asks only this one when it is set
- `LAN_IP`: this computer's address on the same network. A router that opens ports with UPnP forwards them to this address, and from inside a container the relay cannot see it. NAT-PMP routers do not need it
- `PORT_MAPPING=0` stops the relay asking at all

When nothing answers, the relay log has one line naming the addresses it asked and the settings above.

Give the main screen computer a fixed address on your LAN first (a reservation in the router is easiest). If its address changes, every forward silently points at nothing.

The relay finds your public address on its own at startup. If it guesses wrong (more than one internet connection, IPv6, a changing address on a dynamic DNS name), set `TURN_EXTERNAL_IP=<your public IP>` on the container. If your provider puts you behind carrier-grade NAT, forwarding can't help, because the main screen has no public address to reach.

If the main screen runs from a source checkout with `pnpm dev`, put `TURN_EXTERNAL_IP=<your public IP>` in the repo-root `.env`, since dev mode defaults to the LAN address.

## Letting a station fetch the relay details first (optional)

By default a station learns the relay's details only after it has connected to the main screen once, so a station that can't connect directly never gets them. To fix that, publish the relay's status port so the station link can carry the relay's address:

1. Choose an address stations can reach port `3002` at. The public site is served over https, so a station opened from it can only fetch from an https address: put a reverse proxy with a certificate in front of `3002`
2. Set `RELAY_HTTP_BIND=0.0.0.0` and `RELAY_PUBLIC_URL=https://<that address>` in the repo-root `.env` (or on the container), then restart it
3. When the status line in the Add station panel goes green, the link and QR code include the relay address

Anyone holding that link can read the relay's time-limited credentials, not only stations you approve. Leave both settings unset to keep port `3002` on this computer and the relay out of the link. A station whose link names a relay that doesn't answer falls back to the normal route and says so if it can't connect.

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
- The relay answers only the gonogo app's own pages (the public site is always allowed). A main screen served from another address or site needs that origin in `RELAY_APP_ORIGINS` (comma-separated)
- `GET /health`, `/version` and `/ice-config` on port 3002 report the relay status, the image version and the relay address and credentials the main screen reads on boot
- To run the relay on its own on a public host, use the `ghcr.io/ksp-gonogo/gonogo-relay` image with the same ports and `RELAY_PUBLIC=1`. Keep `3002` closed to the internet
- `TURN_MIN_PORT` and `TURN_MAX_PORT` widen the relay session range for more than 5 relayed stations (2 ports each on a device with one network, more with extra adapters); publish and forward the same range
- The relay offers a UDP relay address only. `TURN_TCP=1` adds a TCP one for stations behind a network that blocks UDP, which doubles the ports each relayed connection holds
