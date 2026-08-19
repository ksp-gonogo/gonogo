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
import { registerComponent } from "@ksp-gonogo/sitrep-sdk";
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

- **`apiVersion`** pins the `@ksp-gonogo/sitrep-sdk` authoring surface you built against (`EXTENSION_API_VERSION`)
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

Import from **`@ksp-gonogo/sitrep-sdk`** and **`@ksp-gonogo/ui-kit`**. They are the
two packages gonogo publishes for RUNTIME, and between them they carry the whole
authoring surface: the hooks, every `registerX`, the generated contract, the unit
system and the design system.

There is a third, **`@ksp-gonogo/sitrep-testing`**, and it is a devDependency: your
tests import it, your widgets never do. See "Testing your Uplink" below.

Build your client bundle **external-expecting**. Declare `react`,
`styled-components` and the two gonogo packages as externals/peer dependencies,
and do NOT bundle your own copies.

```jsonc
// client/package.json (shape)
"peerDependencies": { "react": "^18.0.0" },
"dependencies": {
  "@ksp-gonogo/sitrep-sdk": "...",
  "@ksp-gonogo/ui-kit": "...",
  "styled-components": "^6.0.0"
},
"devDependencies": {
  "@ksp-gonogo/sitrep-testing": "..."
}
```

Why this is not optional: the loader runs `import(bundleUrl)` and the host resolves
your bare imports to its own singletons. Bundle a second copy of React and you get
two Reacts, so hooks break. Bundle a second copy of the SDK and your
`registerComponent` calls land somewhere the dashboard never reads, so your widgets
never appear.

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

## Testing your Uplink

Install **`@ksp-gonogo/sitrep-testing`**. It is the third and last package gonogo
publishes, and it is a devDependency: your widgets never import it, only your tests
do.

Your widgets call SDK hooks (`useTelemetry`, `useCommand`, `useStream`), and those
are shims that resolve through the host the app installs at boot. A unit test has no
app, so it has to install one. That is one line:

```ts
// client/src/test/setup.ts, in full
import { installDomStubs, installRealTestHost, PerfBudget }
  from "@ksp-gonogo/sitrep-testing";
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

installDomStubs();          // jsdom gaps: ResizeObserver, canvas, matchMedia
PerfBudget.installTestGate(); // fail a test that pushes a budget over its cap
installRealTestHost();      // wire the SDK shims to the real implementations
setQuantityLocale("en-GB"); // so a render is reproducible off your machine
```

You cannot write `installRealTestHost` yourself, and it is worth knowing why: the
implementations behind the shims are the app's, and passing a shim back in as its
own implementation is infinite recursion rather than a bridge. That is the single
thing this package exists to hand you.

### Running a widget off the real stream

`setupStreamFixture` builds a real `TelemetryClient` / `TimelineStore` / `ViewClock`
behind a `TelemetryProvider`, and you emit frames by hand. It is the same pipeline
the app runs, not a stand-in, so a test that passes here is evidence about the
stream and not about a mock of it.

```tsx
import { render, screen, setupStreamFixture, waitFor }
  from "@ksp-gonogo/sitrep-testing";

const fixture = setupStreamFixture({
  carriedChannels: ["mymod.reactor"],  // required: nothing is promoted silently
  pinnedUt: 1000,                      // omit to leave the clock live
});

render(
  <fixture.Provider>
    <ReactorPanel />
  </fixture.Provider>,
);

fixture.emit("mymod.reactor", { output: 42 });
await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
```

Two things that surprise everyone once:

- **`emit` is subscription-gated.** A frame nothing has subscribed to yet is
  dropped, exactly as in production. If your widget renders behind a gate, wait for
  the subscription (`fixture.transport.isSubscribed(topic)`) before emitting
- **`delaySeconds` and `pinnedUt` are mutually exclusive.** A pinned clock wins
  outright over the delay computation, which makes `delaySeconds` a silent no-op.
  To test delay, leave the clock live and drive it with
  `fixture.wall.advanceBy(seconds)` plus `fixture.store.beginFrame()`

### `render`, and the theme

`render` and `renderHook` come from here (or from
`@ksp-gonogo/sitrep-sdk/testing` if you want them without the spine) and they mount
the kit's theme for you. Every `@ksp-gonogo/ui-kit` primitive reads
`theme.space[…]` off the styled-components context, and with no provider that is a
TypeError rather than a fallback. Everything else Testing Library offers
(`screen`, `waitFor`, `within`, `act`, `fireEvent`) is re-exported unchanged, so
this is a drop-in for the import source.

