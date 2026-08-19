# Uplink isolation: what an Uplink may import

An Uplink is a self-contained integration for one mod. The whole point is that
someone outside this repository can write one. That only holds if an Uplink
depends on surfaces they actually have.

## The rule

An Uplink client (`mod/Gonogo*Uplink/client/src/**`) may import:

- **`@ksp-gonogo/sitrep-sdk`**, the devkit, and its subpaths:
  - `@ksp-gonogo/sitrep-sdk/media`, the delayed-media layer a camera Uplink needs
  - `@ksp-gonogo/sitrep-sdk/testing`, the test harness
- **`@ksp-gonogo/ui-kit`**, the published design system
- `react`, `styled-components`, and third-party packages

Nothing else from this repo. `core`, `ui`, `components`, `data`, `logger`,
`sitrep-client` and `test-utils` are all `private: true` and unpublished, so an
author outside this tree cannot install them, typecheck against them, or build. So
are the Uplinks themselves, which is why one Uplink may not import another.

`@ksp-gonogo/ui` and `@ksp-gonogo/ui-kit` are different packages. `ui` is private
and app-side; only `ui-kit` is published.

`@ksp-gonogo/test-utils` was the exception nobody noticed: it went unlisted in
`FORBIDDEN_PACKAGES` until 2026-08-18, so the guard read as clean while 56 Uplink
files imported it. It is now a one-line re-export of
`@ksp-gonogo/ui-kit/testing-react`, which is where the themed `render`/`renderHook`
live and is published. Import that.

### The import map is not a licence

`packages/app/src/uplinks/externals/` bakes an import map that resolves thirteen
specifiers, `core` and `sitrep-client` among them, to the app's singleton chunks at
runtime. That mechanism is real and load-bearing: it is what makes a loaded
widget's `registerComponent` write into the registry the dashboard reads.

It fixes RUNTIME resolution only. It says nothing about how an author builds in the
first place, and a package you cannot install is not available to you just because
the browser could have found it.

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
- a render helper (`render`, `renderHook`, and the Testing Library surface
  alongside them) → `@ksp-gonogo/ui-kit/testing-react`. It is a separate entry
  from `@ksp-gonogo/ui-kit/testing` because that one deliberately imports nothing
  from React or the DOM, and a runtime bundle must never pull React test code in
- a test helper that needs the real spine (`clearRegistry`, `MockDataSource`,
  `installDomStubs`, `clearUplinkHandles`, `clearActionHandlers`,
  `setupStreamFixture`, and `installRealTestHost` itself) →
  `@ksp-gonogo/sitrep-testing`, a published package that sits ABOVE `core` and
  `sitrep-client` and hands over the REAL `TelemetryClient` / `TimelineStore` /
  `StubTransport`. It exists, so an Uplink's tests should need nothing else

  It deliberately does NOT go in `@ksp-gonogo/sitrep-sdk/testing`. The SDK is the
  leaf everything else depends on, so it cannot re-export from `core` or
  `sitrep-client` without a cycle, and the only way to publish a harness from
  there would be to reimplement the spine over an in-memory store. That would
  leave every stream test passing while testing a reimplementation of the thing
  it is supposed to be evidence about, which is the exact inversion of
  `CLAUDE.md`'s "mock as little of the system as possible". A third-party author
  should run the same spine we do

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

## Enforcement

`packages/core/src/uplink-isolation.test.ts` scans every Uplink client, fails on
any import outside the debt list, fails on a blocked strategy returning, and
fails if the debt list grows against `origin/staging`.

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
