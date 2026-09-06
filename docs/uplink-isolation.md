# Uplink isolation: what an Uplink may import

An Uplink is a self-contained integration for one mod. The whole point is that
someone outside this repository can write one. That only holds if an Uplink
depends on surfaces they actually have.

## The rule

An Uplink client (`mod/Gonogo*Uplink/client/src/**`) may import:

- **`@ksp-gonogo/sitrep-sdk`**, the devkit, and its subpaths:
  - `@ksp-gonogo/sitrep-sdk/frames`, the reference-frame arithmetic a projection
    contribution needs
  - `@ksp-gonogo/sitrep-sdk/media`, the delayed-media layer a camera Uplink needs
  - `@ksp-gonogo/sitrep-sdk/testing`, the host, the spine and the stream fixture
- **`@ksp-gonogo/ui-kit`**, the published design system, and its subpaths:
  - `@ksp-gonogo/ui-kit/testing`, the widget provider stack and the readout helpers
  - `@ksp-gonogo/ui-kit/guards`, the render-time invariants a widget asserts against
  - `@ksp-gonogo/ui-kit/render-probe` and `/render`, the render harness
  - `@ksp-gonogo/ui-kit/page-check`, the assertions the render harness reads back
  - `@ksp-gonogo/ui-kit/tokens.css`, the design-system custom properties
- `react`, `styled-components`, and third-party packages

One qualification on the ui-kit line, because it is unconditional above and is
not quite: a short, ENUMERABLE set of names lives on both published packages, and
for those the sdk is the import an Uplink makes. The complete set, and the file
that keeps it complete, is the last section of this page.

Nothing else from this repo. `core`, `ui`, `components`, `data`, `logger`,
`sitrep-client` and `test-utils` are all `private: true` and unpublished, so an
author outside this tree cannot install them, typecheck against them, or build. So
are the Uplinks themselves, which is why one Uplink may not import another.

**That subpath list is exhaustive, and the sdk publishes subpaths that are not on
it.** Four of them, every one reachable, installable and typecheckable, which is
exactly why only a named list can stop them:

- **`/spine`**, where the client half is implemented: the read semantics of a
  topic, the timeline store, every hook the root barrel shims
- **`/registry`**, dashboard orchestration, which widgets a screen renders
- **`/uplink-externals`**, the specifiers a client bundle leaves external. It is
  published so that your bundler and the app cannot drift, and it is read by
  BUILD tooling rather than imported by a widget: `gonogo-uplink bundle` reads it
  for you (see "Which package declares what")
- **`/uplink-manifest`**, the writer behind `gonogo-uplink.json`, likewise
  build-time only. It reads the filesystem, so nothing in a browser could import
  it anyway

Publishing `/spine` or `/registry` as an author surface would freeze evolving
internals as third-party API, and both barrels say so in their own headers. The
other two are tools you invoke, not modules you import: a file anywhere under
`client/` that names one fails the gate, build config included.

Until 2026-08-26 that list said so only here. Every gate in the tree permitted
`@ksp-gonogo/sitrep-sdk/spine` in a widget: the import ratchet is a denylist of
package NAMES and the sdk is permitted at any depth, and the extraction probe
found a tarball that genuinely contains `/spine`, so it resolved and typechecked
standing alone. Planted in a production Uplink file, the isolation suite reported
12 of 12 passing and the probe reported zero errors. `AUTHOR_SUBPATHS` and
`NON_AUTHOR_SUBPATHS` in `uplink-isolation.allowlist.ts` now classify every
published subpath, and an unclassified one fails rather than defaulting to
permitted.

`/spine` does resolve at runtime, deliberately, because first-party code needs it
to. Read nothing into that: an import-map entry is not permission (below), and
the entry exists because a loaded Uplink was failing to link, not because the
subpath became authorable. The frame arithmetic an Uplink genuinely needs was
given its own narrow surface, `/frames`, for exactly this reason.

`@ksp-gonogo/ui` and `@ksp-gonogo/ui-kit` are different packages. `ui` is private
and app-side; only `ui-kit` is published.

`@ksp-gonogo/test-utils` was the exception nobody noticed: it went unlisted in
`FORBIDDEN_PACKAGES` until 2026-08-18, so the guard read as clean while 56 Uplink
files imported it. The themed `render`/`renderHook` are published from
`@ksp-gonogo/sitrep-sdk/testing`. Import those.

### The import map is not a licence

