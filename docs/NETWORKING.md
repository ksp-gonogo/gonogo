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

A station enters the share code; gonogo matches that code to the main screen through the relay, then the two connect peer-to-peer. The relay always has to be running for a station to join, even on the same WiFi, because the share code is looked up there. The station device itself needs to be able to reach the relay.

For a station out on the internet (a phone on cellular, a friend at their own house) to reach the relay, the computer running the relay has to be reachable from outside your home network, which means forwarding some ports on your router. That setup, and the relay's ports, are covered in [DEPLOYMENT.md](DEPLOYMENT.md).

Because the single-command gonogo setup isn't built yet, the relay side is still developer-shaped today, and reaching it from a separate station device takes some manual setup. Expect that to get simpler once the packaged setup lands.

## Checking the relay works

Open the **Add Station** modal on the main screen. An indicator at the bottom checks whether the relay is reachable: green means a station out on the internet can connect, and red usually means a missing port-forward or the wrong public address.