---

## Showing a quantity, and testing that you did

Every number your Topic declares a unit for arrives as a `Value`: an object
carrying the magnitude AND the unit, not a bare number. Render it with `<Unit>`
and name neither:

```tsx
import { Unit } from "@ksp-gonogo/ui-kit";

<Unit value={reading.altitude} />;   // 12.4 km
```

That is the whole surface. The kit picks the ladder rung, the symbol, and how
the value is announced to a screen reader, so a change to any of those reaches
your widget without you editing it. **Do not format a quantity yourself.** A
hand-written `` `${x.magnitude / 1000} km` `` pins the rung, loses the styling,
and is read aloud as the letters "k", "m".

Two escapes exist for the places a React node cannot go, both from
`@ksp-gonogo/ui-kit`: `speakQuantity` for an accessible name or a `title`, and
`writeQuantity` for visible text that is MEASURED, such as an SVG `<text>` or a
canvas label.

### Declaring your own units

Your mod half annotates its contract exactly the way the first party does:

```csharp
[SitrepTopic("example.reactor")]
public sealed class ReactorStatus
{
    [SitrepUnit("kW")]
    public double OutputPower { get; set; }

    // A token the core catalog has never heard of is FINE: the generated
    // SitrepUnit union is open. Declare it in your OWN Units class (below)
    // so a typo still fails, then teach the client what it means.
    [SitrepUnit("thermalUnits")]
    public double Throughput { get; set; }
}
```

And your codegen generates from them, against YOUR assembly:

```csharp
public static class ReactorRtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        var mine = new[] { typeof(ReactorStatus) };
        // …your ExportAsInterfaces call…

        // The same pass the first party runs: retypes each annotated property
        // from a bare number to Value<"kW">. `valueImportFrom` is the path
        // that reaches the SDK from YOUR generated file.
        RtConfig.ApplyUnitValueTypes(builder, mine, valueImportFrom: "@ksp-gonogo/sitrep-sdk");
    }
}
```

`UnitDescriptor.ToJson(typeof(ReactorStatus).Assembly)` gives you the matching
descriptor, the same document the mod serves on `system.units`.

#### Your own catalog

Declare the tokens you introduce in a public static `Units` class in your
contract project. Codegen judges your assembly against core's catalog PLUS
yours, so an undeclared token stops the build instead of reaching the client as
an opaque symbol with no dimension and no ladder. There is no first-party
exemption: the rule that applies to the Uplinks shipped in this repo is the one
that applies to yours.

```csharp
namespace ExampleUplink.Contract
{
    public static class Units
    {
        public const string ThermalUnits = "thermalUnits";
    }
}
```

A compound counts as declared when both halves are: `MB/s` passes once `MB` and
`s` do, so a rate does not need its own constant per rung.

#### The two seams

A unit has two independent halves, and they live in different packages because
they answer different questions.

```ts
import { registerUnit } from "@ksp-gonogo/sitrep-sdk";
import { registerUnit as registerDisplayUnit } from "@ksp-gonogo/ui-kit";

// MODEL: what it IS. Dimension and ratio are what make values add up, and are
// all the SDK needs. Dimension onto an EXISTING base where one fits (`bit`,
// `m`, `s`) rather than inventing a private axis, or your quantity becomes an
// island nothing else can convert with.
registerUnit({ symbol: "MB", kind: "data", dimension: { bit: 1 }, ratio: 8e6 });

// DISPLAY: how it READS. Which rung a value lands on is the kit's business.
registerDisplayUnit({
  symbol: "MB",
  kind: "data",
  family: "bytes",
  ladder: [
    { from: 8, symbol: "B", per: 8 },
    { from: 8e3, symbol: "kB", per: 8e3 },
    { from: 8e6, symbol: "MB", per: 8e6 },
  ],
});
```

Register a display half only, with no ladder, for a token that names a category
rather than a scale (`{ symbol: "thermalUnits", kind: "count" }`). Until you
register anything, the value still renders, bare and unscaled.

#### Families, and sharing one with a mod you have never met

`family` is the set of rungs a value climbs WITHIN. It exists because one kind
can span scales that must never interleave: bits and bytes are both `data` and
share a dimension so a link budget and a file size stay convertible, but a byte
quantity landing on a bit rung would read `32 kbit/s` where it means `4 kB/s`.
Ladders key on family, so each keeps its own rungs.