`packages/app/src/uplinks/externals/` bakes an import map that resolves fifteen
specifiers, `core` and `sitrep-client` among them, to the app's singleton chunks at
runtime. That mechanism is real and load-bearing: it is what makes a loaded
widget's `registerComponent` write into the registry the dashboard reads.

It fixes RUNTIME resolution only. It says nothing about how an author builds in the
first place, and a package you cannot install is not available to you just because
the browser could have found it.

The converse also holds, and cost a subpath: an entry in that map is what makes a
specifier RESOLVE, and a subpath needs its own. `@ksp-gonogo/sitrep-sdk/spine`
carried the read-frame and libration-point arithmetic for a while with no entry,
which nothing caught, because esbuild externalises a subpath of an externalised
package name and the isolation ratchet below is a denylist of packages that
permits a permitted one at any depth. The break lands at `import(bundleUrl)` and
nowhere earlier. `packages/core/src/sdk-subpath-alias.test.ts` now requires every
declared subpath to be classified either way.

An entry is therefore necessary and not sufficient: `/frames` needed one to
resolve, and what makes it importable is being on the rule's list above.

### Adding an sdk subpath is four edits, and the third is the one that gets missed

They are described in three different sections of this page and in two packages,
which is how `/spine` shipped with one of them missing. In order:

1. **Declare it.** `mod/sitrep-sdk/package.json`, the `exports` map.
2. **Classify it.** `AUTHOR_SUBPATHS` or `NON_AUTHOR_SUBPATHS` in
   `packages/core/src/uplink-isolation.allowlist.ts`, with the reason. An
   unclassified subpath fails rather than defaulting to permitted.
3. **Give it an import-map entry, if a loaded widget imports it at runtime.** Add
   `["@ksp-gonogo/sitrep-sdk/<sub>", "ext-sitrep-sdk-<sub>"]` to
   `UPLINK_EXTERNAL_ENTRIES` in `mod/sitrep-sdk/src/uplink-externals.ts`, and
   create `packages/app/src/uplinks/externals/ext-sitrep-sdk-<sub>.ts`
   re-exporting the subpath. This is the step with no compile-time symptom.
   Subpaths reached only by TESTS and TOOLS need no entry and have none:
   `/testing` and every ui-kit subpath are in that class.
4. **Alias it in every Uplink vitest config that aliases the sdk.** The alias map
   does PREFIX matching, so a config that aliases the bare package name and not
   the subpath rewrites the subpath to a path underneath `index.ts`.
   `packages/core/src/sdk-subpath-alias.test.ts` fails on a missing line.

Then add it to the rule's list at the top of this page, which is prose and which
nothing enforces.

Step 3 is checkable without pushing: `gonogo-uplink bundle` marks every specifier
on that list external and then greps the EMITTED bytes for a surviving
`@ksp-gonogo/...` import that the list does not carry, and refuses the bundle if
it finds one. That is precisely the `/spine` defect, caught at build.

### There is no first-party exemption

Some Uplinks ship bundled with the mod. That changes how an Uplink is distributed,
not what it may import. An Uplink that reaches for `core` or `sitrep-client`
because it happens to live in this repository stops being a working example of what
an outside author can build, and every one of them is meant to be exactly that.

The debt list below is what remains of an earlier exemption for in-tree code.

## If you need something that lives in an app-internal package

**Move the export, do not import it.** Almost every violation on record is a
sensible export sitting in the wrong package, not a design problem:

- a UI primitive → move it to `@ksp-gonogo/ui-kit`
- an authoring or runtime API (`registerComponent`, `AugmentSlot`,
  `useActionInput`, `PerfBudget`) → move or re-export it through
  `@ksp-gonogo/sitrep-sdk`
- a test helper that needs the real spine (`render`, `renderHook`,
  `clearRegistry`, `MockDataSource`, `installDomStubs`, `clearUplinkHandles`,
  `clearActionHandlers`, `setupStreamFixture`, and `installRealTestHost` itself)
  → **`@ksp-gonogo/sitrep-sdk/testing`**, which hands over the REAL
  `TelemetryClient` / `TimelineStore` / `StubTransport` rather than a
  reimplementation. That matters more than where it lives: a stream test against
  an in-memory stand-in passes while testing the stand-in, which is the exact
  inversion of `CLAUDE.md`'s "mock as little of the system as possible"
- a provider stack (`renderWidget`, `WidgetHost`) or a readout assertion
  (`visibleText`, `toShowQuantity`, `expectNoA11yViolations`) →
  **`@ksp-gonogo/ui-kit/testing`**. The two testing entries deliberately do not
  re-export each other: a widget's harness is a host from the sdk and a provider
  stack from the kit, and those are genuinely two things
