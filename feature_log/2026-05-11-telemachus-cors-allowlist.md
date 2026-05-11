# Telemachus CORS allowlist + README update

- **Date:** 2026-05-11 (continued overnight work after the
  2026-05-11-overnight-telemachus-consumers entry)
- **Validation:** ⏳ pending — fork code compiled clean and installed,
  but unverified in a live session. Two checks pending the next KSP
  boot: (a) the new `ALLOWED_ORIGINS` config line is read correctly
  by the plugin and surfaced in the boot log; (b) a `fetch()` from
  the gonogo SPA against a configured origin successfully reads the
  response body.

## Why

`gonogo`'s data source (`packages/app/src/dataSources/telemachus.ts`)
fires actions via `fetch(url, { mode: "no-cors" })`. That dodges the
question of whether Telemachus emits proper CORS headers — the request
fires, the action takes effect, but the response body is opaque to JS.
For every action where the state change arrives moments later over the
WebSocket, that's fine. For `alarm.add` it isn't: the returned alarm
id is needed to mirror the local alarm into stock KSP's AlarmClock and
later delete it.

Grep of the fork source confirmed there's **no CORS handling anywhere**
— Telemachus has historically served only its bundled HTML UI on its
own port (same origin, no CORS friction), so neither the original mod
nor any prior fork ever needed it. gonogo's deployed-on-GitHub-Pages-
talks-to-LAN-Telemachus architecture is the unusual case.

## Design — config-driven echo-origin allowlist

`Access-Control-Allow-Origin: *` would unblock gonogo but also expose
the action surface (alarms, launches, contracts, facility upgrades) to
any origin reachable via DNS rebinding. Config-driven allowlist is the
honest trade-off: user opts specific origins in, default-off keeps
existing setups unchanged.

The header value **echoes the matched origin** rather than emitting
`*`. Same permissiveness for configured clients but the response stays
valid in browsers that reject `*` when `Origin` is present, and it's
explicit about which origin was authorised. Also emits `Vary: Origin`
so any caches in the path don't return one origin's response to
another.

### Files changed (fork side, gitignored)

```
local_docs/telemachus-fork/Telemachus/src/ServerConfiguration.cs
    + List<string> AllowedOrigins property (default empty)

local_docs/telemachus-fork/Telemachus/src/TelemachusBehaviour.cs
    + readConfiguration() parses ALLOWED_ORIGINS as comma-separated list
    + Trailing slashes and empty entries trimmed on load
    + Logs the populated list at boot

local_docs/telemachus-fork/Telemachus/src/DataLinkResponsibility.cs
    + Optional ServerConfiguration in ctor (default null for back-compat)
    + applyCorsHeader() helper — sets Access-Control-Allow-Origin + Vary
      when the request's Origin is in the allowlist
    + OPTIONS preflight handler — responds 204 with Allow-Methods +
      Allow-Headers + Max-Age when the request is OPTIONS and the
      origin is allowlisted. Forward-compat for future endpoints that
      take custom headers; Telemachus's current GET-only surface
      doesn't strictly need preflight handling, but it's free safety.
```

DLL: 1,078,272 bytes installed at 2026-05-11 07:19 to
`kspdata/GameData/Telemachus/Plugins/Telemachus.dll`.

### Config example

Telemachus uses KSP's `PluginConfiguration` which writes XML, not the
.cfg format. The file lives at
`Plugins/PluginData/Telemachus/config.xml` and already contains
`PORT`/`IPADDRESS`/`PARTLESS` lines. Add a sibling `<string>` entry
inside the `<config>` element:

```xml
<string name="ALLOWED_ORIGINS">http://localhost:5173,https://jonpepler.github.io</string>
```

Multiple origins comma-separated, no trailing slashes, no wildcards.
Restart KSP — the file is read once at plugin start, not on
ModuleManager reload. Verify with curl:

```
curl -i -H "Origin: http://localhost:5173" \
  "http://192.168.86.33:8085/telemachus/datalink?kc.scene=kc.scene"
```

Response should include `Access-Control-Allow-Origin: http://localhost:5173`
and `Vary: Origin`. Without an `ALLOWED_ORIGINS` line, no CORS headers
are emitted (historical default).

## README

Added a "Enabling CORS" subsection under "Telemachus Reborn" in the
README with the config example and a security note about the action
surface (`alarms / launches / contracts / facility upgrades`) being
accessible to any allowlisted origin. Default-off so existing users
who don't need the feature aren't disturbed.

## Outstanding

- **Live verification** of the boot-log line + a real cross-origin
  fetch from the dev server against the configured origin.
- **`executeAndRead` data-source path** — once CORS is verified, the
  data source needs a sibling method to `execute()` that drops
  `mode: "no-cors"` and parses the response. Unblocks the stock alarm
  mirror; trivial change. Pending until CORS is verified live so we
  don't ship a broken read path against a CORS-less Telemachus.
- **Stock alarm mirror** — implements via `executeAndRead`. Title
  prefix `gonogo:<localAlarmId>` for reconciliation on host startup;
  TimeTrigger only (threshold + contract-parameter have no stock
  equivalent, see prior entry). Pending the data source update.
- **Upstream PR candidate**: this is a clean addition (single optional
  config, default-off, no behaviour change without explicit opt-in).
  Worth offering upstream to TelematicusReborn.
