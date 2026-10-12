# Networking

Two computers are involved in a gonogo session:

- The **KSP computer** runs Kerbal Space Program, with the gonogo mods installed
- The **main screen computer** runs gonogo, and the browser you open the main screen in talks to the KSP computer over your network

It is the browser, not the container, that opens that connection: it dials the Gonogo mod on port 8090 of the KSP computer directly (and kerbcast on 8088 for cameras). The container serves the app and the relay and never contacts the game. For a firewall this means the rule belongs on the KSP computer, which has to accept incoming connections on those ports from the main screen computer; nothing about the container's published ports matters for it.

Running both on one machine works but is awkward, because KSP pauses when it isn't the focused window, so the dashboard stops getting data the moment you switch to it. Two computers avoids that.

Station screens are different again. A station is any browser that joins the session: a tablet, a phone, a second laptop. A station never talks to KSP, and never needs to know your KSP computer's address or ports. It gets everything through the main screen's browser tab, so a station works only while that tab stays open and awake: close it, or let the computer sleep, and every station loses its data until it is back. On its first load a station also shows **Before you start** with a row per Uplink, answered separately from the main screen's. It needs two things: the share code from the main screen, and an internet connection (under **Settings, Help**, **Adding a station screen**: the two ends meet on a broker that lives on the internet).