- a whole-widget screenshot or a generated page →
  **`@ksp-gonogo/ui-kit/render-probe`** and **`@ksp-gonogo/ui-kit/render`**, the
  two halves of the render harness, driven by the `gonogo-uplink` bin. See
  `docs/uplink-rendering.md`

  There WAS a third package, `@ksp-gonogo/sitrep-testing`, sitting above `core`
  and `sitrep-client`, and this document told you to install it for months after
  it was deleted. The harness moved onto the subpaths above once the spine came
  down into the sdk, so nothing is reimplemented to make it reachable and there
  is no cycle to route around. `@ksp-gonogo/ui-kit/testing-react`, which this
  document also named, never existed at all

If you are unsure which package something belongs in, stop and ask rather than
importing across the boundary "for now".

## What you must not do instead

**Do not put a repo-wide gate inside an Uplink.** A check that needs `core` to
run is a check a third-party author cannot run, so it is not protecting the thing
you think it is. It also makes the built-in Uplinks less like third-party ones,
which is backwards: they are the reference implementations.

This is recorded as a blocked strategy rather than a rule of thumb, because it
was arrived at twice by careful reasoning from the wrong premise: that the
Uplink clients are part of this repo's test surface. They are not. They are
examples of what an outside author writes.

**Do not add yourself to the debt list.** `INTERNAL_IMPORT_DEBT` in
`packages/core/src/uplink-isolation.allowlist.ts` is shrink-only and seeded with
what already existed on 2026-08-18. A new entry means new code just created a
violation. Move the export instead.

## Which package declares what

A dependency that works locally is not a dependency you have. Several Uplinks
import packages their `package.json` never declares; those resolve only through
pnpm workspace hoisting, and would be module-not-found for anyone else. If you
add an import, declare it, and if you cannot declare it, you cannot import it.

This runs both ways, and the reverse is the one that rots quietly: a declaration
for a package nothing imports any more still makes the Uplink uninstallable, while
reading like a live dependency to everyone after you. Kerbcast and Scansat
declared `components` (and Scansat carried a vitest alias, plus a comment
explaining a type-only import no file had contained) for weeks after the last
import died. Three more Uplinks declared `ui` and five aliased it without a single
importer between them.

Both directions are enforced now: `DECLARED_DEPENDENCY_DEBT` covers the
declarations, and a separate check derives staleness from the two scans, so it
needs no list of its own and cannot itself go out of date.

### Which of them end up IN your bundle, and which the app hands you

Declaring a dependency and shipping a copy of it are different questions, and the
second one has a published answer rather than a convention to guess at.
`UPLINK_BUNDLE_EXTERNALS`, from `@ksp-gonogo/sitrep-sdk/uplink-externals`, is the
list of specifiers a client bundle leaves unresolved; `gonogo-uplink bundle`
applies it for you and you do not have to restate it. It is:

```text
react                react-dom            react/jsx-runtime
styled-components    react-dom/client     react/jsx-dev-runtime
@ksp-gonogo/sitrep-sdk          @ksp-gonogo/sitrep-sdk/frames
@ksp-gonogo/sitrep-sdk/media    @ksp-gonogo/sitrep-sdk/spine
@ksp-gonogo/ui-kit
@ksp-gonogo/core   @ksp-gonogo/components   @ksp-gonogo/data
@ksp-gonogo/ui     @ksp-gonogo/sitrep-client   @ksp-gonogo/logger
```

Fifteen of those seventeen have an import-map entry of their own. The two that do
not, `react-dom/client` and `react/jsx-dev-runtime`, are reached only through a
specifier that has one, so a bundler must still leave them alone and nothing has
to resolve them at load.

Three things follow, and they are the ones an author most often gets wrong:

- **React and styled-components are the app's, not yours.** They are external, so
  your bundle contains no copy and there is no second dispatcher and no second
  stylesheet. Declare `react` as a **`peerDependency`** (plus a devDependency to
  build and test against); every bundled Uplink in this repo does exactly that.
  `styled-components` and `@ksp-gonogo/ui-kit` sit in `dependencies`, and the sdk
  in `devDependencies`, which is where they are today rather than a ruling
- **Any OTHER third-party package IS bundled**, because it is not on that list.
  It reaches runtime inside your own bundle, needs no import-map entry, and is a
  plain `dependency`. Nothing is shared with the app, so two Uplinks depending on
  the same library get one copy each
