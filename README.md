[![Container: ghcr.io/ksp-gonogo/gonogo](https://img.shields.io/github/v/release/ksp-gonogo/gonogo?label=ghcr.io%2Fksp-gonogo%2Fgonogo)](https://github.com/ksp-gonogo/gonogo/pkgs/container/gonogo)

# Gonogo

A telemetry mod system and mission control dashboard for [Kerbal Space Program](https://www.kerbalspaceprogram.com/). The mod captures live data and makes it available through an API. The Gonogo app provides a UI for a multiplayer mission control experience, with movable widgets for all kinds of data.

[![npm: @ksp-gonogo/sitrep-sdk](https://img.shields.io/npm/v/%40ksp-gonogo%2Fsitrep-sdk?label=%40ksp-gonogo%2Fsitrep-sdk)](https://www.npmjs.com/package/@ksp-gonogo/sitrep-sdk)
[![npm: @ksp-gonogo/ui-kit](https://img.shields.io/npm/v/%40ksp-gonogo%2Fui-kit?label=%40ksp-gonogo%2Fui-kit)](https://www.npmjs.com/package/@ksp-gonogo/ui-kit)
[![npm: @ksp-gonogo/uplink-tools](https://img.shields.io/npm/v/%40ksp-gonogo%2Fuplink-tools?label=%40ksp-gonogo%2Fuplink-tools)](https://www.npmjs.com/package/@ksp-gonogo/uplink-tools)
[![NuGet: KspGonogo.Sitrep.Contract](https://img.shields.io/nuget/v/KspGonogo.Sitrep.Contract?label=KspGonogo.Sitrep.Contract)](https://www.nuget.org/packages/KspGonogo.Sitrep.Contract/)

**Quickstart:** [Gonogo Home Page](https://ksp-gonogo.github.io/)

**Joining a friend's game?** Nothing to install: [jump to joining](#joining-a-game).

<img src="docs/assets/hero-dashboard.gif" alt="The Gonogo dashboard flying a three-stage craft from the pad to orbit: a ground track, orbit view, altitude and orbital speed graph, fuel and delta-v readouts, a system view and SAS and fairing action groups" />

<p align="center">
  <img src="docs/assets/navball-sizes.gif" alt="Six Navball panels side by side, from a three-line heading, pitch and roll readout to the full ball with heading tape, throttle, SAS mode buttons and fly-by-wire controls, all showing the same flight at the same moment" />
</p>

## Signal Delay

<img src="docs/assets/light-delay-rail.gif" alt="The delay rail on a Throttle panel: a throttle pulse crosses from left to right through three zones, outgoing to the craft, the echo coming back, and confirmed at the command centre" />

Gonogo features an _optional_ signal delay, on by default. Signals in the game are modelled under a real propagation system; it takes longer to get flight data from vessels further away, and vessels occluded behind planets and out of range won't be able to communicate. Signals get routed through available relay nodes to command centres, via a model heavily inspired by [NASA's Contact Graph Routing](https://ntrs.nasa.gov/citations/20120006508) system.

### Pilots and stations

Every screen has a seat. A **station** is a screen at mission control, so it sees the active vessel with the signal delay. A **pilot** is a screen on the active vessel, so it sees the vessel with no delay, as if from the cockpit. Any number of either can join. Pilots share one Commcast name and cannot push widgets to the main screen. See [Starting a game](#starting-a-game) and [Joining a game](#joining-a-game).

## Uplinks

Uplinks are the name for Gonogo's own mod support. They can extend and modify core behaviour and widgets, and add their own. Uplinks are generally used for creating integrations with other KSP mods. Uplinks currently exist for mods like [kOS](https://github.com/ksp-gonogo/gonogo-uplinks/blob/main/uplinks/kos/README.md), [SCANSat](https://github.com/ksp-gonogo/gonogo-uplinks/blob/main/uplinks/scansat/README.md), [Kerbcast](https://github.com/ksp-gonogo/gonogo-uplinks/blob/main/uplinks/kerbcast/README.md), [RP-1](https://github.com/ksp-gonogo/gonogo-uplinks/blob/main/uplinks/rp1/README.md), and [Principia](https://github.com/ksp-gonogo/gonogo-uplinks/blob/main/uplinks/principia/README.md).

_You can search for Uplinks in CKAN by filtering for `dep:Gonogo`._

<p align="center">
  <img src="docs/assets/uplinks-showcase.gif" alt="Uplink widgets in turn, in two columns: the kOS terminal running a descent script, Kerbalism Crew Status with a crew member past the radiation limit, the RP-1 Programme Manager's funding curve and the Rendezvous docking camera closing on a target port, beside Kerbalism Space Weather during a storm, the Kerbcast camera feed, the RP-1 Space Center's site construction queue and the Principia burn editor's ignition time being dialled in" />
</p>

## Recommended Ways to Play

_Mission Control_. Use KSP exclusively for VAB/SPH. Either automate flights or have a pilot crew team in another location for flights. Run Gonogo to create a mission control dashboard, and have everyone in your group join as their own station for their own discipline. At large distances, you'll notice that the dashboard takes longer to receive data; you'll have to plan better.

_Data Visualisation Companion_. Run Gonogo as a second screen while you fly, to track data that you care about.

## Host it yourself

You need KSP 1.12 and Docker, or another container tool such as Podman.

1. Install the Gonogo mod from CKAN or SpaceDock. To install it by hand, see [KSP setup](docs/KSP-SETUP.md)
2. Get [Docker](https://docs.docker.com/get-started/get-docker/) or similar, and start it
3. Paste this into a terminal, with the KSP computer's IP address in place of `<ksp-ip>`. On Windows, use the Windows command below

```bash
docker run -d --name gonogo --restart unless-stopped --pull always \
  -e KSP_HOST=<ksp-ip> \
  -p 8080:8080 -p 127.0.0.1:3002:3002 \
  -p 47100:47100/udp -p 47100:47100/tcp \
  ghcr.io/ksp-gonogo/gonogo:latest
```

Find the IP on the KSP computer: `ipconfig` on Windows (IPv4 Address), `ip addr show` on Linux, or System Settings, Network on macOS.

<details>
<summary>KSP on this computer</summary>

Use `host.docker.internal` as the address, and add the `--add-host` line:

```sh
docker run -d --name gonogo --restart unless-stopped --pull always \
  --add-host=host.docker.internal:host-gateway \
  -e KSP_HOST=host.docker.internal \
  -p 8080:8080 -p 127.0.0.1:3002:3002 \
  -p 47100:47100/udp -p 47100:47100/tcp \
  ghcr.io/ksp-gonogo/gonogo:latest
```

</details>

<details>
<summary>Windows</summary>

Press Start, type PowerShell, open Windows PowerShell, then right-click to paste this and press Enter. Do not paste the version above with `\` there. Put the KSP computer's IP address in place of `<ksp-ip>` before pressing Enter.

```powershell
docker run -d --name gonogo --restart unless-stopped --pull always -e KSP_HOST=<ksp-ip> -p 8080:8080 -p 127.0.0.1:3002:3002 -p 47100:47100/udp -p 47100:47100/tcp ghcr.io/ksp-gonogo/gonogo:latest
```

</details>

<details>
<summary>Podman</summary>

Podman 5 or later. Type `podman` in place of `docker`, in this command and every other one here. On macOS and Windows, run `podman machine start` first. With rootless Podman, use this computer's IP address in place of `host.docker.internal` when KSP runs on it.

</details>

   `127.0.0.1:3002` keeps the relay's own port on this computer only; leave it as it is. Every setting the container takes is in [the settings table](docs/CONFIGURATION.md).

   If Docker says the name `gonogo` is already in use, a container from an earlier install exists. Run `docker rm -f gonogo`, then the command again.

   For friends joining from another network, see the [networking guide](docs/NETWORKING.md#friends-on-other-networks).

4. Start KSP, load a save, and open [localhost:8080](http://localhost:8080)

The setup wizard opens by itself and checks each part. For friends joining from other networks, see the [networking guide](docs/NETWORKING.md#friends-on-other-networks).

## Starting a game

The setup wizard ends by asking which seat this screen starts in:

- **Mission control**: the main screen, with the signal delay
- **Pilot**: a screen on the active vessel, with no delay

Either way, this screen hosts the game. Keep its tab open while you play, because everyone else's screen gets its data through it.

## Inviting people

Open the round **Menu** button in the corner of any screen, then **Invite**, and send the address, QR code or code it shows. Anyone in the game can invite the next person.

## Joining a game

Go to [ksp-gonogo.github.io](https://ksp-gonogo.github.io/) and enter the code under **Join a game**, or open the address you were sent. Nothing to install.

## Firewall

- Windows: if asked, tick Private networks and Allow for KSP and Docker
- Linux with ufw: `sudo ufw allow in on docker0 to any port 8090 proto tcp`, so the container can reach KSP. Ports Docker publishes (`8080`, `47100`) ignore ufw
- Never forward port 8090 to the internet: it accepts commands to your game with no password

## Upgrading from an earlier version

- **Mod:** replace the `Gonogo` folder in `GameData`, or update it through CKAN
- **App:** run `docker rm -f gonogo` to remove the existing container (the run command refuses to start while one has the name), then the `docker run` command above again ([`--pull always`](https://docs.docker.com/reference/cli/docker/container/run/) fetches the newest image)
- **Uplinks:** update each one through CKAN, or replace its folder in `GameData`. An Uplink built for another Gonogo version will refuse to run

## If something is not working

Use **Settings > Connection > Run setup again**.

- KSP stops sending data when its window loses focus. With KSP and Gonogo on one computer, close KSP, set `SIMULATE_IN_BACKGROUND = True` in `settings.cfg` in the KSP folder, and save
- `docker ps` should list `gonogo`
- `docker logs --tail 50 gonogo` says why it stopped
- Another program on port 8080: `docker rm -f gonogo`, then change the left number in `-p 8080:8080` and run it again

## More

- [Uplink developer docs](https://ksp-gonogo.github.io/uplink-dev-docs/)
- [API reference](https://ksp-gonogo.github.io/gonogo/api/)
- [KSP setup](docs/KSP-SETUP.md) and [networking](docs/NETWORKING.md)
- [Contributing](CONTRIBUTING.md)
- [Licence](LICENSE)
