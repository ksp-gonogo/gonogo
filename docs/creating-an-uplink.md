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
  live KSP state. Return `new UplinkHealth(UplinkHealthState.Unavailable, reason)` when your dependency is
  absent, and the app surfaces that reason instead of the widget silently doing nothing
- **Health is also where a dependency's IDENTITY goes.** The third argument is a list of
  `UplinkHealthFact(label, value)` rows: which file you loaded, which build, which hash, whatever an
  operator would have to quote when reporting your Uplink's state. The app lists them beside your detail
  line without knowing what any of them mean, so you do not need a Topic of your own to carry them, and
  you should not invent one: a Topic gets a unit, a delay role and a history, none of which a file path
  wants. Keep readings on Topics and identity here
- **`AddChannelSource`** publishes a Topic from the main-thread game snapshot; **`AddSampledSource`** is the
  gated, higher-cost variant for expensive reads (see `ScansatUplink.cs`)
- **Topic and Command names are namespaced by your id** (`my-uplink.reading`), which keeps them from
  colliding with other Uplinks

### Reading another mod's internals

Most Uplinks wrap a mod that exposes no API, so you reach its state by reflection: look the type up
by name, read the members you need, and stay compiled against nothing but `Sitrep.Contract`. That
part is routine. Two things about it are not, and both have cost us a wrong answer already.

**A field read is safe. A call is safe only once you have read its body.**

The tempting shortcut is "a managed, parameterless getter is harmless, the danger is native
interop". That is false, and it fails in the worst direction. A mod's own fatal-log helper aborts
the process, and it gets called from the default branch of an ordinary-looking switch. Principia's
frame selector holds no native handle at all, and four of its parameterless members still reach it:

```
FrameParameters()   default branch -> Log.Fatal("Unexpected frame_type …")
Name()              -> Log.Fatal("Unexpected type …"), plus three root-body cases
NavballName()       same naming path
Abbreviation()      same naming path
```

Reachable, innocuous-looking, forbidden. Nothing about their signatures says so.

What makes this worth a rule rather than a warning is that the loose version gives the right
answer for the wrong reason. `BurnEditor.Δv()` really is safe, and it passes the loose test too,
so a shortcut that had been "working" would have kept working right up to the first member that
happened to have a default branch. If you invoke anything on a foreign object, decompile it first
and write down what you found next to the call. If you cannot, derive the value from fields
instead: a label you format yourself is always safer than the mod's own formatter.

**A field you can read is not necessarily a field that is true.**

Ask what WRITES it. Three cases, and only the first is safe to read whenever you like:

| the field is | read it | example |
| --- | --- | --- |
| operator state, or restored from the save | freely, it is current | a display toggle, a persisted length |
| recomputed by the mod's own UI each repaint | only from a hook, and stamp when you saw it | a value the mod refreshes while its window draws |
| never written unless a window is open | same, and treat "never seen" as its own state | a list the mod fills when the operator looks |

The second and third are the trap, because an unread field is not empty: it holds whatever its
constructor set, which usually looks like a plausible value. A poll of a window-gated setting will
happily report the default as though it were the operator's choice, with nothing anywhere to say
otherwise. If your value only exists while some window renders, put a `Harmony` postfix on that
render, latch the value with `Planetarium.GetUniversalTime()` beside it, and publish it as a
sample AT that instant, and the client's own staleness handling then does the rest for free.

And never publish absence from a source that cannot tell "none" from "not looked yet". Publish
nothing, so the client reads `absent` and can say so.

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

### Register your Topics, and the generic surfaces follow

Your client tells the SDK which Topics you own, at module load, beside the `declare module`
augmentation that types them:

```ts
// client/src/topics.ts
registerBarePrimitiveTopic("my-uplink.reading");

// loop your own generated maps, so a Topic you add later needs no new call site
for (const [topic, units] of Object.entries(GENERATED_TOPIC_UNITS)) {
  registerTopicUnits(topic, units, GENERATED_TOPIC_SHAPES[topic] ?? {});
}
for (const [name, units] of Object.entries(GENERATED_TYPE_UNITS)) {
  registerTypeUnits(name, units, GENERATED_TYPE_SHAPES[name] ?? {});
}
```