- **The six private `@ksp-gonogo/*` names on that list are there for the app's
  own first-party loading path, and are not yours to import.** This is the
  "the import map is not a licence" point above, in list form: `core` resolving
  at runtime does not make it installable, and the isolation gate fails on it

## The same rule applies to the C# side

An Uplink is a client *and* a plugin assembly, and the reasoning does not change
at the language boundary. `mod/Gonogo*Uplink/*.csproj` may reference:

- **`Sitrep.Contract`**, the contract assembly core ships
- **its own `<Uplink>.Contract`** slice
- KSP/Unity reference assemblies and the third-party mod it integrates

`Sitrep.Host`, `Sitrep.Core`, `Sitrep.Transport`, `Sitrep.Propagation`,
`Sitrep.CaptureAnalysis`, `Sitrep.Skeleton`, `Sitrep.Contract.TestSupport` and
`Gonogo.KSP` are unpublished. An outside author has no way to obtain them, so an
Uplink that references one cannot be built by anyone but us.

`Sitrep.Contract.TestSupport` is on that list despite the name: it is
`IsPackable=false` and `net10.0`-only, so nothing ships and there is no target
framework of it a consumer could bind to. The same rule and the same list apply
to the `<Uplink>.Tests` projects, which travel with their Uplink. That leaves a
new Uplink's test project with no shared harness to reach for, which is a real
gap and has a real answer: see "Testing a NEW Uplink" below.

If a type you need is in one of them, **move it into `Sitrep.Contract`**. A
contract change is free. The test is not where the type currently sits but what
it names: three of the four breaches found in the 2026-08-19 audit were types
whose entire dependency set was already in `Sitrep.Contract`, so the move was a
file rename.

Anything an Uplink is expected to *implement* has to be in the contract by
definition. `ICommsBackend` always was; `IActionGroupsBackend` was not, despite a
doc-comment saying it existed for a third-party AGX uplink to implement, and that
was the whole of the bug.

The same holds for what an Uplink is expected to *call*, and there the fix is not
a file move: declare the interface in `Sitrep.Contract`, register the
implementation as a Kernel capability, and resolve it through `host.Kernel`. That
is what took `GonogoKerbalismUplink` off `Gonogo.KSP`.

`Kernel` is a sealed class in `Sitrep.Contract`, and `IUplinkHost.Kernel` hands
you the host's one instance. It is the whole of the API, and it is four members:

```csharp
// Sitrep.Contract
public sealed class Kernel
{
    public void RegisterCapability(CapabilityDescriptor descriptor);
    public void RegisterProvider(ProviderRegistration registration);
    public ResolveResult Resolve(ResolveOptions opts);   // the HOST calls this
    public T Query<T>(string capability);                // the elected instance
}
```

Three shapes of use, all of them from shipped Uplinks.

**Calling something core implements.** Declare the interface and its capability
id in `Sitrep.Contract` (`IDelayedScienceSink` and `DelayedScienceCapability` are
a worked example, and the whole of `DelayedScience.cs`), then resolve per use:

```csharp
public void Register(IUplinkHost host)
{
    _kernel = host.Kernel;   // capture; see the ordering rule below
}

private IDelayedScienceSink? ElectedSink()
{
    if (_kernel == null) return null;
    try
    {
        return _kernel.Query<IDelayedScienceSink>(DelayedScienceCapability.CapabilityId);
    }
    catch (Exception)
    {
        // No election yet, or an install where core never declared it.
        return null;
    }
}
```

`Query<T>` throws rather than returning null when nothing is elected, so the
try/catch is the pattern and not a flourish: `GonogoKerbalismUplink`'s science
hook is written exactly this way.

**Offering an implementation core or another Uplink will call.** Register a
provider against a capability someone else declared:

```csharp
host.Kernel.RegisterProvider(new ProviderRegistration
{
    Capability = "reliability",
    Id = "kerbalism",              // must equal the backend's ProviderId
    Priority = 1.0,
    CanServe = () => KerbalismReliabilityBackend.CanServe(_k),
    Factory = _ => new KerbalismReliabilityBackend(_k, host.Kernel),
});
```

`CanServe` is asked at RESOLVE time, before a winner is picked, so a backend that
withdraws there leaves the runner-up a real chance. Declining from inside
`Factory` instead is too late: the election is over and an exclusive capability
falls through to vanilla. Every capability interface in the contract derives from
`ISitrepProvider`, whose one member is `string ProviderId { get; }`, and that id
is the same string you register with.