Two Uplinks may declare into the SAME family, and should when they mean the
same thing by it: a megabyte is nobody's private invention. Declaring a symbol
identically twice is a no-op, so independent mods coalesce without coordinating.
Declaring it DIFFERENTLY throws, because which one won would otherwise depend on
module load order and the number on screen would change with it.

Core owns only a dimension's base (`bit` for data), so that mods cannot diverge
on the axis by accident. Rungs and families belong to whoever models them.

### Testing it

`<Unit>` renders the number, the symbol, and a visually hidden word as separate
elements, so a readout is **not one text node** and `getByText("12.4 km")` finds
nothing. `@ksp-gonogo/ui-kit/testing` is how you read it back:

```ts
import { visibleText, unitMatchers } from "@ksp-gonogo/ui-kit/testing";

// What a sighted reader sees, screen-reader words stripped.
expect(visibleText()).toContain("12.4 km");

// Or assert the QUANTITY without pinning how it is spelled. Register once in
// a setup file: expect.extend(unitMatchers)
expect(container).toShowQuantity(value("m", 12400));
```

Prefer the matcher when you mean "the widget shows the altitude it was given":
it formats through the same ladder the component renders with, so a later
change to where metres hand off to kilometres does not break your test. Use the
literal string when the exact spelling is the thing you mean to pin.

**Pin the locale in your test setup.** `<Unit>` writes a number in the
reader's own locale, which is right for an operator and wrong for a snapshot:
the same reading is `1,234,567.5` here, `1 234 567,5` in France and
`12,34,567.5` in India. Add this to whatever your test runner loads first:

```ts
import { setQuantityLocale } from "@ksp-gonogo/ui-kit";

setQuantityLocale("en-GB");
```

### Guarding it

The rule above is easy to agree with and easy to forget, so do not rely on
remembering it. One test file holds you to it:

```ts
import { expectNoHandTypedUnits } from "@ksp-gonogo/ui-kit/guards";
import { it } from "vitest";

it("types no unit symbol next to a number", () => {
  expectNoHandTypedUnits({ dir: "src" });
});
```

It walks your source for a `${...}` interpolation followed by a unit symbol,
skips tests, build output and CSS lengths (`width: ${pct}%` is not a readout),
skips comments so a file explaining the rule is not its own first offender, and
throws naming the file, the line and the fix.

**This is not a hypothetical tidiness rule.** The first-party app grew eleven
private unit ladders before anyone noticed, and unpicking them took days. Its
own guard then globbed `packages/` and stopped, so three of the bundled Uplinks
did the same thing again: a signal badge doing its own `* 100` on a value that
already carried `ratio`, a coverage readout, two latitudes, and a
metres-to-kilometres divide written out three times. Nothing was wrong with the
authors. Nothing was watching.

Two options worth knowing:

- **`symbols`** extends what it looks for. If you `registerUnit({ symbol: "Sv" })`,
  pass `symbols: [...HAND_TYPED_SYMBOLS, "Sv"]` so the guard notices when
  somebody writes yours by hand instead.
- **`baseline`** is a per-file allowance, for adopting this on a codebase that
  already has offenders: `baseline: { "Reactor/index.tsx": 3 }`, lowered as you
  convert. Never raise one. Going BELOW an entry throws too, so a stale
  allowance cannot quietly leave the door open behind a conversion.

Skip the guard only if your Uplink renders nothing at all, which is a narrower
case than it sounds: the bundled Kerbalism Uplink was exactly that when this
was written, and it now ships several widgets, a `ui-kit` dependency, and its
own byte units. An Uplink that renders nothing today is an Uplink that renders
something the week after.

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
- [ ] every quantity renders through `<Unit>`; no hand-formatted unit symbols
- [ ] every unit token you introduce is declared in your own `Units` class, and registered on both
      seams: dimension and ratio with the SDK, family and rungs with ui-kit
- [ ] `expectNoHandTypedUnits({ dir: "src" })` runs as a test (skip only if the Uplink renders nothing)
- [ ] the test setup calls `setQuantityLocale("en-GB")`, so a render is reproducible
- [ ] tests import `@ksp-gonogo/sitrep-testing` (a devDependency), and nothing in `src/` does
- [ ] widget tests read readouts with `visibleText` / `toShowQuantity`, not `getByText`
- [ ] the main screen is served over https or localhost so integrity verification works
