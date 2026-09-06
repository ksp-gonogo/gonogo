# Networking

Two computers are involved in a gonogo session:

- The **KSP computer** runs Kerbal Space Program, with the gonogo mods installed
- The **main screen computer** runs gonogo and talks to the KSP computer over your network

These have to be separate computers. Running both on one machine isn't supported yet, because KSP pauses when it isn't the focused window, so the dashboard would stop getting data the moment you switched to it.

Station screens are different again. A station is any browser that joins the session: a tablet, a phone, a second laptop. A station never talks to KSP, and never needs to know your KSP computer's address or ports. It needs two things: the share code from the main screen, and an internet connection (see [How a station finds the main screen](#how-a-station-finds-the-main-screen), the two ends meet on a broker that lives on the internet).

Most of this page assumes you run gonogo the way the [README](../README.md#how-to-run-it) describes: the `ghcr.io/ksp-gonogo/gonogo:latest` container, which serves the app on `:8080` and the relay on `:3002`. Where a setting differs between that and a source checkout running `pnpm dev`, both are given.

## Pointing the main screen at KSP

The main screen needs the KSP computer's address on your network. Find it on the KSP computer:

- **Windows**: run `ipconfig`, look for "IPv4 Address"
- **macOS**: System Settings, Network, Wi-Fi, Details, TCP/IP
- **Linux / SteamOS / Steam Deck**: run `ip addr show`, look for an `inet` address on your active connection

It usually looks like `192.168.x.x` or `10.x.x.x`. Give it to the main screen in **Settings → Data Sources → Sitrep Stream** (the database icon in the bottom-right **+** menu), or seed it once with `KSP_HOST=<address>` on the container. [KSP-SETUP.md](KSP-SETUP.md#connecting-the-dashboard-to-ksp) covers both, and the build-time `VITE_SITREP_HOST` floor that only applies when you build from a checkout.

If the main screen can't reach the KSP computer on the same WiFi, a firewall on the KSP computer is the usual cause; Windows and macOS often block local network traffic by default. This is a main-screen-to-KSP problem only. Stations never contact the KSP computer, so no firewall or port on that machine can stop a station connecting.

## Adding a station screen

1. On the main screen, hover the **+** button (bottom-right) and press **Add station** (the broadcast symbol). The modal shows a four-character **share code** (e.g. `AB3K`), the same code as a link and a QR code, and the TURN indicator described [below](#checking-the-relay-works)
2. On the other device, open the station page. Any of these work:
   - Scan the QR code, or open the link from the modal. Both carry the code as `?host=<code>`, so the station connects on landing with nothing to type
   - Type [ksp-gonogo.github.io/gonogo/station](https://ksp-gonogo.github.io/gonogo/station) into the browser. This is the public build of the same app and it is what the QR points at
   - On the same WiFi, `http://<main-screen-computer-ip>:8080/station`, served by your own container. Running from a checkout it is `http://<main-screen-computer-ip>:5173/station`
3. If you didn't arrive by QR or link, the station shows a **Connect to Mission Control** screen. Type the four-character code and press **Connect**

The station remembers the code, so it reconnects by itself on the next page load. To change or clear it, open the **Connection** FAB on a connected station: it shows the current code and status, takes a different code, and has a **Disconnect** that returns the device to the connect screen.

Regenerating the code (the **New share code** button in Add Station) drops every connected station: they all need the new code.

## How a station finds the main screen

The main screen's peer claims a fixed identity derived from its share code, and a station derives the same identity from the code the operator types. Both ends meet at that identity on a **PeerJS broker** and connect directly, peer-to-peer. There is no lookup step and no relay in the path: the station never resolves the code against a server, it just computes where the host will be and connects there.

The broker is a public internet service (`0.peerjs.com` by default, the PeerJS library's own). It carries no telemetry: its whole job is to let two browsers that know the same name exchange connection details. Two consequences:

- **Both devices need internet access, even on the same WiFi.** An offline LAN, a guest network that blocks outbound, or a captive portal that hasn't been signed into will stop a station connecting to a main screen sitting a metre away
- The broker is a dependency you don't control. A self-hosted broker can be pointed at with the `VITE_PEER_HOST` / `VITE_PEER_PORT` / `VITE_PEER_PATH` / `VITE_PEER_SECURE` build-time variables, which means building the app from a checkout; there is no runtime setting for it

Once the two ends have found each other, the data goes directly between the browsers. On the same WiFi they exchange local network addresses and the connection stays on your LAN, so nothing but the initial introduction leaves the network.

The relay is a separate thing from the broker and is **not** part of finding the main screen. It runs alongside the app, hosts the camera channel's TURN server and a diagnostics-only registry, and a same-WiFi station connects without it.

A station out on the internet (a phone on cellular, a friend at their own house) is the harder case. The two browsers still meet at the same broker identity, but when they can't reach each other's local addresses they need a TURN relay to bridge the connection. The bundled relay's TURN server handles this, including from a containerized relay on macOS, as long as coturn advertises a reachable public IP and the TURN ports are forwarded to it. See [Cross-internet stations](#cross-internet-stations-cellular-remote-networks) below.

## When a station won't connect

Work down this list. The first three cover nearly every same-WiFi failure, and none of them involve the relay or TURN.

1. **Read the station's own status line.** The connect screen says which of the three failures it hit, and they want different fixes:
   - *"Can't reach the peer broker: this device needs internet access."* This device has no route to the broker. Nothing is wrong with the code or the main screen. Check that the device is genuinely online (load any website), that it isn't on a guest network or captive portal, and that outbound HTTPS isn't blocked
   - *"Broker doesn't know that code."* The broker answered and nobody is holding that identity. Check the code against the Add Station modal, check the main screen tab is still open and awake, and check the code wasn't regenerated
   - *"Reconnecting"* or *"Connection lost"* after a working session. The host went away (refresh, sleep, restart). A station retries on its own for five minutes; a main screen that restarted uncleanly may spend a few seconds reclaiming its identity, which the Add Station modal says explicitly when it happens
2. **Check the code is the one on screen now.** It is four characters, case-insensitive, and it changes only when someone presses **New share code**
3. **Check WiFi client isolation.** Guest and public networks often block device-to-device traffic. That does not stop the introduction at the broker, so the station gets past "connecting" and then fails to open a channel. Put both devices on the normal network, or fall back to the cross-internet path below, which relays through TURN instead of going device-to-device
4. **Look at the logs.** The connect screen has a **Download logs** button, and every screen keeps the same ring buffer. The peer lines (`[PeerClient] ...`) name the identity being targeted and the reason for each retry
5. **Only then look at TURN.** TURN is used only when the two browsers can't reach each other directly, which on the same WiFi they can. A red TURN indicator does not explain a same-WiFi station that won't connect

## Cross-internet stations (cellular, remote networks)

A station on the same WiFi as the main screen connects directly, peer-to-peer, and never needs TURN or any port-forwarding. Everything below only applies when a station is on a different network, a phone on cellular, someone joining from their own home.

Such a station also has to load the app itself from somewhere reachable, which your LAN address is not. The link and QR in Add Station already point at the public build (`ksp-gonogo.github.io/gonogo/station`) whenever the main screen is running on a local address, so the usual answer is "it loads from GitHub Pages and needs nothing forwarded". Only a fork hosting its own build needs to think about this, via `VITE_STATION_URL`.

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

When the relay runs on a public Linux box (as in the production setup described in [DEPLOYMENT.md](DEPLOYMENT.md#port-forwarding-for-off-network-stations)), it auto-discovers its public IP at startup, so no extra configuration is needed.

A relay containerized on a macOS host relays cross-internet traffic fine once both of the above are in place, it's been verified end-to-end with a station on cellular. A public Linux host is the better always-on choice (stable public IP, no home port-forwarding), but it isn't a requirement.

## Checking the relay works

Open the **Add Station** modal on the main screen. An indicator at the bottom checks whether the relay's TURN server is reachable. This matters only for stations out on the internet, which need TURN to connect: green means a cross-internet station can be relayed, red usually means a missing port-forward or the wrong public address. A station on the same WiFi connects regardless of what this indicator says, because it doesn't use TURN; if one is failing, work through [When a station won't connect](#when-a-station-wont-connect) instead.

The probe runs in the main screen's browser and looks for the relay at `http://localhost:3002`, so run the main screen on the machine the relay is on. Open it from a second computer and the indicator reports no TURN even when the relay is healthy.