**Owning a capability of your own.** Implement the optional
`IUplinkCapabilityDeclarer` alongside `ISitrepUplink` and call
`RegisterCapability` in it, never in `Register`:

```csharp
public void DeclareCapabilities(Kernel kernel) =>
    kernel.RegisterCapability(new CapabilityDescriptor
    {
        Id = "example",
        Exclusive = true,                       // one winner, or the vanilla below
        Vanilla = _ => new MyStockFallback(),    // omit for "no provider, no value"
    });
```

The host runs every Uplink's `DeclareCapabilities` before any Uplink's
`Register`, which is what makes registration order between Uplinks stop
mattering: `RegisterProvider` throws if its target capability is not registered
yet, and assembly-scan discovery fixes no order.

Two things fell out of doing this:

- **Keep the capability id in the contract.** `ActionGroupsElection.CapabilityId`
  lived in the unpublished `Sitrep.Host`, so the AGX uplink re-declared
  `"actionGroups"` as its own constant and a test pinned the two equal. An id both
  halves must spell identically belongs where both halves can reach it, so it is
  `Sitrep.Contract`'s `ActionGroupsCapability.Id` now and the host constant is an
  alias of it. `CrewStandingCapability.Id` and `PropagationCapability.Id` are the
  same shape
- **A capability resolves only after every Uplink has registered.** That ordering
  is what lets an Uplink register a provider at all, so nothing can resolve one
  during its own `Register`. Capture the Kernel there and resolve per use, the way
  `VesselUplink` already does for action groups and maneuver plans

A one-implementation capability is still the right shape. The point is not the
election; it is that a caller reaches the thing without reaching the assembly it
lives in.

### What a compliant Uplink csproj looks like

Two `ProjectReference` lines, and the difference between them is the whole of the
packaging rule:

```xml
<!-- Core ships Sitrep.Contract.dll into GameData/Gonogo/Plugins. Private=false
     so this build does NOT copy its own, which would shadow core's. -->
<ItemGroup>
  <ProjectReference Include="..\Sitrep.Contract\Sitrep.Contract.csproj">
    <Private>false</Private>
  </ProjectReference>
</ItemGroup>

<!-- Your OWN contract slice. Private defaults to true, deliberately: nobody else
     ships this DLL, so it belongs in your Uplink's own output. -->
<ItemGroup>
  <ProjectReference Include="..\ExampleUplink.Contract\ExampleUplink.Contract.csproj" />
</ItemGroup>

<!-- KSP/Unity and the mod you integrate: reference assemblies, Private=false,
     satisfied by the game at runtime. -->
<ItemGroup>
  <Reference Include="Assembly-CSharp" Private="false">
    <HintPath>$(KspManaged)\Assembly-CSharp.dll</HintPath>
  </Reference>
</ItemGroup>
```

`Private="false"` and `<Private>false</Private>` are the same thing; both
spellings are in use here and the gate reads both.

### Reachable, not declared

ProjectReference is transitive and nothing in this graph sets `PrivateAssets`, so
the assemblies you can compile against are the *closure* of what your csproj
names, not the list itself. One reference to `Gonogo.KSP` puts five private
assemblies on your compile surface. Count the closure, not the lines.

The closure of the csproj above is empty of private assemblies:
`Sitrep.Contract` declares no ProjectReference of its own, and your contract
slice references only `Sitrep.Contract`. That is why the two-line shape is the
whole compliant shape, and it is the fact the next section turns on.

### An Uplink must not bundle what it reaches

KSP loads every `GameData` plugin into one AppDomain, so an Uplink shipping its
own copy of a core assembly shadows core's. `Private="false"` on a
ProjectReference does **not** suppress copying of that project's own transitive
references, so every reachable PRIVATE project must be named in your csproj with
the flag, including ones you never import. Those references exist to stop a copy,
not to compile, and deleting them for tidiness silently re-opens the copying.

**Read that as a rule about Uplinks in DEBT, not about compliant ones**, because
on its own it reads like a contradiction of the reference list two sections up.
The two gates are separate and they compose like this:

| your Uplink | reference gate | packaging gate |
| --- | --- | --- |
| reaches no private project | passes | asks for nothing: there is nothing to suppress |
| reaches one, and is in `ReferenceDebt` | excused while the debt stands | **now** demands a `Private=false` line naming it, and every private project behind it |
| reaches one, not in the debt list | fails | fails as well |

