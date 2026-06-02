# Networking

Two computers are involved in a gonogo session:

- The **KSP computer** runs Kerbal Space Program, with the gonogo mods installed
- The **main screen computer** runs gonogo and talks to the KSP computer over your network

These have to be separate computers. Running both on one machine isn't supported yet, because KSP pauses when it isn't the focused window, so the dashboard would stop getting data the moment you switched to it.

Station screens are different again. A station is any browser that joins the session: a tablet, a phone, a second laptop. A station never needs to know about addresses, ports, or your network. It only needs the share code from the main screen.

## Pointing the main screen at KSP

The main screen needs the KSP computer's address on your network. Find it on the KSP computer:

- **Windows**: run `ipconfig`, look for "IPv4 Address"
- **macOS**: System Settings, Network, Wi-Fi, Details, TCP/IP
- **Linux / SteamOS / Steam Deck**: run `ip addr show`, look for an `inet` address on your active connection

It usually looks like `192.168.x.x` or `10.x.x.x`. Put that address into the Telemachus data source in gonogo, as described in [KSP-SETUP.md](KSP-SETUP.md#connecting-the-dashboard-to-ksp).

If a station or the main screen can't reach the KSP computer on the same WiFi, a firewall on the KSP computer is the usual cause; Windows and macOS often block local network traffic by default.

## How a station finds the main screen

The main screen's peer claims a fixed identity derived from its share code, and a station derives the same identity from the code the operator types. Both ends meet at that identity on the public PeerJS broker and connect directly, peer-to-peer. There is no lookup step and no relay in the path: the station never resolves the code against a server, it just computes where the host will be and connects there.

Because both ends are browsers on the same WiFi, they exchange local network addresses directly and the connection stays on your LAN. The relay is not needed for a station to find or reach the main screen on the same network.

The relay still runs, but its job is now the camera channel's TURN server and a diagnostics-only registry, not station discovery. A station on the same WiFi joins with no relay involved at all.

A station out on the internet (a phone on cellular, a friend at their own house) is a harder case. The two browsers still meet at the same broker identity, but when they can't reach each other's local addresses they need a TURN relay to bridge the connection. The bundled relay's TURN server handles this — including from a containerized relay on macOS — as long as coturn advertises a reachable public IP and the TURN ports are forwarded to it. See [Cross-internet stations](#cross-internet-stations-cellular-remote-networks) below for the setup. Same-WiFi stations need none of that.

## Cross-internet stations (cellular, remote networks)

A station on the same WiFi as the main screen connects directly, peer-to-peer, and never needs TURN or any port-forwarding. Everything below only applies when a station is on a different network — a phone on cellular, someone joining from their own home.

For a cross-internet station to reach the main screen, two things must be in place:

**1. Router port-forwarding.** The machine running the relay must be reachable on these ports from the internet:

| Port | Protocol | Purpose |
| --- | --- | --- |
| `3478` | TCP + UDP | TURN signalling |
| `49160–49170` | UDP | TURN relay sessions (one port per active relayed client) |

Consumer routers like Google Wi-Fi require one forward entry per port, so that's ~12 entries total. If you ever widen the relay range in `packages/relay/src/coturnManager.ts`, widen the forwards to match.

**2. Public IP advertised to coturn.** coturn must advertise the machine's public IP in its relay candidates — a LAN IP won't be reachable from the internet.

When running with `pnpm dev`, `scripts/dev.sh` auto-detects the **LAN IP** and passes it to coturn. That's the right default for same-WiFi stations, but a remote station can't reach a LAN address. To support a remote station from a local dev setup, set your public IP in the repo-root `.env`:

```
TURN_EXTERNAL_IP=<your public IP>
```

`curl ifconfig.me` gives your current public IP. That variable is read by both `scripts/dev.sh` and the relay, and an explicit value always wins over auto-detection.

When the relay runs on a public Linux box (as in the production setup described in [DEPLOYMENT.md](DEPLOYMENT.md#port-forwarding-for-off-network-stations)), it auto-discovers its public IP at startup, so no extra configuration is needed.

A relay containerized on a macOS host relays cross-internet traffic fine once both of the above are in place — it's been verified end-to-end with a station on cellular. A public Linux host is the better always-on choice (stable public IP, no home port-forwarding), but it isn't a requirement.

## Checking the relay works

Open the **Add Station** modal on the main screen. An indicator at the bottom checks whether the relay's TURN server is reachable. This matters only for stations out on the internet, which need TURN to connect: green means a cross-internet station can be relayed, red usually means a missing port-forward or the wrong public address. A station on the same WiFi connects regardless of what this indicator says, because it doesn't use TURN.
