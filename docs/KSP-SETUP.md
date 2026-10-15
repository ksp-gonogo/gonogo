# Connecting Gonogo to KSP

Gonogo reads your game through mods installed in KSP. This page covers only what you do before the app is open. Everything after that is in the app itself, under **Settings, Help**: connecting from another computer, checking telemetry is arriving, what an empty widget means and Uplinks.

## The mods you need

Gonogo is built for KSP 1.12. One mod is required: the **Gonogo mod**. Everything else is optional: each add-on is an Uplink, a small mod that connects Gonogo to one other mod and adds its widgets.

## Installing the Gonogo mod

The mod is not in a mod manager yet. Download `Gonogo-v<version>.zip` from the [releases page](https://github.com/ksp-gonogo/gonogo/releases), unzip it and copy the folders inside its `GameData/` into your KSP install's `GameData/`, so that `Squad/` and `Gonogo/` sit side by side. On Steam, find the install with Manage, Browse local files. Until a release carries the zip there is nothing to download.

To install an Uplink, do the same with its zip from the [Uplinks releases page](https://github.com/ksp-gonogo/gonogo-uplinks/releases), after installing the mod it connects to.

The mod listens on port 8090 with no password, and that port accepts commands that act on your game. Keep it to a network you trust and do not forward it to the internet.

## Checking telemetry is arriving

Open the app, then **Settings, Help, Checking telemetry is arriving**. The first-run setup runs the same checks for you, and **Settings, Connection, Run setup again** opens it again.

For running KSP on a second computer, firewalls and stations, see [NETWORKING.md](NETWORKING.md).

## Signal loss and CommNet

Gonogo makes distance matter. Commands to a craft and readings from it take the time light needs to cross the distance between mission control and the craft, so a probe at Duna answers minutes after you ask. Signal delay is on by default, at real light speed. A craft that is out of contact, behind a planet or past the range of its antennas, is out of contact whether delay is on or off.

### Turning signal delay off, or changing the speed

The choice belongs to the save, so each game has its own. Set it in KSP under **Settings, Difficulty options, Gonogo**, when you create a game or at any time in one that is running. It has two settings:

- **Signal delay** is the switch. Off, commands and readings arrive at once
- **Light speed** is how fast signals travel as a fraction of the speed of light, from 0.01 to 100. 1 is real light speed, and 0.5 doubles every delay. It cannot be 0, because that would mean a delay that never ends

The same two settings appear in the Gonogo app, under **Settings, Gonogo, Signal delay**, while KSP is connected, and a change in either place shows in the other within a second. Turning delay off delivers every command still on its way at once, in the order you sent them, and releases the science, reputation and funds still waiting to reach mission control. Raising the light speed brings both forward by the same share, and lowering it changes nothing already sent. A command held because its craft has no path stays held: only the waiting is removed, not the missing path.

A save made with an earlier build of the mod used a `SIGNAL_DELAY` entry in `GameData/Gonogo/PluginData/gonogo.cfg`. That entry is no longer read: set the choice in the difficulty options instead.

### What still applies with signal delay off

Switching delay off removes the waiting and nothing else. Gonogo still follows the game's CommNet, so a craft behind a planet or beyond its antennas' reach is out of contact, loses its readings during a blackout, and refuses commands while it has no path to mission control.

### Stock CommNet is a different setting

KSP's own **Enable Comm Network** option, in the same difficulty screen, is not the same thing. With it off, the game treats every craft as in perfect sight of mission control: nothing is occluded and nothing blacks out, so there is no signal loss to model. Gonogo then reports every craft as in contact.