You already need both calls: the first is what narrows your Topic ids at runtime, the second is what
turns a bare number on the wire into the `Value` your type promises.

They buy more than that, and you do nothing further to collect it. Registration is the only statement
your Topics exist that reaches a running app, so it is what the app's generic surfaces read. Your Topics
are promoted to the stream on the same footing as a first-party one, and every field you declared a unit
for turns up, labelled and dimensioned, in the pickers the graph widget, the threshold alarms and the
note tags are all built from. There is no list in the gonogo repo to get your Topic added to, and asking
for one would be the wrong fix: it could only ever name an Uplink that shipped before it was written.

The one field that will not appear is one with no declared unit. A field the walk cannot dimension is a
field a picker cannot order or render, so annotate the whole payload rather than the interesting half.

### Sharing a derivation with other Uplinks

A **Processor** is a declared pure function of Topics, evaluated once per Sitrep frame however many
widgets read it. Your client registers one through its handle, and reads it back with `useProcessor`:

```ts
// client/src/processor.ts
export interface HabSummary { occupied: number }

export const HAB_SUMMARY = MY_UPLINK.registerProcessor({
  id: "hab-summary",                        // registers as "my-uplink:hab-summary"
  deps: ["my-uplink.habitat"] as const,
  compute: ([habitat]): HabSummary => ({ occupied: habitat?.crew ?? 0 }),
});
```

That handle is how a consumer gets the RESULT TYPE, because `useProcessor` reads it off the handle's
brand. Which decides who can consume it:

- **Your own widgets**: import the handle, nothing else needed
- **Anything in the app** (a first-party widget, the shared SDK derivations): already works
- **Another Uplink**: not by importing your handle. Your client is not a published package, so nobody
  outside it can install or typecheck against it, and there is nothing to import. That is the isolation
  rule doing its job, not a gap: an Uplink that reached into another one would break, with no compile-time
  signal at all, the moment a user uninstalled the mod behind it

There is no registry trick that gets round this. A `declare module` augmentation is scoped to a
TypeScript **program**, and another Uplink's program can never include your declaration file, so keying a
registry by processor id moves the problem without solving it. Topics have exactly the same limit: an
Uplink cannot type another Uplink's Topic either.

**So if you want your derivation consumable by an Uplink you have never met, the contract has to live in
the SDK.** `defineProcessorContract` is that split: the id and the result type published from
`@ksp-gonogo/sitrep-sdk`, where every Uplink already compiles against them, and the implementation
registered by whichever client owns the mod it derives from.

```ts
// in @ksp-gonogo/sitrep-sdk, beside the result type it names
export interface HabSummary { occupied: number }
export const HAB_SUMMARY = defineProcessorContract<HabSummary>("my-uplink:hab-summary");

// in YOUR client: import the type you must satisfy, register the derivation
MY_UPLINK.registerProcessor({ id: "hab-summary", deps, compute });

// in ANY other Uplink: imports the SDK, and neither your package nor your types
const hab = useProcessor(HAB_SUMMARY);   // HabSummary | undefined
```

The id must be owner-stamped (`<owner>:<id>`), matching what `registerProcessor` stamps; an unstamped one
throws, because a handle that silently answers `undefined` forever is indistinguishable from the mod not
being installed. And that is what absence looks like: no implementation registered means `undefined`,
which every consumer already handles because it is also what `useProcessor` answers before the first
frame. Nothing crashes when the mod is missing.

Getting a contract into the SDK is a conversation, not a code change you make alone: open an issue. In the
meantime, the mechanism that already composes across Uplinks with no coordination at all is a
**contribution**, where the HOST declares the slot and its entry type and any number of Uplinks feed it.