So a compliant Uplink carries no `Private=false` line for a private project at
all, and today none of them does, because `ReferenceDebt` is empty. The
`Private=false` on `Sitrep.Contract` in the snippet above is a different case: it
is not private, it is the one assembly core installs beside you, and its flag is
convention rather than gate. The middle row is the only one where the rule
"name every reachable project" bites, and it is a rule for holding the line while
a breach is being paid off, not a shape to build towards.

Do not verify this by looking in `bin/`: an incremental build shows whatever was
there last time. `rm -rf bin obj` first, or trust the gate below, which checks the
references instead.

### Testing a NEW Uplink, when the shared test-support project is off limits

This is the one place the C# side has no equivalent of the TypeScript answer.
There, `@ksp-gonogo/sitrep-sdk/testing` is published and hands you the real host
and spine. Here, `Sitrep.Contract.TestSupport` holds the same kind of thing (a
recording `IUplinkHost`, a starvation probe, the Unit-coverage and
command-registration assertions), it is forbidden, and the debt lists that excuse
it for ten existing projects are shrink-only and seeded: **a new `.Tests` project
cannot add itself to them.**

The substitute is not a workaround, it is what the two clean projects already do:
**write the double in your own Tests project.** `IUplinkHost` lives in
`Sitrep.Contract`, so anyone can implement it, and it is about a hundred lines of
lists and no-ops. `GonogoPrincipiaUplink.Tests/RecordingUplinkHost.cs` is the
reference: it records what the Uplink registered, and exposes a REAL `Kernel`
rather than a recorded one, because what an Uplink registers into a capability is
only half a wiring claim and the other half is what the election then resolves.

```csharp
internal sealed class RecordingUplinkHost : IUplinkHost
{
    public List<string> HandlersRegistered { get; } = new();
    public Kernel Kernel { get; } = new Kernel();   // real, not a recorder

    public double NowUt() => 0.0;

    public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler)
        => HandlersRegistered.Add(command);

    // ... the rest of IUplinkHost, each member recording or returning a default
}
```

`GonogoPrincipiaUplink.Tests`, `GonogoTestFlightUplink.Tests` and
`GonogoActionGroupsExtendedUplink.Tests` reach nothing private and are the shape
to copy. The remaining nine are the ones carrying debt, not the ones to imitate.

Two other habits keep a Tests project clean, and both come from those two:

- **Selective `<Compile Include>`** of the Uplink's own sources, omitting the
  files that name a KSP or Harmony type. Make the Uplink class `partial` so the
  omitted half's partial-method calls simply disappear. That is what lets the
  whole decision surface be driven with no game running
- **Reference `Sitrep.Contract` and your own `.Contract` slice, and stop.** The
  same two lines as the Uplink itself

The cost of this is one copy of a host double per Uplink, which is real, and the
alternative on offer today is a project no author outside this repo can obtain.

## Enforcement

Every gate named below runs locally, and none of them needs KSP installed or a
push to find out. In rough order of how fast they answer:

```bash
# the TypeScript half: imports, declarations, subpath classification,
# the augment route, and the same-name guard. All of them, in one task.
pnpm --filter @ksp-gonogo/core test:scans

# one file of it, while iterating
pnpm --filter @ksp-gonogo/core exec vitest run src/uplink-isolation.test.ts

# the C# half. Runs with no KSP reference assemblies: this project does not
# need them, and the whole suite is seven assertions.
cd mod && dotnet test Sitrep.Core.Tests/Sitrep.Core.Tests.csproj \
  --filter FullyQualifiedName~UplinkIsolation

# can this Uplink LEAVE? installs from tarballs packed as a release would
# publish them, outside the pnpm workspace.
node scripts/uplink-extraction-probe.mjs --only <UplinkName>

# the same question for the plugin assembly. Needs KSP_MANAGED and
# KSP_GAMEDATA, the two the mod build already takes.
node scripts/uplink-csharp-extraction-probe.mjs --only <UplinkName>

# your bundle, with the externals applied and the emitted bytes checked for a
# specifier the app's import map cannot resolve. Run from the client directory.
npx gonogo-uplink bundle
```

`pnpm --filter @ksp-gonogo/core test:scans` is the one to run before a commit;
`turbo run test` is a different, smaller task set and never reaches these
cross-package ratchets. The shrink-only half of each ratchet compares your debt
list against the one at the base revision, so a debt entry you deleted only shows
as deleted once it is COMMITTED: commit, then re-run.

`packages/core/src/uplink-isolation.test.ts` scans every Uplink client, fails on
any import outside the debt list, fails on a blocked strategy returning, and
fails if the debt list grows against the ratchet base revision, which is the tip
before the push on a push and the branch's fork point on a pull request, never
the branch being pushed. See the base-revision section of `docs/ratchets.md`:
that half of this gate could not run in CI at all until 2026-08-25.

