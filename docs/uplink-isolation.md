# Uplink isolation: what an Uplink may import

An Uplink is a self-contained integration for one mod. The whole point is that
someone outside this repository can write one. That only holds if an Uplink
depends on surfaces they actually have.

## The rule

An Uplink client (`mod/Gonogo*Uplink/client/src/**`) may import:

- **`@ksp-gonogo/sitrep-sdk`**, the devkit
- **`@ksp-gonogo/ui-kit`**, the published design system
- `react`, `styled-components`, and third-party packages

Nothing else from this repo. `core`, `ui`, `components`, `data`, `logger` and
`sitrep-client` are all `private: true` and unpublished, so an author outside this
tree cannot install them, typecheck against them, or build.

`@ksp-gonogo/ui` and `@ksp-gonogo/ui-kit` are different packages. `ui` is private
and app-side; only `ui-kit` is published.

### The import map is not a licence

`packages/app/src/uplinks/externals/` bakes an import map that resolves twelve
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
- a test helper (`clearRegistry`, `MockDataSource`, `installDomStubs`,
  `clearUplinkHandles`, `clearActionHandlers`) → publish it through
  `@ksp-gonogo/sitrep-sdk/testing`, which currently exports only
  `installTestHost` and `resetTestHost`

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