**One more thing your `compute` owes.** The evaluator only wakes a processor's consumers when the result
actually changed, and it decides that by comparing the result structurally. So return **data**: numbers,
strings, arrays, plain objects, and `Value`s (or your own wrapper in the same style, a data object over a
methods-only prototype). A `Map`, a `Date`, a class that keeps its state behind a getter, or a function in
the payload cannot be compared, so every consumer is woken on every frame. That is not silent: it counts
against the `Processor uncomparable results/sec` budget, whose threshold is zero, and logs a warning
naming your processor and the shape.

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

Each has a `/testing` subpath your tests import and your widgets never do, and
ui-kit adds `/render-probe` and `/render` for the render harness. See "Testing your
Uplink" below. There is no third package: `@ksp-gonogo/sitrep-testing` used to be
one and was deleted once the spine came down into the SDK, so anything that names
it is out of date.

A camera Uplink also gets **`@ksp-gonogo/sitrep-sdk/media`**, a subpath of the same
package: the delayed-playout buffer, the per-frame pipeline and the shared
per-camera stream cache, all riding the one delay authority telemetry reads. It is
a subpath rather than part of the root barrel because it pulls WebCodecs and Worker
machinery a telemetry-only Uplink has no use for, so importing the root never
loads it. Externalise it as its own specifier: the app's import map is keyed on
exact strings, and externalising `@ksp-gonogo/sitrep-sdk` does not cover a subpath
of it.

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
  // The render harness's two optional peers. Nothing else: the test and
  // render surfaces are subpaths of the two packages above.
  "playwright": "^1.60.0",
  "esbuild": "^0.28.0",
  "@fontsource/jetbrains-mono": "^5.2.8"
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

**What decides which Uplinks load:** the live `system.uplinks` roster the running mod publishes, and
nothing else. The app carries no list of Uplink names, not even for the ones that ship with it, so your
Uplink reaches the loader on exactly the same path a first-party one does. With no mod talking (an app
opened before KSP, or a dev session with no game running) nothing is attempted, because nothing has said
what is installed; `?uplinkLoaderIds=a,b` names ids by hand for that case.

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
`import "@ksp-gonogo/gonogo-kerbalism-uplink"` line in `packages/app/src/main.tsx` is exactly this): the widget registers
and renders in `pnpm dev` with a normal HMR loop, and you switch to the fetch-and-verify loader path only
when you package for distribution. When the local-URL mechanism lands, this section will describe pointing
the loader at your local build directly.

---

## Testing your Uplink

The harness is two subpaths of the two packages you already have:
**`@ksp-gonogo/sitrep-sdk/testing`** for the host, the spine and the stream
fixture, and **`@ksp-gonogo/ui-kit/testing`** for the provider stack a widget is
mounted in and the readout assertions. They deliberately do not re-export each
other: a host and a provider stack are genuinely two things, and your setup names
both.

Your widgets call SDK hooks (`useTelemetry`, `useCommand`, `useStream`), and those
are shims that resolve through the host the app installs at boot. A unit test has no
app, so it has to install one:

```ts
// client/src/test/setup.ts, in full
import { PerfBudget } from "@ksp-gonogo/sitrep-sdk";
import { installDomStubs, installRealTestHost }
  from "@ksp-gonogo/sitrep-sdk/testing";
import {
  AugmentSlot, clearAugments, getAugmentsForSlot, registerAugment,
  setQuantityLocale,
} from "@ksp-gonogo/ui-kit";

installDomStubs();            // jsdom gaps: ResizeObserver, canvas, matchMedia
PerfBudget.installTestGate(); // fail a test that pushes a budget over its cap
setQuantityLocale("en-GB");   // so a render is reproducible off your machine

// The four augment members come from ui-kit because that is where the augment
// registry and `<AugmentSlot>` live, and ui-kit imports the SDK, so the SDK
// cannot import them back. Everything else in the host is the SDK's own.
installRealTestHost({
  AugmentSlot, clearAugments, getAugmentsForSlot, registerAugment,
});
```

You cannot write `installRealTestHost` yourself, and it is worth knowing why: the
implementations behind the shims are the ones the app installs, and passing a shim
back in as its own implementation is infinite recursion rather than a bridge. That
is the single thing you are being handed here.