`mod/Sitrep.Core.Tests/UplinkIsolationTests.cs` is the C# half: it fails on a
reachable private assembly, on an import of a private namespace, on a bundled
assembly, and on a debt entry for a breach that no longer exists. It also asserts
its own directory walk found every Uplink `Gonogo.sln` declares, because a gate
whose scan silently returns nothing reports no violations and looks exactly like
a clean repo.

**Its Uplink debt lists are empty.** As of 2026-08-20 every Uplink plugin in this
repo compiles against `Sitrep.Contract` and its own contract slice alone, so
`ReferenceDebt` and `ImportDebt` have nothing excused. They stay, empty, because
they are what holds zero at zero: the next breach fails on its own rather than
waiting to be noticed.

**Its `<Uplink>.Tests` debt lists are not, and that zero was never real.** Until
2026-08-30 the walk excluded the `.Tests` siblings, so every list here read zero
while ten of the twelve Uplink test projects referenced a private assembly. A
gate told to skip a directory reports that directory clean.

A `.Tests` project is held to its Uplink's rule, because it is part of that
Uplink: it names that Uplink's types, it `<Compile Include>`s that Uplink's
sources, and it moves with the Uplink when the Uplink leaves. An Uplink whose
suite only builds against private assemblies has not been made extractable, and
whoever forks it inherits tests they cannot run.

Seeded from measurement on 2026-08-30, shrink-only like the others:

- **All ten reached `Sitrep.Contract.TestSupport`**, which is `IsPackable=false` and
  `net10.0`-only, so there is no build of it an outside author could reference
  even if they had it. Six of the ten reach nothing else, and clear the day that
  project is publishable. A NEW Tests project does not join this list and cannot:
  see "Testing a NEW Uplink" above for what it writes instead
- **`GonogoKerbalismUplink.Tests` and `GonogoRealAntennasUplink.Tests`** also
  reach `Sitrep.Core`, for `EnvelopeCodec`, to assert what an extension puts on
  the wire
- **`GonogoKosUplink.Tests` and `GonogoRp1Uplink.Tests`** also reach
  `Sitrep.Host`, and `Sitrep.Core`, `Sitrep.Transport` and `Sitrep.Propagation`
  behind it, none of which their csprojs name. Those are the transitive case, and
  the widest breaches
- **`GonogoPrincipiaUplink.Tests` and `GonogoTestFlightUplink.Tests`** are clean,
  which is the proof the rest owe

**`GonogoActionGroupsExtendedUplink.Tests` was the widest of the ten and is now
clean**, which is worth writing down because none of the three fixes was the one
the list above makes it look like:

- the capability id moved to `Sitrep.Contract`, so the id has ONE declaration
  rather than two spellings a test pins equal
- the cases needing `ChannelEngine` turned out to be asserting CORE's two-pass
  discovery ordering, through a hand-written double of the Uplink rather than the
  Uplink itself. Nothing about them was AGX's, so they moved to
  `Sitrep.Host.Tests/ActionGroupsElectionTests.cs`, where the engine may be named
- the probe host became `RecordingUplinkHost.cs` in the Tests project, which is
  what "Testing a NEW Uplink" above tells a new Uplink to write anyway

Only the first was a contract change. The other two were a test asserting
somebody else's behaviour from the one place that may not name it, and a shared
helper reached for out of habit: look for both before concluding an entry here
needs `Sitrep.Contract.TestSupport` to ship.

There is no packaging equivalent for a `.Tests` project and there should not be:
a test assembly's `bin/` is never installed into `GameData`, so there is no
shared AppDomain for it to shadow anything in.

It lives in `core` because core is what Uplinks must not depend on, so core owns
the rule; when the Uplinks move to their own repos the guard stops having
subjects rather than needing to move with them.

Both reference gates read what an Uplink NAMES, so neither can see what arrives
unnamed. `scripts/uplink-extraction-probe.mjs` and
`scripts/uplink-csharp-extraction-probe.mjs` ask the other question, one leg per
Uplink in `.github/workflows/uplink.yml`: does this Uplink still build with the
rest of the repository out of reach. The client half installs from tarballs packed
as a release would publish them, outside the pnpm workspace. The C# half copies
the Uplink and its own contract slice out of `mod/`, brings no
`Directory.Build.props`, and repoints the contract reference at the
`Sitrep.Contract.dll` GonogoCore installs.

