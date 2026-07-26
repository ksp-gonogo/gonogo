# Creating an Uplink

An **Uplink** extends gonogo with new telemetry, commands, and dashboard widgets. It is two halves
shipped as one unit:

- a **mod** (a C# DLL installed into KSP) that declares **Topics** (data it publishes) and **Commands**
  (actions it accepts)
- a **client** (a TypeScript/React bundle) that self-registers the **widgets and augments** which read
  those Topics and fire those Commands

The two halves share one identity (an `id` like `scansat`) and one version line. You own and host both.
There is no central marketplace to submit to and no reviewer to wait on: the gonogo app discovers your
Uplink because its mod is installed and running, fetches your client bundle from wherever you host it,
verifies it against a hash, and loads it. This guide walks the whole path.

The built-in Uplinks are the reference: `mod/GonogoScansatUplink/` (Topics + widgets + augments) and
`mod/GonogoKosUplink/` (Topics + Commands). They use exactly the same public API you will. Read them
alongside this guide.

---

## Repo layout

Keep the two halves co-located, mirroring the first-party layout:

```
my-uplink/
  MyUplink.cs                 # the mod half (C#)
  MyUplink.csproj
  client/
    src/
      uplink.ts               # defineUplinkClient(...): the client identity
      index.ts                # side-effect registration entry point
      MyWidget/index.tsx      # a widget, registered with owner: MY_UPLINK
    package.json
    gonogo-uplink.json        # build-generated version + compat manifest (see Versioning)
```

---

## Part 1: the mod half

A mod class implements `ISitrepUplink` and carries the `[SitrepUplink("<id>")]` attribute. The host
discovers it by that attribute, reads its `UplinkManifest`, and calls `Register`. The `id` in the
attribute is the identity that ties the two halves together: it MUST match your client's
`defineUplinkClient` id and your `gonogo-uplink.json` id.

```csharp
using System.Collections.Generic;
using Sitrep.Contract;

[SitrepUplink("my-uplink")]
public sealed class MyUplink : ISitrepUplink
{
    public const string ReadingTopic = "my-uplink.reading";
    public const string ResetCommand = "my-uplink.reset";

    public UplinkManifest Manifest { get; } = new UplinkManifest
    {
        Id = "my-uplink",
        Version = "1.0.0",

        // Topics this Uplink publishes. Each ChannelDeclaration names a Topic,
        // its delivery mode, its emission cadence, and its delay role.
        Channels = new List<ChannelDeclaration>
        {
            new ChannelDeclaration
            {
                Topic = ReadingTopic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                // Delayed rides the light-time signal delay like any vessel-sourced
                // value; TrueNow bypasses it (only for genuine ground-side facts)
                Delay = DelayRole.Delayed,
            },
        },

        // Commands this Uplink accepts. Delayed:false runs immediately (a game
        // or player action); Delayed:true rides the signal delay (a command to
        // the craft).
        Commands = new List<CommandDeclaration>
        {
            new CommandDeclaration { Command = ResetCommand, Delayed = true },
        },
    };

    // Mandatory health self-report. Return Healthy once registered; return
    // Unavailable(reason) when a dependency is missing so the app can say why.
    public UplinkHealth Health() => UplinkHealth.Healthy;

    public void Register(IUplinkHost host)
    {
        // Publish a Topic: map the current game snapshot to the value.
        host.AddChannelSource(ReadingTopic, snapshot => ReadReading(snapshot));

        // Handle a Command: typed args in, a CommandResult out.
        host.AddCommandHandler<object?, CommandResult>(ResetCommand, args => Reset());
    }

    private object? ReadReading(KspSnapshot? snapshot) => /* ... */ null;
    private CommandResult Reset() => CommandResult.Ok();
}
```

Key points:

- **`Health()` is mandatory** and cheap: it is polled on a background thread, so read a cached field, not
  live KSP state. Return `UplinkHealth.Unavailable(reason)` when your dependency is absent, and the app
  surfaces that reason instead of the widget silently doing nothing
- **`AddChannelSource`** publishes a Topic from the main-thread game snapshot; **`AddSampledSource`** is the
  gated, higher-cost variant for expensive reads (see `ScansatUplink.cs`)
- **Topic and Command names are namespaced by your id** (`my-uplink.reading`), which keeps them from
  colliding with other Uplinks

---

## Part 2: the client half

### Declare the client identity

Every client bundle declares its identity once, in `client/src/uplink.ts`, with `defineUplinkClient` from
the SDK. It returns a frozen handle:

```ts
// client/src/uplink.ts
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// Phase 2 build-injects this from gonogo-uplink.json; a placeholder until then
const UPLINK_VERSION = "0.0.0-dev";

export const MY_UPLINK = defineUplinkClient({
  id: "my-uplink", // MUST match [SitrepUplink("my-uplink")] and gonogo-uplink.json
  version: UPLINK_VERSION,
  name: "My Uplink",
});
```

### Register widgets and augments with `owner`

Every widget and augment your client registers stamps that handle as `owner`. This is the whole point of
the handle: the widget picker's mod search tags derive from `owner.id` automatically, so a user searching
"my-uplink" finds your widgets with no per-widget field to remember.

```tsx
// client/src/MyWidget/index.tsx
import { registerComponent } from "@ksp-gonogo/core";
import { MY_UPLINK } from "../uplink";
import { MyWidget } from "./MyWidget";

registerComponent({
  id: "my-widget",
  name: "My Widget",
  category: "telemetry",
  component: MyWidget,
  dataRequirements: ["my-uplink.reading"],
  actions: [],
  defaultConfig: {},
  owner: MY_UPLINK, // <- stamps ownership; search tags derive "my-uplink"
});
```

> If you are migrating an older client: the previous per-widget `mod` field is gone. Ownership now comes
> from `owner: <handle>`, and the search tag derives from `owner.id`. Delete any old `mod:` field

Inside the widget, read Topics with `useTelemetry` and fire Commands with `useCommand`, keyed by the same
namespaced names the mod declared:

```tsx
const reading = useTelemetry("my-uplink.reading");
const reset = useCommand("my-uplink.reset");
```

### Wire the side-effect entry point

`client/src/index.ts` is the entry the app loads. Registration happens as a side effect of import, so keep
the registration imports as **bare imports** (never let a bundler tree-shake them away):

```ts
// client/src/index.ts
import "./uplink";     // defineUplinkClient(MY_UPLINK) runs first
import "./MyWidget";   // registerComponent(... owner: MY_UPLINK)
```

---

## The one version line and the compat gate

An Uplink has **one version** spanning both halves. You never hand-write the compatibility numbers: a
build step generates `gonogo-uplink.json`, the sidecar manifest that ships next to your client bundle. Its
shape (`GonogoUplinkManifest`):

```json
{
  "id": "my-uplink",
  "version": "1.2.0",
  "minAppVersion": "1.0.0",
  "apiVersion": "1.0.0",
  "uiKitVersion": "0.1.0",
  "contractMajor": 1,
  "contractMinor": 0,
  "integrity": "sha256-..."
}
```

- **`apiVersion`** pins the `@ksp-gonogo/core` extension surface you built against (`EXTENSION_API_VERSION`)
- **`uiKitVersion`** pins the `@ksp-gonogo/ui-kit` design-system surface (`UI_KIT_VERSION`)
- **`contractMajor`/`contractMinor`** pin the telemetry contract your Topics and Commands speak
- **`minAppVersion`** is an advisory floor
- **`integrity`** is the sha256 of your client bundle

At load time the app runs `checkUplinkCompat(manifest, app)` and gets one of three verdicts:

- **`load`** compatible, proceed
- **`refuse`** a hard mismatch (an `apiVersion`, `uiKitVersion`, or contract major/minor the app can't
  honour); the Uplink is quarantined with the exact reason shown in the in-app Uplinks list
- **`warn-load`** the only soft case: the app is older than `minAppVersion`, logged but still loaded

Build these numbers, never type them. The mod side bakes its matching client hash the same way
(`mod/scripts/bake-client-hash.mjs` writes `ExpectedClientHash.g.cs`), so the running mod can vouch for the
exact bundle it expects.

---

## The externals rule (do not skip this)

Your client bundle MUST be built **external-expecting**. React, `@ksp-gonogo/core`, `@ksp-gonogo/ui-kit`,
`@ksp-gonogo/sitrep-sdk`, and `styled-components` are provided by the host app as singletons: declare them
as externals/peer dependencies and do NOT bundle your own copies.

```jsonc
// client/package.json (shape)
"peerDependencies": { "react": "^18.0.0" },
"dependencies": { "@ksp-gonogo/core": "...", "@ksp-gonogo/ui-kit": "...", "styled-components": "^6.0.0" }
```

Why this is not optional: the loader runs `import(bundleUrl)`, and the browser resolves your bundle's bare
imports (`@ksp-gonogo/core`, `react`) through the app's baked **import map** to the app's own singletons.
If you inline a second copy of React, you get two Reacts and hooks break; if you inline a second copy of
`@ksp-gonogo/core`, your `registerComponent` calls land in a **dead second registry** the app never reads,
and your widgets never appear. One React, one core, one ui-kit, provided by the host.

---

## Distribution

Decentralised by design: you own the repo and you host the bundle. There is no central hub.

- Publish your **mod** through CKAN like any KSP mod
- Host your **client bundle** yourself (a static host, a release asset, your own server) and ship its URL
  alongside the mod
- The app's registry descriptor for your Uplink carries the `bundleUrl` and the `integrity` hash

The load sequence the app runs for each Uplink (`packages/app/src/uplinks/loader.ts`):

1. resolve the version to load from the registry descriptor
2. run the compat gate + the mod-hash gate **before fetching any bytes** (import is irreversible, so
   nothing is fetched for an Uplink that will be refused)
3. ask for **consent** on first load of a given `id@version` (a remembered grant short-circuits next time)
4. fetch the bundle bytes
5. verify `sha256(bytes)` against the descriptor's `integrity`, and against the hash the running mod
   vouches for when it emits one (a three-way agreement: mod, index, bytes)
6. `import()` the bundle, which runs its `registerComponent(...)` calls against the host

Every refusal quarantines the Uplink with a legible reason in the in-app Uplinks list. There are no silent
loads and no silent no-ops. Note one hard requirement: integrity verification uses `crypto.subtle`, which
browsers only expose on a **secure origin**, so the gonogo main screen must be served over **https or
localhost**, not a bare LAN IP.

---

## The local dev loop

You will not want to publish a bundle to a public URL on every edit. The intended developer experience is
to point the app at a **local build** while you iterate: a localhost dev-server URL, or a local directory,
in place of the published `bundleUrl`, so an edit-refresh loop is instant.

That mod-side local-URL / dev-directory mechanism is not built yet (it is gated behind on-device Deck
work). The dev path is a promise this guide is making, not a button that exists today. Until it lands, the
first-party workflow is to develop your client as a workspace package imported into the app build (the
`import "@ksp-gonogo/gonogo-scansat-uplink"` line in `packages/app/src/main.tsx` is exactly this): the widget registers
and renders in `pnpm dev` with a normal HMR loop, and you switch to the fetch-and-verify loader path only
when you package for distribution. When the local-URL mechanism lands, this section will describe pointing
the loader at your local build directly.

---

## Checklist

- [ ] mod class carries `[SitrepUplink("<id>")]`, implements `ISitrepUplink`, and declares its Topics
      (`Channels`) and Commands
- [ ] `Health()` returns a cached verdict, never a live KSP read
- [ ] `client/src/uplink.ts` calls `defineUplinkClient` with the SAME id as the mod
- [ ] every `registerComponent` / `registerAugment` passes `owner: <handle>`
- [ ] `client/src/index.ts` bare-imports every registration module
- [ ] the bundle is built external-expecting (react, core, ui-kit, sdk, styled-components NOT inlined)
- [ ] `gonogo-uplink.json` is build-generated, never hand-written
- [ ] the mod is on CKAN and the client bundle is hosted with its URL + integrity hash
- [ ] the main screen is served over https or localhost so integrity verification works
