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