What that catches and the reference gates cannot: a `<Compile Include>` reaching
sideways into a private project names no reference at all. Planted on 2026-08-26,
one pointing at `Sitrep.Host` left `UplinkIsolationTests` at 4 of 4 passing and
failed the probe.

Its sibling `uplink-boundary.test.ts` guards the opposite direction: the app must
not name a mod. Neither implies the other. The inward direction went unguarded
from the first day of the Uplink architecture (2026-07-12) until 2026-08-18,
because the name `uplink-boundary` read as though it covered both.

## Two published packages export the same names

A short list of names is declared by BOTH published packages, so both imports
compile and neither looks wrong:

```ts
import { registerAugment } from "@ksp-gonogo/sitrep-sdk";   // the one to write
import { registerAugment } from "@ksp-gonogo/ui-kit";       // do not
```

**The set is enumerable, and one file holds it.** `KNOWN_DIVERGENCES` in
`packages/core/src/styleguide-shared-published-surface.test.ts` is every name
declared twice across the two published packages. It is shrink-only and a NEW
duplicate fails outright, so the list is complete by construction rather than by
anyone remembering to update it. Today it is seven names in two groups:

- **the augment registry**: `registerAugment`, `AugmentSlot`,
  `getAugmentsForSlot`, `clearAugments`
- **the unit system**: `registerUnit`, `displaySymbol`, `UnitDefinition`

### The augment four: take them off the sdk

The sdk's are one-line shims onto the host the app injects at boot. ui-kit's are
the registry those shims eventually reach: `@ksp-gonogo/core` re-exports the
augment surface FROM ui-kit, both to build the host and so that a
`declare module "@ksp-gonogo/core"` augmentation of `SlotRegistry` still merges
through the re-export. So the names have to stay on ui-kit's barrel and the rule
has to be about who imports them, which is why this is a guard rather than a
narrower barrel.

Three reasons the sdk is the right end, and it is worth being exact about which
of them is still live, because the scariest one was fixed on 2026-09-01:

1. **Types.** An Uplink writes `declare module "@ksp-gonogo/sitrep-sdk"` to add
   its slot ids. `AugmentSlot` imported from ui-kit is typed against ui-kit's
   `SlotRegistry`, which your declaration never merged into
2. **Failure mode.** With no host installed, the sdk's shims throw a named error
   that says the package is not external and names the fix. ui-kit's carry on
   silently. A mis-bundled Uplink should fail loud at first registration
3. **A second copy of the registry.** This USED to be the headline: ui-kit's
   registry was a module-static `Map`, so an Uplink that inlined ui-kit instead
   of marking it external registered into its own copy, the dashboard read the
   app's, and the author's augments silently never appeared. That is fixed: the
   registry now lives in one `globalThis` slot, two loaded copies share it, and
   `packages/ui-kit/src/augments.second-copy.test.ts` arranges a genuine second
   module instance and asserts each copy sees the other's registrations. Earlier
   revisions of this page described the trap as live. It is not

Reading counts as well as registering. A test that registers through the sdk and
reads back through ui-kit is asserting on the convergence rather than on its own
Uplink.

`packages/core/src/uplink-augment-route.test.ts` fails the wrong import, and it
covers seven names rather than the four above: `getAugments`,
`getAugmentSettings` and `onAugmentsChange` are banned off ui-kit too. Those
three have no sdk twin at all: they are the app's own reads of the registry, so
an Uplink has no route to them from either package. If you find you genuinely
need one, the rule is the same as anywhere else on this page: move the export
onto the sdk, do not import across.

### The unit three: an open ruling, not a shim

`registerUnit` is not a shim pair. There are two independent unit registries with
the same entry points and DIFFERENT signatures: `registerUnit(def: UnitDefinition)`
on ui-kit against `registerUnit(registration: UnitRegistration)` on the sdk, and
`displaySymbol` takes a token plus options on one and a bare token on the other.
Two designs, not a copy. The ruling is that **the sdk owns the unit system and
ui-kit defers**, so an Uplink teaching the formatter a new unit registers through
the sdk. A merge of the two is held pending a measurement of what each registry
actually holds, because a token present in only one of them is invisible to the
other and that is a live defect rather than a duplication.

### The general rule

If a name exists on both packages, the sdk's is the one an Uplink writes. The
list above is the whole of the set, and `styleguide-shared-published-surface.test.ts`
is what stops a new pair being introduced without a decision. Neither guard can
tell you *why* while you are writing the import, which is what this section is
for.
