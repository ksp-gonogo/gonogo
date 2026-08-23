# Uplink isolation: what an Uplink may import

An Uplink is a self-contained integration for one mod. The whole point is that
someone outside this repository can write one. That only holds if an Uplink
depends on surfaces they actually have.

## The rule

An Uplink client (`mod/Gonogo*Uplink/client/src/**`) may import:

- **`@ksp-gonogo/sitrep-sdk`**, the devkit, and its subpaths:
  - `@ksp-gonogo/sitrep-sdk/media`, the delayed-media layer a camera Uplink needs
  - `@ksp-gonogo/sitrep-sdk/testing`, the host, the spine and the stream fixture
- **`@ksp-gonogo/ui-kit`**, the published design system, and its subpaths:
  - `@ksp-gonogo/ui-kit/testing`, the widget provider stack and the readout helpers
  - `@ksp-gonogo/ui-kit/render-probe` and `/render`, the render harness
- `react`, `styled-components`, and third-party packages

Nothing else from this repo. `core`, `ui`, `components`, `data`, `logger`,
`sitrep-client` and `test-utils` are all `private: true` and unpublished, so an
author outside this tree cannot install them, typecheck against them, or build. So
are the Uplinks themselves, which is why one Uplink may not import another.

`@ksp-gonogo/ui` and `@ksp-gonogo/ui-kit` are different packages. `ui` is private
and app-side; only `ui-kit` is published.

`@ksp-gonogo/test-utils` was the exception nobody noticed: it went unlisted in
`FORBIDDEN_PACKAGES` until 2026-08-18, so the guard read as clean while 56 Uplink
files imported it. The themed `render`/`renderHook` are published from
`@ksp-gonogo/sitrep-sdk/testing`. Import those.

### The import map is not a licence

`packages/app/src/uplinks/externals/` bakes an import map that resolves fourteen
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

## The same rule applies to the C# side

An Uplink is a client *and* a plugin assembly, and the reasoning does not change
at the language boundary. `mod/Gonogo*Uplink/*.csproj` may reference:

- **`Sitrep.Contract`**, the contract assembly core ships
- **its own `<Uplink>.Contract`** slice
- KSP/Unity reference assemblies and the third-party mod it integrates

`Sitrep.Host`, `Sitrep.Core`, `Sitrep.Transport`, `Sitrep.Propagation`,
`Sitrep.CaptureAnalysis`, `Sitrep.Skeleton` and `Gonogo.KSP` are unpublished. An
outside author has no way to obtain them, so an Uplink that references one cannot
be built by anyone but us.

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
is what took `GonogoKerbalismUplink` off `Gonogo.KSP`. Two things fell out of
doing it:

- **Keep the capability id in the contract.** `ActionGroupsElection.CapabilityId`
  lives in the unpublished `Sitrep.Host`, so the AGX uplink has to re-declare
  `"actionGroups"` as its own constant and a test pins the two equal. An id both
  halves must spell identically belongs where both halves can reach it
- **A capability resolves only after every Uplink has registered.** That ordering
  is what lets an Uplink register a provider at all, so nothing can resolve one
  during its own `Register`. Capture the Kernel there and resolve per use, the way
  `VesselUplink` already does for action groups and maneuver plans

A one-implementation capability is still the right shape. The point is not the
election; it is that a caller reaches the thing without reaching the assembly it
lives in.

### Reachable, not declared

ProjectReference is transitive and nothing in this graph sets `PrivateAssets`, so
the assemblies you can compile against are the *closure* of what your csproj
names, not the list itself. One reference to `Gonogo.KSP` puts five private
assemblies on your compile surface. Count the closure, not the lines.

### An Uplink must not bundle what it reaches

KSP loads every `GameData` plugin into one AppDomain, so an Uplink shipping its
own copy of a core assembly shadows core's. `Private="false"` on a
ProjectReference does **not** suppress copying of that project's own transitive
references, so every reachable project must be named in your csproj with the flag,
including ones you never import. Those references exist to stop a copy, not to
compile, and deleting them for tidiness silently re-opens the copying.

Do not verify this by looking in `bin/`: an incremental build shows whatever was
there last time. `rm -rf bin obj` first, or trust the gate below, which checks the
references instead.

## Enforcement

`packages/core/src/uplink-isolation.test.ts` scans every Uplink client, fails on
any import outside the debt list, fails on a blocked strategy returning, and
fails if the debt list grows against `origin/staging`.

`mod/Sitrep.Core.Tests/UplinkIsolationTests.cs` is the C# half: it fails on a
reachable private assembly, on an import of a private namespace, on a bundled
assembly, and on a debt entry for a breach that no longer exists. It also asserts
its own directory walk found every Uplink `Gonogo.sln` declares, because a gate
whose scan silently returns nothing reports no violations and looks exactly like
a clean repo.

**Its debt list is empty.** As of 2026-08-20 every Uplink in this repo compiles
against `Sitrep.Contract` and its own contract slice alone, so the C# gate has
nothing excused. The list stays, empty, because it is what holds zero at zero:
the next breach fails on its own rather than waiting to be noticed.

It lives in `core` because core is what Uplinks must not depend on, so core owns
the rule; when the Uplinks move to their own repos the guard stops having
subjects rather than needing to move with them.

Its sibling `uplink-boundary.test.ts` guards the opposite direction: the app must
not name a mod. Neither implies the other. The inward direction went unguarded
from the first day of the Uplink architecture (2026-07-12) until 2026-08-18,
because the name `uplink-boundary` read as though it covered both.

## Two published packages export the same names, and only one of them works

Importing the wrong one of two same-named exports makes your augments silently
not appear. No error, no warning, nothing in the console: the slot just renders
without them.

`@ksp-gonogo/sitrep-sdk` and `@ksp-gonogo/ui-kit` are both published, so both of
these compile and neither looks wrong:

```ts
import { registerAugment } from "@ksp-gonogo/sitrep-sdk";   // correct
import { registerAugment } from "@ksp-gonogo/ui-kit";       // silently broken
```

They are not the same function. The sdk's is a shim onto the host the app injects
at boot, so it reaches the app's single registry. ui-kit's IS the registry, and
your bundle contains its own copy of it, so registering there writes to a map
nothing ever reads.

**Take the whole augment surface off `@ksp-gonogo/sitrep-sdk`:**
`registerAugment`, `AugmentSlot`, `getAugmentsForSlot`, and (in tests)
`clearAugments` from `@ksp-gonogo/sitrep-sdk/testing`. That includes reading, not
just registering: a test that registers through the sdk and then reads back
through ui-kit is relying on the two being the same object, which is true today
by accident of how the host resolves and is not a contract.

The same reasoning applies to anything else the sdk exposes as a host shim. If a
name exists on both packages, the sdk's is the one that reaches the app.

`packages/core/src/uplink-augment-route.test.ts` fails on the wrong import, and
`styleguide-shared-published-surface.test.ts` stops a new same-named pair being
introduced without a decision. Neither can tell you *why* while you are writing
the import, which is what this section is for.
