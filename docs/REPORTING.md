# Reporting a problem

Open a [bug report](https://github.com/ksp-gonogo/gonogo/issues/new?template=bug_report.yml). The form asks for the things below, and most of them take a minute to find. In the app, **Settings, Logs, Open a GitHub issue** opens the form with the versions, your Uplinks and the app's recent log already filled in.

## Find the versions

In the app, open **Settings** and scroll to **About** at the bottom of the General tab:

- **Gonogo** is the app version (on a station it reads **This station**, with **Main screen** under it)
- **Mod** is the version of the Gonogo mod running in KSP
- **Contract** is the version the app and the mod agree on

Open **Settings, Uplinks** for the Uplinks you have installed, with the version beside each. If you run the app in the container, the image tag is the part after the colon in the `docker run` command you used (for example `:rc`), or run `docker inspect gonogo --format "{{.Config.Image}}"`.

The KSP version is on the bottom left of the KSP main menu.

## Find KSP.log

KSP writes `KSP.log` into its install folder, next to the game. On Steam, right-click Kerbal Space Program in your library, then Manage, then Browse local files. The usual places:

| System | Where |
|---|---|
| Windows | `C:\Program Files (x86)\Steam\steamapps\common\Kerbal Space Program\KSP.log` |
| macOS | `~/Library/Application Support/Steam/steamapps/common/Kerbal Space Program/KSP.log` |
| Linux | `~/.local/share/Steam/steamapps/common/Kerbal Space Program/KSP.log` |
| Steam Deck | `~/.local/share/Steam/steamapps/common/Kerbal Space Program/KSP.log`, in Desktop Mode |

The log is replaced each time KSP starts, so copy it before you start the game again.

## Get the Gonogo lines

The mod's lines all start with `[Gonogo]`. Run the command for your system from the KSP install folder:

```
grep "\[Gonogo\]" KSP.log
```

```
findstr /C:"[Gonogo]" KSP.log
```

The first is for macOS, Linux and the Steam Deck, the second for Windows. Paste the output into the form. If the problem is a crash or KSP would not start, attach the whole `KSP.log` instead.

## Copy the browser console

Open the page with the problem, then:

1. Press `F12` (or `Cmd+Option+J` on macOS in Chrome) to open the developer tools
2. Choose the **Console** tab
3. Reproduce the problem
4. Right-click in the console, choose **Save as** to keep it as a file, or select the red lines and copy them

The app also keeps its own log. Open **Settings, Diagnostics** and press **Download** under **Log buffer**. On a station that cannot get past the connect screen, use the **Download logs** button there.

## What to include

- What happened, and what you expected instead
- The steps that make it happen, from a fresh page load if you can
- The versions above
- Whether it was the main screen or a station, and what the station runs on (phone, tablet, browser)
- The `[Gonogo]` lines from `KSP.log`, and the browser console if the page misbehaved

Leave out anything private. Logs can contain your computer's network address, so remove it if you would rather not share it.
