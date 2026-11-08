# KSP setup

Gonogo needs KSP 1.12 and the Gonogo mod. Everything after that is set up in the app, which opens a setup wizard the first time you run it.

## Installing the Gonogo mod

Install **Gonogo** with CKAN, or download it from SpaceDock. CKAN installs its dependencies for you.

Uplinks are optional add-ons that connect Gonogo to other mods. Find them in CKAN by searching for `dep:GonogoCore`.

### Installing by hand

1. Download `Gonogo-v<version>.zip` from the [releases page](https://github.com/ksp-gonogo/gonogo/releases)
2. Copy the `Gonogo` folder from the zip's `GameData` into the `GameData` folder of your KSP install
3. Install the dependencies the same way

Dependencies:

- [Harmony 2](https://github.com/KSPModdingLibs/HarmonyKSP/releases) (its folder is `000_Harmony`)

Uplinks install the same way, from the [Uplinks releases page](https://github.com/ksp-gonogo/gonogo-uplinks/releases). Install the mod an Uplink connects to first.

## Keep port 8090 private

The mod listens on port 8090 with no password, and anything that reaches it can control your game. Keep it on a network you trust and never forward it to the internet.

## Checking it works

The setup wizard checks the connection to the mod for you. To run it again, open **Settings, Connection, Run setup again**. For KSP on a second computer, firewalls and stations, see [NETWORKING.md](NETWORKING.md).

## Signal delay

Commands to a craft, and readings from it, take as long as light takes to travel between mission control and the craft. A probe at Duna answers minutes after you ask. Signal delay is on by default, at real light speed.

Each save has its own setting. Change it in KSP under **Settings, Difficulty options, Gonogo**, when you create a game or at any time in one that is running:

- **Signal delay** turns it on or off
- **Light speed** is how fast signals travel, as a fraction of real light speed, from 0.00000001 to 100. At 0.5 every delay is twice as long. It cannot be 0

The same two settings are in the app under **Settings, Gonogo, Signal delay** while KSP is connected. A change in either place shows in the other within a second.

Turning delay off delivers every command still on its way at once, in the order you sent them, along with any science, reputation and funds still on their way to mission control. Raising the light speed brings them forward; lowering it leaves anything already sent alone. A command held because its craft has no path to mission control stays held.

### With signal delay off

Only the waiting goes away. Gonogo still follows CommNet: a craft behind a planet or out of antenna range is out of contact, sends no readings and refuses commands until it has a path to mission control again.

### KSP's own CommNet setting

**Enable Comm Network**, on the same difficulty screen, is a different setting. With it off, KSP treats every craft as always in contact, so Gonogo does too.
