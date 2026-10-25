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

How a station joins depends on whether the relay in the container is running:

- **With the relay running**, every station joins through it, on one port: friends on your home network and friends over the internet alike. A friend on your home network needs nothing set up. A friend on another network needs that one port open on your router, as described below
- **Without the relay**, stations connect to the main screen tab directly. That works for friends on your home network only

The share code stays the same until you press **New share code**, or until the main screen browser's site data is cleared. Codes aren't case-sensitive and never contain `0`, `O`, `1`, `I` or `L`.

### What the chips mean

Each connected station gets a chip in the Add station panel showing where it joined from:

| Chip | Meaning |
| --- | --- |
| **this network** | The station is on your home network |
| **internet** | The station joined from another network |
| **path unknown** | The connection is up but the browser hasn't reported how yet |

The status line in the panel says whether the relay is running, and whether your router has the port open.

## Friends on other networks

Skip this section if everyone joins from your home network.

A friend on another network (a phone on mobile data, a friend at home) reaches the relay on one port, sent to the main screen computer:

| Port | Protocol | What it is for |
| --- | --- | --- |
| `47100` | UDP and TCP | Every station on another network, and the camera feeds it watches. UDP is the normal path; TCP is for a friend on a network that blocks UDP |

Forward both protocols. Don't forward `3002` or `8080`. To use another port, add `-e ENDPOINT_PORT=<port>` to the run command, change both `-p 47100:47100` parts to that port, and forward it instead.

The port only answers stations that joined with your share code: nothing else on the internet can use it.

Choose one of two ways to open it:

**Open it yourself.** Forward `47100` (UDP and TCP) in your router's settings. Give the main screen computer a fixed address on your network first (a reservation in the router is easiest), or the forward points at nothing when its address changes.

**Let Gonogo open it.** Choose "let Gonogo open the port on my router" in the setup's Friends on other networks step, or turn on **Automatic port forwarding** in Settings, under Relay, and enter two addresses there:

- **Your router's address.** It is usually printed on the router's label; this computer's network settings show it as Router or Default Gateway ("Default Gateway" in `ipconfig` on Windows)
- **This computer's address**, the one the router sends friends to. This computer's network settings show it as IP address ("IPv4 Address" in `ipconfig` on Windows)

The relay then asks that router, and only that router, to open the port to this computer (NAT-PMP, then UPnP), renews it while it runs, and removes it when it stops or you turn the setting off. It is off unless you turn it on. If the setup or the Add station window says the router refused or did not answer:

- Check both addresses you entered
- Many routers have UPnP switched off, so check the router's settings
- Otherwise forward the port by hand, as above

The relay finds your public address on its own. If it guesses wrong (more than one internet connection, a changing address on a dynamic DNS name), add `-e PUBLIC_IP=<your public IP>`. If your provider puts you behind carrier-grade NAT (an internet provider sharing one address between many customers), forwarding can't help, because the main screen computer has no public address to reach.

The container also needs this computer's address on your home network, because from inside a container it cannot see it, and friends on your home network are given it. `scripts/run-gonogo.sh` and `pnpm dev` fill it in; with a run command of your own, add `-e LAN_IP=<this computer's address>`.

### Camera feeds

Kerbcast video for a station on another network comes through the same port. The relay fetches each camera from the camera sidecar on the KSP computer over your home network and sends it on to the station, so nothing else needs forwarding. Each friend watching a camera is one copy of that video on your internet upload.

## A station won't connect

- **Is the main screen tab open and awake?** If it closed or the computer slept, every station stops
- **Is the share code right?** Copy it from the Add station panel the friend is joining. After **New share code**, the old one stops working
- **Is the friend on another network?** Check the status line in the Add station panel: it says whether the relay is running and whether the router has port `47100` open
- **Is a station on another network slow?** Those stations send everything through your internet upload
- **Does nothing connect, even on your home network?** Stations need an internet connection to find the main screen, so check that both ends are online

More steps are in the app under **Settings, Help**, **A station will not connect**.

## Privacy

A station finds the main screen through a public PeerJS server, which sees each device's address and share code at join time and carries no game data. The relay asks a public lookup service what your public address is when it starts. A station on your home network without the relay asks a public Google or Cloudflare server what its own public address is; those servers see that address and carry no game data or share code.