Most of this page assumes you run gonogo the way the [README](../README.md#how-to-run-it) describes: the `ghcr.io/ksp-gonogo/gonogo` container (`:latest` after the first release, `:rc` before it), which serves the app on `:8080` and the relay on `:3002`. Where a setting differs between that and a source checkout running `pnpm dev`, both are given.

## Pointing the main screen at KSP

The main screen needs the KSP computer's address on your network. Find it on the KSP computer:

- **Windows**: run `ipconfig`, look for "IPv4 Address"
- **macOS**: System Settings, Network, Wi-Fi, Details, TCP/IP
- **Linux / SteamOS / Steam Deck**: run `ip addr show`, look for an `inet` address on your active connection

It usually looks like `192.168.x.x` or `10.x.x.x`. Give it to the main screen in **Settings → Connection → Telemetry stream** (the gear in the bottom-right **+** menu), or seed it once with `KSP_HOST=<address>` on the container. On a first run, the setup that opens by itself has a **Connect to KSP** step with the same row: that is where a player whose game is on a second computer types the KSP computer's address. [KSP-SETUP.md](KSP-SETUP.md#connecting-the-dashboard-to-ksp) covers both.

If the main screen can't reach the KSP computer on the same WiFi, a firewall on the KSP computer is the usual cause (it must allow incoming connections on port 8090, and 8088 for cameras); Windows and macOS often block local network traffic by default. The check is made by the browser on the main screen computer, so that computer's own network is the other half. This is a main-screen-to-KSP problem only. Stations never contact the KSP computer, so no firewall or port on that machine can stop a station connecting.

## Stations

Adding a station screen, how a station finds the main screen, and what to do when one will not connect are in the app, under **Settings, Help**: **Adding a station screen** and **A station will not connect**.

## Cross-internet stations (cellular, remote networks)

A station on the same WiFi as the main screen connects directly, peer-to-peer, and never needs TURN or any port-forwarding. Everything below only applies when a station is on a different network, a phone on cellular, someone joining from their own home.

Such a station also has to load the app itself from somewhere reachable, which your LAN address is not. Add Station lists the public build (`ksp-gonogo.github.io/app/station`, live from the first release) beside your own address whenever the main screen is running on a local address, so the usual answer is "it loads from GitHub Pages and needs nothing forwarded". Only a fork hosting its own build needs to think about this, via `VITE_STATION_URL`.

For a cross-internet station to reach the main screen, two things must be in place:

**1. Router port-forwarding.** The relay runs on the main screen computer (it is the second half of the same container, and the main screen browser fetches its ICE config from `http://localhost:3002`, so it has to be the machine the main screen is open on). Forward these ports to that machine:

| Port | Protocol | Purpose |
| --- | --- | --- |
| `3478` | TCP + UDP | TURN signalling |
| `49160–49170` | UDP | TURN relay sessions (one port per active relayed client) |

Consumer routers like Google Wi-Fi require one forward entry per port, so that's ~12 entries total.

Two things deliberately **not** in that table:

- The relay's HTTP port (`3002`). Only the main screen's own browser reads `/ice-config`, over loopback. A station never fetches it: the host's relay candidates reach the station through the broker's signalling channel, which is enough for one-side TURN
- The app's port (`8080`). A remote station loads the app from the public build, not from your machine

Point the forwards at a **fixed** LAN address for that machine. A DHCP lease change silently breaks every forward, which looks exactly like a relay that stopped working; a DHCP reservation on the router, or a static address, avoids it.

If you need more than ~10 simultaneous relayed stations, widen the window with `TURN_MIN_PORT` / `TURN_MAX_PORT` on the relay, publish the same range from the container, and add the matching router forwards. No source edit is needed for any of it.

**2. Public IP advertised to coturn.** coturn must advertise the machine's public IP in its relay candidates, a LAN IP won't be reachable from the internet.

- **Running the container** (the README command, or `docker-compose.yml`): the relay auto-discovers its public IP at startup, so usually there is nothing to set. Pin it with the `TURN_EXTERNAL_IP` environment variable when discovery gets it wrong (multi-WAN, IPv6, a pinned DDNS host), or when your ISP rotates it and you'd rather not restart
- **Running from a checkout with `pnpm dev`**: `scripts/dev.sh` auto-detects the **LAN IP** and passes it to coturn. That's the right default for same-WiFi stations, but a remote station can't reach a LAN address, so set your public IP in the repo-root `.env`:

```
TURN_EXTERNAL_IP=<your public IP>
```

`curl ifconfig.me` gives your current public IP. That variable is read by both `scripts/dev.sh` and the relay, and an explicit value always wins over auto-detection.

When the relay runs on a public Linux box (an always-on setup), it auto-discovers its public IP at startup, so no extra configuration is needed.

A relay containerized on a macOS host relays cross-internet traffic fine once both of the above are in place, it's been verified end-to-end with a station on cellular. A public Linux host is the better always-on choice (stable public IP, no home port-forwarding), but it isn't a requirement.

## Checking the relay works

Open the **Add Station** modal on the main screen. An indicator at the bottom checks whether the relay's TURN server is reachable. This matters only for stations out on the internet, which need TURN to connect: green means a cross-internet station can be relayed, red usually means a missing port-forward or the wrong public address. A station on the same WiFi connects regardless of what this indicator says, because it doesn't use TURN; if one is failing, work through When a station won't connect (**Settings, Help**, **A station will not connect**) instead.

The probe runs in the main screen's browser and looks for the relay at `http://localhost:3002`, so run the main screen on the machine the relay is on. Open it from a second computer and the indicator reports no TURN even when the relay is healthy.

The relay answers three requests on port `3002`, handy from the machine it runs on:

- `GET http://localhost:3002/health` reports the relay status and the public IP and port coturn is advertising. With no internet and no `TURN_EXTERNAL_IP`, the relay stays up without TURN (a LAN needs none), `turn` is `null` with a `turnUnavailable` reason, and it retries finding the public IP every 60 seconds. If coturn cannot start or stops after running, `/health` answers `503` and the relay exits so its container restarts
- `GET http://localhost:3002/version` returns `{ version, buildTime }`, which is how you tell which image a box is actually on
- `GET http://localhost:3002/ice-config` returns the ICE servers the main screen fetches on boot, or `503` with a reason while coturn is not running. The TURN shared secret in it rotates on every relay restart and lives only in the relay's memory

## Running the relay on its own

The released app has no setting for where the relay is. The main screen's browser always asks `http://localhost:3002`, so the relay has to run on the machine the main screen is open on, which is what the container from the README does. A relay on a separate machine is reached only by an app built with `VITE_RELAY_URL` set to its address; the published builds at `ksp-gonogo.github.io/app/` and `/rc/` are not, so they never contact one. That is a fork's setup, not an option of the released app.

For a fork that does that, run the relay image by itself (swap `podman` for `docker` if you prefer):

```bash
podman run -d --name gonogo-relay \
  -p 3002:3002 -p 3478:3478/udp -p 3478:3478/tcp -p 49160-49170:49160-49170/udp \
  -e TURN_EXTERNAL_IP=<public-ip> \
  -e RELAY_PUBLIC=1 \
  ghcr.io/ksp-gonogo/gonogo-relay:latest
```

On a box where the TURN ports are directly reachable, the relay finds its public IP by itself and nothing needs forwarding at home; leave `TURN_EXTERNAL_IP` out unless discovery gets it wrong.

`RELAY_PUBLIC=1` makes coturn refuse to relay to loopback, private, link-local and CGNAT addresses, which on a relay reachable from the internet are the relay box's own networks. Leave it unset on a LAN, where stations and the main screen sit on those ranges. The relay answers any web page that asks for `/ice-config`, because the address of the main screen's app is not known to the relay (it may be a LAN address, the public build, or a fork), so keep `3002` closed to the internet where you can and publish only the TURN ports.
