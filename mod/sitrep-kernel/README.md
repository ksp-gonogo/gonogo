# @ksp-gonogo/sitrep-kernel

`@ksp-gonogo/sitrep-*` is the Gonogo telemetry mod, codename Sitrep.

This package is the mod's **microkernel**: the extensibility substrate the
rest of Sitrep (and third-party extensions) build on. It is milestone **M4**
of the roadmap — the capability/provider model everything else plugs into.

## The model: nothing is sacred

The kernel doesn't know what "comms" or "sensors" or "power" mean. It knows
**capabilities** (named extension points, each either `exclusive` — at most
one active provider — or shared/fan-out — every registered provider stays
active) and **providers** (implementations registered against a capability
id). A capability can declare a `vanilla` fallback factory, used when no
provider survives selection.

That's the whole idea: even the mod's own first-party pieces — the delay
engine that was M3's headline feature — are just providers behind a
capability, with the exact same registration API a third-party extension
would use. Nothing is hard-wired; the kernel would boot identically whether
the winning `comms` provider was written in-house or dropped in by a
stranger's package.

## `Kernel.resolve()`

One call, three phases, always in this order:

1. **Selection** — for every registered capability, version-gate its
   candidates (a provider's `versions.minKernelVersion` /
   `versions.targetModVersionRange` can exclude it — `"version-excluded"`
   notice), then pick winner(s): an `exclusive` capability picks at most one
   provider (`preferences[capability]` beats a unique `isDefault`, which
   beats a unique highest `priority`; anything left tied is a fail-loud
   `AmbiguousResolutionError` — **multiple `isDefault` providers are
   ambiguous regardless of their `priority` values**, checked before
   priority ever comes into it); a shared capability just keeps everything
   that survived version gating. A `spineCritical` capability with zero
   compatible candidates and no `vanilla` throws
   `SpineCapabilityUnsatisfiedError` — the spine refuses to boot silently
   degraded.
2. **Ordering** — a provider can declare `deps: CapabilityId[]`, capabilities
   its factory needs already active (so it can call `ctx.query(dep)` inside
   its own factory). The broker topo-sorts capability activation from the
   *selected* winners' `deps` graphs. A cycle among selected providers
   throws `DependencyCycleError` naming the cycle.
3. **Activation** — factories run in topo order, publishing each
   capability's active instance(s) immediately so a later factory's
   `ctx.query()` sees them. A capability with zero surviving providers
   activates its `vanilla` factory instead (`"vanilla-fallback"` notice), or
   resolves to zero active instances if it has none.

`resolve()` returns `{ notices: ResolutionNotice[] }` — every supersede,
version-exclusion, and vanilla-fallback that happened, each naming the
capability and (where relevant) the losing/excluded provider id. Nothing
about this list is only-for-debugging: it's the audit trail a future
user-choice UI (see below) would render.

## The courier-as-comms proof

`src/proof/` is the milestone's headline demonstration, not a hidden
implementation detail: the entire M3 delay engine
(`Courier`/`StubNetwork`/`ManualClock`, unmodified, imported from
`@ksp-gonogo/sitrep-server`) is wired up as nothing more than one `comms`
provider (`courier-provider.ts`) behind an exclusive capability, with a
same-shape zero-delay `vanilla-comms.ts` as the fallback. `proof/comms.test.ts`
proves the switch is observable through the kernel alone — same capability
id, same `CommsCapability` interface, opposite delay behavior depending
purely on whether the courier provider is registered. If M3's own delay
engine is just a swappable provider with no special status, the kernel
model is real, not aspirational.

## Testing

`registry.test.ts`, `broker.test.ts`, and `version.test.ts` are the focused
unit suites, one per mechanism. `integration.test.ts` is the holistic
sweep: one `resolve()` wiring an exclusive default+superseded pair, a shared
capability, a cross-capability dependency, and a version-excluded→vanilla
fallback together, asserting the full active set and notices list in one
go (plus a determinism check: rebuilding the identical scenario and
resolving again yields the same result, in the same order) — and the
fail-loud paths (dependency cycle, ambiguous exclusive tie, spine-critical
unsatisfiable, and the two-`isDefault`-unequal-priority edge case) each as
their own throwing `resolve()`.

## What this package is not (yet)

Scoped out of M4, deferred to **M4b**:

- **User-choice UI** — M4 only has the programmatic `preferences` hook on
  `ResolveOptions`; there's no in-game surface for a player to pick a
  provider or see conflict notices rendered.
- **Conflict-notice UX** — `ResolutionNotice[]` exists and is fully
  populated, but nothing displays it yet.
- **Hot-reload** — M4's kernel does one load-time `resolve()`; there's no
  runtime add/remove of providers or re-resolution after boot.
- **Distribution** — the Obsidian-model track (a provider registry,
  download flow, hash-pinning, install consent) doesn't exist. Providers are
  registered in-process by whatever code imports this package.
- **Provenance-invariant enforcement** — nothing currently verifies where a
  provider came from or that it hasn't been tampered with.

**Cut, not deferred:** a control-authority lease (gating who's allowed to
issue commands through a given provider) was scoped for M4 and then cut —
commands pass through ungated, exactly as they already did in M2/M3. If this
comes back, it's a fresh design, not a resumption of shelved work.

See `docs/superpowers/plans/2026-07-06-telemetry-mod-roadmap.md` for the
full milestone breakdown.