### Running a widget off the real stream

`setupStreamFixture` builds a real `TelemetryClient` / `TimelineStore` / `ViewClock`
behind a `TelemetryProvider`, and you emit frames by hand. It is the same pipeline
the app runs, not a stand-in, so a test that passes here is evidence about the
stream and not about a mock of it.

```tsx
import { render, screen, setupStreamFixture, waitFor }
  from "@ksp-gonogo/sitrep-sdk/testing";

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

`render` and `renderHook` come from `@ksp-gonogo/sitrep-sdk/testing` and they mount
the kit's theme for you. Every `@ksp-gonogo/ui-kit` primitive reads
`theme.space[…]` off the styled-components context, and with no provider that is a
TypeError rather than a fallback. Everything else Testing Library offers
(`screen`, `waitFor`, `within`, `act`, `fireEvent`) is re-exported unchanged, so
this is a drop-in for the import source.

For a widget rather than a plain component, `renderWidget` from
`@ksp-gonogo/ui-kit/testing` mounts it inside the same provider stack the dashboard
puts around one. A widget rendered bare is a widget the app never runs: `Panel`
reads its stream status off a provider, so with none mounted the status badge never
appears and a `waitFor` on it returns having proved nothing.

### Screenshots and your README

`gonogo-uplink render` and `gonogo-uplink docs` turn your fixtures into images and
your registrations into a page, and `docs --check` keeps that page from going
stale. See **[docs/uplink-rendering.md](./uplink-rendering.md)**: it is the same
harness your unit tests use, driven through a real browser.

There is exactly one of it. If it cannot photograph something your Uplink does,
that is a gap in the tool and it gets filled there rather than in a driver of
your own: a fixture nothing renders and a harness only you can run are the two
ways a widget ends up shipping with no picture of it. Enforced by
`packages/core/src/one-render-process.test.ts`, which fails a client that imports
a browser driver and a client whose scene fixtures no script renders.

---

## Giving your widget a body: `sections`, not children

A dashboard tile is any shape the operator drags it to. A widget that composes
its own body cannot know which shape it got, so it runs everything down one
column and wastes the width of a landscape tile. `Panel` does know, so the
decision belongs to it.

Pass your body as `sections` and close the tag:

```tsx
<Panel
  panelTitle="REACTOR"
  sections={[
    <Section key="core" title="Core">
      <Row label="Temperature" value={<Unit value={reading.coreTemp} />} />
    </Section>,
    <Section key="output" title="Output">
      <Row label="Power" value={<Unit value={reading.power} />} />
    </Section>,
  ]}
/>
```

Those two sections stack in a narrow tile and sit side by side in a wide one,
with your widget saying nothing about either. `Section` renders its own `title`
as a real `h4` under the panel's `h3`, so you stop hand-rolling the heading.

Three things worth knowing:

- **one section costs nothing.** `sections={<Section>…</Section>}` is the normal
  way to write a widget whose body is a single list, and it is not an abuse of
  the prop
- **`full` spans every column.** For the section a wide layout should not put
  beside another: a summary strip the columns below it belong to, or a table
  whose columns are already its own
- **`sectionMinWidth` tunes the threshold.** Raise it for sections with long
  rows; set it to `100%` for a widget that should never columnise

Children instead of `sections` is the retiring form, and
`packages/core/src/styleguide-panel-body.test.ts` is a shrink-only ratchet that
will fail a new one. The single exception is a widget that is WHOLLY a drawing,
a map or a globe, which passes `floatingHeader` and keeps its children: its
content is the panel rather than a section of it.

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
- [ ] tests import `@ksp-gonogo/sitrep-sdk/testing` and `@ksp-gonogo/ui-kit/testing`, and nothing in `src/` does
- [ ] every widget has at least one fixture, `gonogo-uplink docs` runs, and `docs --check` is in CI
- [ ] widget tests read readouts with `visibleText` / `toShowQuantity`, not `getByText`
- [ ] the main screen is served over https or localhost so integrity verification works
