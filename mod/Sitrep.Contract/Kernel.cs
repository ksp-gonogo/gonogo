using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Contract
{
    /// <summary>
    /// C# port of <c>mod/sitrep-kernel/src/capability.ts</c>'s provider-side
    /// version constraints. Mirrors the TS <c>ProviderVersions</c> interface.
    /// </summary>
    public sealed class ProviderVersions
    {
        public string Self { get; set; } = "";
        public string? MinKernelVersion { get; set; }
        public VersionRange? TargetModVersionRange { get; set; }
    }

    /// <summary>
    /// C# port of <c>mod/sitrep-kernel/src/capability.ts</c>'s
    /// <c>CapabilityDescriptor</c>. A "capability" is a named extension point
    /// (e.g. "comms", "sensors"). An <see cref="Exclusive"/> capability
    /// activates at most one provider (falling back to <see cref="Vanilla"/>
    /// when no provider is registered); a shared (non-exclusive) capability
    /// activates every registered provider.
    /// </summary>
    public sealed class CapabilityDescriptor
    {
        public string Id { get; set; } = "";

        /// <summary>One active provider (exclusive) vs many active providers (shared).</summary>
        public bool Exclusive { get; set; }

        /// <summary>
        /// A capability the spine cannot run without: unsatisfiable (no
        /// provider, no vanilla) halts <see cref="Kernel.Resolve"/>.
        /// </summary>
        public bool SpineCritical { get; set; }

        /// <summary>Always-present, lowest-priority fallback factory.</summary>
        public Func<ProviderContext, object?>? Vanilla { get; set; }
    }

    /// <summary>
    /// C# port of <c>mod/sitrep-kernel/src/capability.ts</c>'s
    /// <c>ProviderRegistration</c>.
    /// </summary>
    public sealed class ProviderRegistration
    {
        public string Capability { get; set; } = "";
        public string Id { get; set; } = "";

        /// <summary>Exclusive-conflict tie-breaking.</summary>
        public bool IsDefault { get; set; }

        /// <summary>Exclusive-conflict tie-breaking. Unset providers compare as 0.</summary>
        public double Priority { get; set; }

        /// <summary>Capabilities this provider's factory depends on.</summary>
        public IReadOnlyList<string>? Deps { get; set; }

        public ProviderVersions? Versions { get; set; }

        public Func<ProviderContext, object?> Factory { get; set; } = null!;
    }

    /// <summary>
    /// C# port of <c>mod/sitrep-kernel/src/capability.ts</c>'s
    /// <c>ProviderContext</c> — passed to every factory (provider or
    /// vanilla) when it runs.
    /// </summary>
    public sealed class ProviderContext
    {
        public string KernelVersion { get; }

        private readonly Func<string, object?> _query;

        public ProviderContext(string kernelVersion, Func<string, object?> query)
        {
            KernelVersion = kernelVersion;
            _query = query;
        }

        /// <summary>Resolve another (already-active) capability's single active instance.</summary>
        public T Query<T>(string capability)
        {
            return (T)_query(capability)!;
        }
    }

    /// <summary>C# port of <c>mod/sitrep-kernel/src/registry.ts</c>'s <c>ResolveOptions</c>.</summary>
    public sealed class ResolveOptions
    {
        public string KernelVersion { get; set; } = "";
        public string? ModVersion { get; set; }
        public IReadOnlyDictionary<string, string>? Preferences { get; set; }
    }

    /// <summary>
    /// C# port of <c>mod/sitrep-kernel/src/registry.ts</c>'s
    /// <c>ResolutionNotice</c>. <see cref="Kind"/> is one of:
    /// "superseded" (exclusive-conflict resolution), "version-excluded"
    /// (version gating), or "vanilla-fallback" (no provider survived
    /// selection, used the capability's vanilla factory instead).
    /// </summary>
    public sealed class ResolutionNotice
    {
        public string Capability { get; set; } = "";
        public string Kind { get; set; } = "";
        public string Detail { get; set; } = "";
    }

    /// <summary>Result of <see cref="Kernel.Resolve"/>.</summary>
    public sealed class ResolveResult
    {
        public IReadOnlyList<ResolutionNotice> Notices { get; set; } = Array.Empty<ResolutionNotice>();
    }

    /// <summary>
    /// C# port of <c>mod/sitrep-kernel/src/registry.ts</c>'s <c>Kernel</c>
    /// class — the capability/provider registry. Semantics MUST stay
    /// byte-for-byte identical to the TS reference — conformance is asserted
    /// by <c>Sitrep.Core.Tests</c> against the shared golden fixture in
    /// <c>mod/golden-fixtures/kernel.json</c>, not by re-deriving semantics
    /// here. If you touch this file, regenerate the fixture from the TS side
    /// first (`pnpm --filter @ksp-gonogo/sitrep-kernel gen:golden-fixtures`) and
    /// re-run `dotnet test` to confirm the two still agree.
    ///
    /// <see cref="Resolve"/> runs in three phases, in order:
    ///  1. <b>Selection</b> (<see cref="SelectCapability"/>) — for every
    ///     registered capability, decide which provider(s) win (version
    ///     gating, then exclusive-conflict resolution or shared fan-out). No
    ///     factory runs yet, so this phase can freely iterate capabilities in
    ///     registration order without any capability depending on another
    ///     capability's factory having already run.
    ///  2. <b>Ordering</b> (<see cref="Broker.TopoSortActivationOrder"/>) —
    ///     build one dependency-graph node per capability from its selected
    ///     provider(s)' <see cref="ProviderRegistration.Deps"/>, and
    ///     topo-sort so a capability's declared dependencies precede it.
    ///     Throws <see cref="DependencyCycleError"/> if the graph has a
    ///     cycle.
    ///  3. <b>Activation</b> (<see cref="ActivateSelection"/>) — walk the
    ///     topo order and invoke factories, writing each capability's active
    ///     instances into the active-instance table immediately after its
    ///     factory runs (not batched at the end), so a later capability's
    ///     factory can call <c>ctx.Query(dep)</c> and see the dependency's
    ///     already-active instance.
    ///
    /// Both selection and ordering happen before any factory runs, which is
    /// what makes a throwing <see cref="Resolve"/> atomic: nothing is
    /// written to the active-instance table until activation begins, and
    /// activation only starts once selection/ordering have both succeeded
    /// without throwing.
    /// </summary>
    public sealed class Kernel
    {
        private readonly Dictionary<string, CapabilityDescriptor> _capabilities =
            new Dictionary<string, CapabilityDescriptor>();
        private readonly Dictionary<string, List<ProviderRegistration>> _providers =
            new Dictionary<string, List<ProviderRegistration>>();
        private readonly Dictionary<string, List<object?>> _activeInstances =
            new Dictionary<string, List<object?>>();

        /// <summary>
        /// Capability registration order — tracked explicitly (rather than
        /// relying on <see cref="Dictionary{TKey,TValue}"/> enumeration
        /// order) so selection/ordering stays deterministic regardless of
        /// runtime dictionary-iteration behavior.
        /// </summary>
        private readonly List<string> _capabilityOrder = new List<string>();

        public void RegisterCapability(CapabilityDescriptor descriptor)
        {
            if (!_capabilities.ContainsKey(descriptor.Id))
            {
                _capabilityOrder.Add(descriptor.Id);
            }
            _capabilities[descriptor.Id] = descriptor;
            if (!_providers.ContainsKey(descriptor.Id))
            {
                _providers[descriptor.Id] = new List<ProviderRegistration>();
            }
            if (!_activeInstances.ContainsKey(descriptor.Id))
            {
                _activeInstances[descriptor.Id] = new List<object?>();
            }
        }

        public void RegisterProvider(ProviderRegistration registration)
        {
            if (!_providers.TryGetValue(registration.Capability, out var providers))
            {
                throw new InvalidOperationException(
                    $"Cannot register provider \"{registration.Id}\" for unknown capability " +
                    $"\"{registration.Capability}\". Call RegisterCapability() first.");
            }
            providers.Add(registration);
        }

        public ResolveResult Resolve(ResolveOptions opts)
        {
            var notices = new List<ResolutionNotice>();
            var ctx = new ProviderContext(opts.KernelVersion, capability => Query<object?>(capability));

            // Phase 1: selection — decide the winning provider(s) per
            // capability. No factory has run yet, so this can safely iterate
            // in plain registration order regardless of any Deps
            // relationships.
            var selections = new List<CapabilitySelection>();
            foreach (var id in _capabilityOrder)
            {
                selections.Add(SelectCapability(_capabilities[id], opts, notices));
            }

            // Phase 2: ordering — topo-sort capability activation so a
            // provider's Deps are active before its factory runs. Edges come
            // from each capability's *selected* provider(s), not every
            // registered candidate.
            var nodes = selections
                .Select(selection => new DependencyNode(
                    selection.Descriptor.Id,
                    Dedupe(selection.Providers.SelectMany(p => p.Deps ?? Array.Empty<string>()))))
                .ToList();
            var order = Broker.TopoSortActivationOrder(nodes);
            var selectionById = selections.ToDictionary(s => s.Descriptor.Id);

            // Phase 3: activation — run factories in topo order, publishing
            // each capability's active instances immediately so later
            // factories in the order can ctx.Query() them.
            foreach (var capability in order)
            {
                if (!selectionById.TryGetValue(capability, out var selection))
                {
                    continue;
                }
                var instances = ActivateSelection(selection, ctx, notices);
                _activeInstances[capability] = instances;
            }

            return new ResolveResult { Notices = notices };
        }

        /// <summary>
        /// Selection phase for one capability: version-gate the registered
        /// candidates, apply the spine-critical halt check, then hand the
        /// survivors to exclusive-conflict resolution or shared fan-out.
        /// Returns the provider(s) chosen to activate — empty means "fall
        /// back to vanilla (or nothing)" once activation runs. Does not call
        /// any factory.
        /// </summary>
        private CapabilitySelection SelectCapability(
            CapabilityDescriptor descriptor,
            ResolveOptions opts,
            List<ResolutionNotice> notices)
        {
            var registered = _providers.TryGetValue(descriptor.Id, out var list)
                ? list
                : new List<ProviderRegistration>();
            var candidates = FilterVersionCompatible(descriptor.Id, registered, opts, notices);

            if (descriptor.SpineCritical && candidates.Count == 0 && descriptor.Vanilla == null)
            {
                throw new SpineCapabilityUnsatisfiedError(descriptor.Id);
            }

            var providers = descriptor.Exclusive
                ? SelectExclusive(descriptor.Id, candidates, notices, opts.Preferences)
                : candidates;

            return new CapabilitySelection(descriptor, providers);
        }

        /// <summary>
        /// Version-gate pass: runs BEFORE exclusive/shared selection, so
        /// ambiguity is computed only over providers compatible with the
        /// running kernel/mod version. A provider whose
        /// <c>Versions.MinKernelVersion</c> exceeds
        /// <see cref="ResolveOptions.KernelVersion"/>, or whose
        /// <c>Versions.TargetModVersionRange</c> does not contain
        /// <see cref="ResolveOptions.ModVersion"/>, is excluded and gets a
        /// "version-excluded" notice naming it. A provider with no
        /// <c>Versions</c> (or no constraints within it) is always
        /// compatible.
        /// </summary>
        private static List<ProviderRegistration> FilterVersionCompatible(
            string capability,
            List<ProviderRegistration> candidates,
            ResolveOptions opts,
            List<ResolutionNotice> notices)
        {
            var compatible = new List<ProviderRegistration>();

            foreach (var candidate in candidates)
            {
                var kernelOk = Semver.SatisfiesKernel(opts.KernelVersion, candidate.Versions?.MinKernelVersion);
                var modOk = Semver.SatisfiesModRange(opts.ModVersion, candidate.Versions?.TargetModVersionRange);

                if (kernelOk && modOk)
                {
                    compatible.Add(candidate);
                    continue;
                }

                notices.Add(new ResolutionNotice
                {
                    Capability = capability,
                    Kind = "version-excluded",
                    Detail =
                        $"Provider \"{candidate.Id}\" excluded: incompatible with kernelVersion " +
                        $"\"{opts.KernelVersion}\"" +
                        (opts.ModVersion != null ? $" / modVersion \"{opts.ModVersion}\"" : "") +
                        ".",
                });
            }

            return compatible;
        }

        public IReadOnlyList<object?> Active(string capability)
        {
            AssertKnownCapability(capability);
            return _activeInstances.TryGetValue(capability, out var list)
                ? list
                : new List<object?>();
        }

        public T Query<T>(string capability)
        {
            var instances = Active(capability);
            if (instances.Count != 1)
            {
                throw new InvalidOperationException(
                    $"Capability \"{capability}\" does not resolve to exactly one active provider " +
                    $"(found {instances.Count}).");
            }
            return (T)instances[0]!;
        }

        /// <summary>
        /// Exclusive-conflict selection: picks 0 or 1 winning provider from
        /// <paramref name="candidates"/> without calling any factory. Emits
        /// "superseded" notices for every non-winning candidate.
        /// </summary>
        private static List<ProviderRegistration> SelectExclusive(
            string capability,
            List<ProviderRegistration> candidates,
            List<ResolutionNotice> notices,
            IReadOnlyDictionary<string, string>? preferences)
        {
            if (candidates.Count == 0)
            {
                return new List<ProviderRegistration>();
            }
            if (candidates.Count == 1)
            {
                return new List<ProviderRegistration> { candidates[0] };
            }

            var (winner, reason) = ResolveExclusiveWinner(capability, candidates, preferences);

            foreach (var candidate in candidates)
            {
                if (ReferenceEquals(candidate, winner))
                {
                    continue;
                }
                notices.Add(new ResolutionNotice
                {
                    Capability = capability,
                    Kind = "superseded",
                    Detail = $"Provider \"{candidate.Id}\" superseded by \"{winner.Id}\" ({reason}).",
                });
            }

            return new List<ProviderRegistration> { winner };
        }

        /// <summary>
        /// Precedence for an exclusive capability with &gt;=2 candidates:
        ///  1. <c>preferences[capability]</c> naming a registered provider id
        ///     wins outright (preference beats default). A preference naming
        ///     an unregistered id is a stale preference — ignored, falling
        ///     through.
        ///  2. Else a single <c>IsDefault</c> provider wins. Multiple
        ///     <c>IsDefault</c> providers is itself ambiguous.
        ///  3. Else the single provider with the unique highest
        ///     <see cref="ProviderRegistration.Priority"/> (default 0) wins —
        ///     a clean supersede.
        ///  4. Else — two or more tied top candidates with no
        ///     default/preference to break the tie — fail loud with
        ///     <see cref="AmbiguousResolutionError"/> rather than silently
        ///     picking by registration order.
        /// </summary>
        private static (ProviderRegistration Winner, string Reason) ResolveExclusiveWinner(
            string capability,
            List<ProviderRegistration> candidates,
            IReadOnlyDictionary<string, string>? preferences)
        {
            if (preferences != null && preferences.TryGetValue(capability, out var preferredId))
            {
                var preferred = candidates.FirstOrDefault(c => c.Id == preferredId);
                if (preferred != null)
                {
                    return (preferred, "user preference");
                }
                // Stale preference (names a provider that isn't registered
                // for this capability) — ignore it and fall through to
                // default/priority.
            }

            var defaults = candidates.Where(c => c.IsDefault).ToList();
            if (defaults.Count == 1)
            {
                return (defaults[0], "default");
            }
            if (defaults.Count > 1)
            {
                throw new AmbiguousResolutionError(capability, defaults.Select(c => c.Id).ToList());
            }

            var maxPriority = candidates.Max(c => c.Priority);
            var topCandidates = candidates.Where(c => c.Priority == maxPriority).ToList();
            if (topCandidates.Count == 1)
            {
                return (topCandidates[0], $"priority {maxPriority}");
            }

            throw new AmbiguousResolutionError(capability, topCandidates.Select(c => c.Id).ToList());
        }

        /// <summary>
        /// Activation phase: runs the factories for one capability's
        /// selection, in topo order relative to other capabilities. Empty
        /// <see cref="CapabilitySelection.Providers"/> (from either exclusive
        /// or shared selection) falls back to the capability's vanilla
        /// factory.
        /// </summary>
        private static List<object?> ActivateSelection(
            CapabilitySelection selection,
            ProviderContext ctx,
            List<ResolutionNotice> notices)
        {
            if (selection.Providers.Count == 0)
            {
                return ActivateVanilla(selection.Descriptor, ctx, notices);
            }
            return selection.Providers.Select(provider => provider.Factory(ctx)).ToList();
        }

        private static List<object?> ActivateVanilla(
            CapabilityDescriptor descriptor,
            ProviderContext ctx,
            List<ResolutionNotice> notices)
        {
            if (descriptor.Vanilla == null)
            {
                return new List<object?>();
            }
            notices.Add(new ResolutionNotice
            {
                Capability = descriptor.Id,
                Kind = "vanilla-fallback",
                Detail = $"No provider registered for capability \"{descriptor.Id}\"; activated vanilla fallback.",
            });
            return new List<object?> { descriptor.Vanilla(ctx) };
        }

        private void AssertKnownCapability(string capability)
        {
            if (!_capabilities.ContainsKey(capability))
            {
                throw new InvalidOperationException($"Unknown capability \"{capability}\".");
            }
        }

        /// <summary>
        /// Order-preserving de-dup, used to union Deps across a capability's
        /// selected provider(s) before handing them to the topo-sort.
        /// </summary>
        private static List<string> Dedupe(IEnumerable<string> ids)
        {
            var seen = new HashSet<string>();
            var result = new List<string>();
            foreach (var id in ids)
            {
                if (seen.Add(id))
                {
                    result.Add(id);
                }
            }
            return result;
        }

        /// <summary>
        /// The set of providers chosen to activate for one capability,
        /// decided during the selection phase of <see cref="Resolve"/> —
        /// before any factory has run. Empty <see cref="Providers"/> means
        /// "no provider survived selection"; activation then falls back to
        /// the capability's vanilla factory (if any) or resolves to zero
        /// active instances.
        /// </summary>
        private sealed class CapabilitySelection
        {
            public CapabilityDescriptor Descriptor { get; }
            public List<ProviderRegistration> Providers { get; }

            public CapabilitySelection(CapabilityDescriptor descriptor, List<ProviderRegistration> providers)
            {
                Descriptor = descriptor;
                Providers = providers;
            }
        }
    }
}
