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

Open **Add station** on the main screen. It shows a link and a share code. A friend opens the link, enters the code, and you approve them. The link points at the public site for the version you run: `https://ksp-gonogo.github.io/app/station` if you run a release, `https://ksp-gonogo.github.io/rc/station` if you run the release candidate (`:rc`) image.

- Friends on your home network join with nothing to set up
- Most friends over the internet join with nothing to set up either
- Some networks can't connect directly: phones on mobile data, strict work or university networks, and carrier-grade NAT (an internet provider sharing one address between many customers). For those, Gonogo sends their data through the relay in the container, which needs ports open on your router, as described below

The share code stays the same until you press **New share code**, or until the main screen browser's site data is cleared. Codes aren't case-sensitive and never contain `0`, `O`, `1`, `I` or `L`.

### What the chips mean

Each connected station gets a chip in the Add station panel showing how it is connected:

| Chip | Meaning |
| --- | --- |
| **direct (LAN)** | The station is on your home network and talks straight to the main screen |
| **direct (internet)** | The station is elsewhere and found a direct route to the main screen. Nothing was forwarded |
| **relayed** | The station couldn't connect directly, so its data goes through the relay. This only works with the ports below open |
| **path unknown** | The connection is up but the browser hasn't reported how yet |

The status line at the bottom of the panel says whether the relay can be reached from outside. Green means the relay answered. It doesn't prove a friend on mobile data can get through, only a friend connecting does.

## Cross-internet stations (cellular, remote networks)

Skip this section if everyone joins from your home network, or if your friends already connect. It matters only for a friend whose network can't connect directly.

The relay needs these ports on your router, sent to the main screen computer:

| Port | Protocol | What it is for |
| --- | --- | --- |
| `3478` | TCP and UDP | A relayed station finds the relay here |
| `49160-49169` | UDP | The relayed data itself. Each relayed connection holds one port for each network adapter on the friend's device, so plan on 2 per friend: the 10 here cover 5 friends |

Forward the whole range, not just the first few: the relay picks ports from it at random. Some routers want one entry per port. Don't forward `3002` or `8080`.

To serve more friends, change both numbers in the `-p 49160-49169:49160-49169/udp` part of the run command and the router forwards to the same wider range, and add `-e TURN_MIN_PORT=<first> -e TURN_MAX_PORT=<last>` to the command.

Choose one of two ways to open them:

**Open them yourself.** Forward the ports above in your router's settings. Give the main screen computer a fixed address on your network first (a reservation in the router is easiest), or the forwards point at nothing when its address changes.

**Let Gonogo open them.** Add `-e GONOGO_UPNP=1` to the run command. The relay then talks directly to your router (NAT-PMP, then UPnP), asks it to open the ports above, renews them while it runs, and removes them when the container stops. It is off unless you set it. If the Add station window says the router refused or did not answer:

- Many routers have UPnP switched off, so check the router's settings
- Add `-e ROUTER_IP=<router address>` and `-e LAN_IP=<this computer's address>` to the command. The router address is the "Default Gateway" in `ipconfig` on Windows, or the `via` address of `ip route get 1.1.1.1` on Linux

The relay finds your public address on its own. If it guesses wrong (more than one internet connection, a changing address on a dynamic DNS name), add `-e TURN_EXTERNAL_IP=<your public IP>`. If your provider puts you behind carrier-grade NAT, forwarding can't help, because the main screen computer has no public address to reach.

### Camera feeds

Kerbcast video does not go through the main screen. A station connects to the camera sidecar on the KSP computer directly, and the sidecar picks its own UDP ports for video, with no fixed range to forward. So video to a friend on another network goes through the relay when a direct route fails, using the same ports above.

## A station won't connect

- **Is the main screen tab open and awake?** If it closed or the computer slept, every station stops
- **Is the share code right?** Copy it from the Add station panel the friend is joining. After **New share code**, the old one stops working
- **Is the friend on mobile data or a strict network?** Check the status line in the Add station panel. If it says the relay can't be reached from outside, check the ports above and the fixed address
- **Is a relayed station slow?** Relayed stations send everything through your internet upload
- **Does nothing connect, even on your home network?** Stations need an internet connection to find the main screen, so check that both ends are online

More steps are in the app under **Settings, Help**, **A station will not connect**.

## Privacy

To work out a route between two devices, each asks a public Google or Cloudflare server what its own public address is. Those servers see that address at join time and carry no game data or share code.
