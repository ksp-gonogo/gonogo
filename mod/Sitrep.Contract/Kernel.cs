using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Contract
{
    /// <summary>
    /// The version constraints a provider declares, checked by
    /// <see cref="Kernel.Resolve"/> before any provider is selected. Versions are
    /// plain <c>"x.y.z"</c> strings compared numerically; a missing trailing
    /// component counts as <c>0</c>.
    /// <internal>C# port of <c>mod/sitrep-kernel/src/capability.ts</c>'s
    /// <c>ProviderVersions</c> interface.</internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class ProviderVersions
    {
        /// <summary>The provider's own version. Informational: resolution does not gate on it.</summary>
        public string Self { get; set; } = "";

        /// <summary>
        /// The lowest kernel version this provider runs on, inclusive. A provider
        /// whose minimum exceeds <see cref="ResolveOptions.KernelVersion"/> is
        /// excluded with a <c>"version-excluded"</c> notice. Null means no minimum.
        /// </summary>
        public string? MinKernelVersion { get; set; }

        /// <summary>
        /// The mod versions this provider supports (minimum inclusive, maximum
        /// exclusive). The provider is excluded when
        /// <see cref="ResolveOptions.ModVersion"/> falls outside the range, and
        /// also when the resolution carries no mod version at all. Null means no
        /// constraint.
        /// </summary>
        public VersionRange? TargetModVersionRange { get; set; }
    }

    /// <summary>
    /// A capability: a named extension point (for example <c>"comms"</c>) that
    /// providers register against. An <see cref="Exclusive"/> capability
    /// activates at most one provider, falling back to <see cref="Vanilla"/>
    /// when none is selected or able to run; a shared (non-exclusive) capability
    /// activates every registered provider.
    /// <internal>C# port of <c>mod/sitrep-kernel/src/capability.ts</c>'s
    /// <c>CapabilityDescriptor</c>.</internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class CapabilityDescriptor
    {
        /// <summary>
        /// The capability's id, the key providers register against and
        /// <see cref="Kernel.Query{T}"/> looks up. Registering a second descriptor
        /// with the same id replaces the first.
        /// </summary>
        public string Id { get; set; } = "";

        /// <summary>One active provider (exclusive) vs many active providers (shared).</summary>
        public bool Exclusive { get; set; }

        /// <summary>
        /// A capability the telemetry spine cannot run without. When no provider
        /// is able to serve it and it has no vanilla, <see cref="Kernel.Resolve"/>
        /// throws <see cref="SpineCapabilityUnsatisfiedError"/>.
        /// </summary>
        public bool SpineCritical { get; set; }

        /// <summary>
        /// The always-present, lowest-priority fallback factory, run when no
        /// provider is selected or every selected provider failed or declined.
        /// Null means the capability has no fallback.
        /// </summary>
        public Func<ProviderContext, object?>? Vanilla { get; set; }
    }

    /// <summary>
    /// One provider's claim on a capability, passed to
    /// <see cref="Kernel.RegisterProvider"/>.
    /// <internal>C# port of <c>mod/sitrep-kernel/src/capability.ts</c>'s
    /// <c>ProviderRegistration</c>.</internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class ProviderRegistration
    {
        /// <summary>The id of the capability this provider serves. It must already be registered.</summary>
        public string Capability { get; set; } = "";

        /// <summary>
        /// The provider's id, unique within its capability. Resolution notices
        /// name the provider by it, and a preference in
        /// <see cref="ResolveOptions.Preferences"/> selects the provider by it.
        /// </summary>
        public string Id { get; set; } = "";

        /// <summary>
        /// Marks the provider as the default for an exclusive capability. With no
        /// preference set, a single default wins over priority; two or more
        /// defaults are an ambiguous election.
        /// </summary>
        public bool IsDefault { get; set; }

        /// <summary>
        /// Tie-break for an exclusive capability when neither a preference nor a
        /// single default decides it: the unique highest priority wins. Unset
        /// providers compare as <c>0</c>.
        /// </summary>
        public double Priority { get; set; }

        /// <summary>
        /// Ids of the capabilities this provider's factory depends on. They
        /// activate before this one, so the factory can
        /// <see cref="ProviderContext.Query{T}"/> them.
        /// </summary>
        public IReadOnlyList<string>? Deps { get; set; }

        /// <summary>The provider's version constraints. Null means always compatible.</summary>
        public ProviderVersions? Versions { get; set; }

        /// <summary>
        /// Whether this provider can serve the capability on THIS install, asked
        /// at resolve time before any winner is picked.
        ///
        /// <para>A provider that returns false withdraws with a
        /// <c>"provider-declined"</c> notice: it is not a candidate, so for an
        /// exclusive capability the runner-up wins outright rather than the
        /// capability falling through to vanilla. Relative priority therefore
        /// cannot make a provider that models nothing beat one that does.</para>
        ///
        /// <para>Null means always able.</para>
        /// </summary>
        public Func<bool>? CanServe { get; set; }

        /// <summary>
        /// Builds the provider's instance when it is selected. Returning null
        /// declines (a <c>"provider-declined"</c> notice); throwing records a
        /// <c>"factory-failed"</c> notice. Either way the provider contributes no
        /// instance, and an exclusive capability left with none falls back to its
        /// vanilla.
        /// </summary>
        public Func<ProviderContext, object?> Factory { get; set; } = null!;
    }

    /// <summary>
    /// Passed to every factory, provider or vanilla, when it runs.
    /// <internal>C# port of <c>mod/sitrep-kernel/src/capability.ts</c>'s
    /// <c>ProviderContext</c>.</internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class ProviderContext
    {
        /// <summary>The kernel version of the running resolution, from <see cref="ResolveOptions.KernelVersion"/>.</summary>
        public string KernelVersion { get; }

        private readonly Func<string, object?> _query;
        private readonly Func<string, object?> _vanilla;

        /// <summary>Builds a context. The kernel constructs one per resolution.</summary>
        /// <param name="kernelVersion">The value of <see cref="KernelVersion"/>.</param>
        /// <param name="query">Returns a capability's single active instance, for <see cref="Query{T}"/>.</param>
        /// <param name="vanilla">Returns a capability's vanilla instance, for <see cref="Vanilla{T}"/>.</param>
        public ProviderContext(
            string kernelVersion,
            Func<string, object?> query,
            Func<string, object?> vanilla)
        {
            KernelVersion = kernelVersion;
            _query = query;
            _vanilla = vanilla;
        }

        /// <summary>
        /// Returns another, already-active capability's single active instance.
        /// Throws when the capability is unknown or does not have exactly one
        /// active instance. Declare the capability in
        /// <see cref="ProviderRegistration.Deps"/> so it activates first.
        /// </summary>
        public T Query<T>(string capability)
        {
            return (T)_query(capability)!;
        }

        /// <summary>
        /// The capability's VANILLA instance, whether or not the vanilla won the
        /// election, and including the election this factory is being run for.
        ///
        /// <para><see cref="Query{T}"/> cannot reach it: that returns whatever is
        /// active, so a provider that has just won <c>propagation</c> asking for
        /// <c>propagation</c> gets either nothing (its own capability's instances
        /// are not published until its factory returns) or, after resolution,
        /// itself.</para>
        ///
        /// <para>A provider that displaces an implementation may still need it.
        /// The transfer-window search is patched-conic by design, so a provider
        /// that models n-body still needs conic results to drive it, and can
        /// take them from the vanilla rather than carrying its own copy of
        /// two-body motion.</para>
        ///
        /// <para>One instance per capability per resolution, shared: two
        /// providers asking, and the fallback path itself, all get the same
        /// object. Throws when the capability declares no vanilla, and when a
        /// vanilla factory asks for its own vanilla, which cannot terminate.</para>
        /// </summary>
        public T Vanilla<T>(string capability)
        {
            return (T)_vanilla(capability)!;
        }
    }

    /// <summary>
    /// The inputs to one <see cref="Kernel.Resolve"/>.
    /// <internal>C# port of <c>mod/sitrep-kernel/src/registry.ts</c>'s
    /// <c>ResolveOptions</c>.</internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class ResolveOptions
    {
        /// <summary>
        /// The running kernel's version, checked against each provider's
        /// <see cref="ProviderVersions.MinKernelVersion"/>. The mod passes the
        /// contract version as <c>"Major.Minor.0"</c>.
        /// <internal>Set by Sitrep.Host.ChannelEngine.ResolveCapabilities from
        /// <see cref="ContractVersion"/>.</internal>
        /// </summary>
        public string KernelVersion { get; set; } = "";

        /// <summary>
        /// The running mod's version, checked against each provider's
        /// <see cref="ProviderVersions.TargetModVersionRange"/>. When null, any
        /// provider that declares a mod version range is excluded.
        /// <internal>The mod's own resolution leaves this null.</internal>
        /// </summary>
        public string? ModVersion { get; set; }

        /// <summary>
        /// Preferred provider per exclusive capability: capability id to provider
        /// id. A preference naming a registered provider wins that election
        /// outright; one naming no registered provider is ignored. Null means no
        /// preferences.
        /// </summary>
        public IReadOnlyDictionary<string, string>? Preferences { get; set; }
    }

    /// <summary>
    /// One event from a <see cref="Kernel.Resolve"/>: a provider excluded,
    /// superseded, failed or declined, or a capability that fell back or was
    /// left unresolved.
    /// <internal>C# port of <c>mod/sitrep-kernel/src/registry.ts</c>'s
    /// <c>ResolutionNotice</c>.</internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class ResolutionNotice
    {
        /// <summary>The id of the capability the notice concerns.</summary>
        public string Capability { get; set; } = "";

        /// <summary>
        /// What happened. One of:
        /// <list type="bullet">
        /// <item><c>"superseded"</c>: the provider lost an exclusive election.</item>
        /// <item><c>"version-excluded"</c>: the provider failed its version constraints.</item>
        /// <item><c>"provider-declined"</c>: the provider withdrew through <see cref="ProviderRegistration.CanServe"/>, or its factory returned null.</item>
        /// <item><c>"factory-failed"</c>: the selected provider's factory threw, so it contributes no instance.</item>
        /// <item><c>"vanilla-fallback"</c>: no provider was selected or able to run, and the capability's vanilla was activated.</item>
        /// <item><c>"ambiguous"</c>: an exclusive election tied with nothing to break the tie. One notice per tied provider; the capability is left unresolved, with no vanilla.</item>
        /// <item><c>"selection-failed"</c>: selection threw for any other reason; the capability is left unresolved.</item>
        /// </list>
        /// </summary>
        public string Kind { get; set; } = "";

        /// <summary>A human-readable description of the event, for logs. Do not parse it; branch on <see cref="Kind"/> and <see cref="ProviderId"/>.</summary>
        public string Detail { get; set; } = "";

        /// <summary>
        /// The provider this notice is ABOUT, when exactly one is implicated
        /// ("superseded", "version-excluded", "factory-failed",
        /// "provider-declined", and each tied provider's "ambiguous"). Null for a
        /// capability-wide notice such as "vanilla-fallback" or
        /// "selection-failed", which is about the capability rather than the
        /// conduct of one provider.
        ///
        /// <para>This is what tells "installed and not modelling this save"
        /// (a named provider declined) apart from "nothing installed that could
        /// model it".</para>
        /// </summary>
        public string? ProviderId { get; set; }
    }

    /// <summary>Result of <see cref="Kernel.Resolve"/>.</summary>
    /// <category>Host and Kernel</category>
    public sealed class ResolveResult
    {
        /// <summary>Every notice the resolution produced, in the order they arose. Empty when nothing was excluded, superseded, declined, failed or fell back.</summary>
        public IReadOnlyList<ResolutionNotice> Notices { get; set; } = Array.Empty<ResolutionNotice>();
    }

    /// <summary>
    /// The capability and provider registry. Capabilities and providers are
    /// registered first; <see cref="Resolve"/> then elects the providers and
    /// runs their factories, and <see cref="Active"/> and <see cref="Query{T}"/>
    /// return the resulting instances.
    ///
    /// <para><see cref="Resolve"/> runs in three phases:</para>
    /// <list type="number">
    /// <item><b>Selection</b>: for every capability, in registration order,
    /// decide which providers win: version gating, then
    /// <see cref="ProviderRegistration.CanServe"/>, then an exclusive election
    /// or shared fan-out. No factory runs yet.</item>
    /// <item><b>Ordering</b>: sort capabilities so each selected provider's
    /// <see cref="ProviderRegistration.Deps"/> come before it. Throws
    /// <see cref="DependencyCycleError"/> on a cycle.</item>
    /// <item><b>Activation</b>: run the factories in that order, publishing each
    /// capability's instances as soon as its factory returns, so a later factory
    /// can <see cref="ProviderContext.Query{T}"/> an earlier one.</item>
    /// </list>
    ///
    /// <para>Nothing is published until selection and ordering have both
    /// succeeded, so a <see cref="Resolve"/> that throws leaves the active
    /// instances untouched. Only two outcomes throw: a spine-critical capability
    /// nothing can serve (<see cref="SpineCapabilityUnsatisfiedError"/>) and a
    /// dependency cycle. Every other selection failure, an ambiguous exclusive
    /// election included, is reported as a notice and leaves only its own
    /// capability unresolved.</para>
    /// <internal>
    /// C# port of <c>mod/sitrep-kernel/src/registry.ts</c>'s <c>Kernel</c>
    /// class. Semantics must stay identical to the TS reference: conformance is
    /// asserted by <c>Sitrep.Core.Tests</c> against the shared golden fixture in
    /// <c>mod/golden-fixtures/kernel.json</c>. If you touch this file,
    /// regenerate the fixture from the TS side first
    /// (<c>pnpm --filter @ksp-gonogo/sitrep-kernel gen:golden-fixtures</c>) and
    /// re-run <c>dotnet test</c>. The phases are <c>SelectCapability</c>,
    /// <c>Broker.TopoSortActivationOrder</c> and <c>ActivateSelection</c>;
    /// isolation per capability is <c>SelectIsolated</c>.
    /// </internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class Kernel
    {
        private readonly Dictionary<string, CapabilityDescriptor> _capabilities =
            new Dictionary<string, CapabilityDescriptor>();
        private readonly Dictionary<string, List<ProviderRegistration>> _providers =
            new Dictionary<string, List<ProviderRegistration>>();
        private readonly Dictionary<string, List<object?>> _activeInstances =
            new Dictionary<string, List<object?>>();

        /// <summary>
        /// Vanilla instances built during the current resolution, one per
        /// capability. Shared between <see cref="ProviderContext.Vanilla{T}"/> and
        /// the fallback path so that a stock install has ONE vanilla per
        /// capability rather than one on the wire and a second one some provider
        /// is quietly consulting.
        /// </summary>
        private readonly Dictionary<string, object?> _vanillaInstances =
            new Dictionary<string, object?>();

        /// <summary>Capabilities whose vanilla factory is part-way through running, so re-entry can be named rather than hanging.</summary>
        private readonly HashSet<string> _vanillaInFlight = new HashSet<string>();

        /// <summary>
        /// Notices from the most recent <see cref="Resolve"/>, empty before the
        /// first. This is how a capability's consumer tells "no provider
        /// registered" from "the selected provider's factory threw and the
        /// capability fell back to vanilla": both leave the vanilla elected, and
        /// the second is a fault worth reporting.
        /// </summary>
        public IReadOnlyList<ResolutionNotice> LastNotices { get; private set; } =
            Array.Empty<ResolutionNotice>();

        /// <summary>
        /// Capability registration order: tracked explicitly (rather than
        /// relying on <see cref="Dictionary{TKey,TValue}"/> enumeration
        /// order) so selection/ordering stays deterministic regardless of
        /// runtime dictionary-iteration behavior.
        /// </summary>
        private readonly List<string> _capabilityOrder = new List<string>();

        /// <summary>
        /// Registers a capability. Registering the same id again replaces its
        /// descriptor and keeps its providers and its place in the registration
        /// order.
        /// </summary>
        /// <param name="descriptor">The capability to register.</param>
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

        /// <summary>
        /// Registers a provider against an already-registered capability. Throws
        /// <see cref="InvalidOperationException"/> when the capability is unknown.
        /// Nothing is selected or built until <see cref="Resolve"/>.
        /// </summary>
        /// <param name="registration">The provider to register.</param>
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

        /// <summary>
        /// Elects providers for every registered capability and runs their
        /// factories, replacing the previous resolution's active and vanilla
        /// instances. See the type summary for the phases and what throws.
        /// </summary>
        /// <param name="opts">The kernel version, mod version and preferences to resolve against.</param>
        /// <returns>The notices the resolution produced, also kept on <see cref="LastNotices"/>.</returns>
        public ResolveResult Resolve(ResolveOptions opts)
        {
            var notices = new List<ResolutionNotice>();
            // Vanilla instances are per resolution: reusing the previous one's would leave a displaced provider talking to a vanilla nothing else uses.
            _vanillaInstances.Clear();
            LastNotices = Array.Empty<ResolutionNotice>();
            ProviderContext ctx = null!;
            ctx = new ProviderContext(
                opts.KernelVersion,
                capability => Query<object?>(capability),
                capability => VanillaInstance(capability, ctx));

            // Phase 1: selection. No factory has run yet, so registration order is safe regardless of Deps.
            var selections = new List<CapabilitySelection>();
            foreach (var id in _capabilityOrder)
            {
                selections.Add(SelectIsolated(_capabilities[id], opts, notices));
            }

            // Phase 2: ordering. Edges come from each capability's selected providers, not every registered candidate.
            var nodes = selections
                .Select(selection => new DependencyNode(
                    selection.Descriptor.Id,
                    Dedupe(selection.Providers.SelectMany(p => p.Deps ?? Array.Empty<string>()))))
                .ToList();
            var order = Broker.TopoSortActivationOrder(nodes);
            var selectionById = selections.ToDictionary(s => s.Descriptor.Id);

            // Phase 3: activation, publishing each capability's instances immediately so later factories can ctx.Query() them.
            foreach (var capability in order)
            {
                if (!selectionById.TryGetValue(capability, out var selection))
                {
                    continue;
                }
                var instances = ActivateSelection(selection, ctx, notices);
                _activeInstances[capability] = instances;
            }

            LastNotices = notices;
            return new ResolveResult { Notices = notices };
        }

        /// <summary>
        /// Selection for one capability, with its failure kept to that capability.
        ///
        /// <para>An ambiguous exclusive election is reported as one "ambiguous"
        /// notice per tied provider, and any other selection failure (a provider's
        /// own <see cref="ProviderRegistration.CanServe"/> throwing, say) as one
        /// "selection-failed" notice. Either way the capability is left UNRESOLVED:
        /// no instance, and no vanilla either, since falling back would be the
        /// kernel quietly picking a winner, which is what the ambiguity rule
        /// refuses to do.</para>
        ///
        /// <para>Isolated so one mis-prioritised pair of claimants cannot leave
        /// every capability unresolved. <see cref="SpineCapabilityUnsatisfiedError"/>
        /// is deliberately not caught: a spine-critical capability with nothing to
        /// serve it means the kernel cannot start.</para>
        /// </summary>
        private CapabilitySelection SelectIsolated(
            CapabilityDescriptor descriptor,
            ResolveOptions opts,
            List<ResolutionNotice> notices)
        {
            try
            {
                return SelectCapability(descriptor, opts, notices);
            }
            catch (AmbiguousResolutionError error)
            {
                foreach (var providerId in error.ProviderIds)
                {
                    notices.Add(new ResolutionNotice
                    {
                        Capability = descriptor.Id,
                        Kind = "ambiguous",
                        ProviderId = providerId,
                        Detail = error.Message + " The capability is left unresolved.",
                    });
                }
                return CapabilitySelection.Unresolved(descriptor);
            }
            catch (SpineCapabilityUnsatisfiedError)
            {
                throw;
            }
            catch (Exception error)
            {
                notices.Add(new ResolutionNotice
                {
                    Capability = descriptor.Id,
                    Kind = "selection-failed",
                    Detail =
                        $"Selection for capability \"{descriptor.Id}\" threw: {error.Message} " +
                        "The capability is left unresolved.",
                });
                return CapabilitySelection.Unresolved(descriptor);
            }
        }

        /// <summary>
        /// Selection phase for one capability: version-gate the registered
        /// candidates, apply the spine-critical halt check, then hand the
        /// survivors to exclusive-conflict resolution or shared fan-out.
        /// Returns the provider(s) chosen to activate: empty means "fall
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
            var able = FilterAbleToServe(descriptor.Id, candidates, notices);

            if (descriptor.SpineCritical && able.Count == 0 && descriptor.Vanilla == null)
            {
                throw new SpineCapabilityUnsatisfiedError(descriptor.Id);
            }

            var providers = descriptor.Exclusive
                ? SelectExclusive(descriptor.Id, able, notices, opts.Preferences)
                : able;

            return new CapabilitySelection(descriptor, providers);
        }

        /// <summary>
        /// Ability-to-serve pass: runs BEFORE exclusive selection, so a provider
        /// that cannot serve the capability on this install is not a CANDIDATE and
        /// the runner-up wins the election outright.
        ///
        /// <para>Deliberately not the same thing as declining from the factory. A
        /// factory decline happens after the winner is already chosen, so for an
        /// exclusive capability it falls through to VANILLA and the runner-up never
        /// gets a look in: the capability ends up unserved because the provider
        /// that could NOT do it got there first. Withdrawing here means relative
        /// priority stops mattering, which is the point, since a provider modelling
        /// nothing should lose to one modelling something at any priority.</para>
        ///
        /// <para>Evaluated at resolve time, never at registration: a mod registers
        /// during game load, when its own settings may not be parsed yet, so a
        /// decision taken then would pin whatever happened to be true that early.</para>
        /// </summary>
        private static List<ProviderRegistration> FilterAbleToServe(
            string capability,
            List<ProviderRegistration> registered,
            List<ResolutionNotice> notices)
        {
            var able = new List<ProviderRegistration>();
            foreach (var provider in registered)
            {
                if (provider.CanServe != null && !provider.CanServe())
                {
                    notices.Add(new ResolutionNotice
                    {
                        Capability = capability,
                        Kind = "provider-declined",
                        ProviderId = provider.Id,
                        Detail =
                            $"Provider \"{provider.Id}\" withdrew from capability \"{capability}\": " +
                            "it cannot serve it on this install.",
                    });
                    continue;
                }
                able.Add(provider);
            }
            return able;
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
                    ProviderId = candidate.Id,
                    Detail =
                        $"Provider \"{candidate.Id}\" excluded: incompatible with kernelVersion " +
                        $"\"{opts.KernelVersion}\"" +
                        (opts.ModVersion != null ? $" / modVersion \"{opts.ModVersion}\"" : "") +
                        ".",
                });
            }

            return compatible;
        }

        /// <summary>
        /// Returns a capability's active instances from the most recent
        /// <see cref="Resolve"/>: one for a resolved exclusive capability, any
        /// number for a shared one, none when unresolved or not yet resolved.
        /// Throws <see cref="InvalidOperationException"/> for an unknown capability.
        /// </summary>
        /// <param name="capability">The capability id.</param>
        public IReadOnlyList<object?> Active(string capability)
        {
            AssertKnownCapability(capability);
            return _activeInstances.TryGetValue(capability, out var list)
                ? list
                : new List<object?>();
        }

        /// <summary>
        /// Returns a capability's single active instance, cast to
        /// <typeparamref name="T"/>. Throws <see cref="InvalidOperationException"/>
        /// when the capability is unknown or does not have exactly one active
        /// instance.
        /// </summary>
        /// <typeparam name="T">The type the instance is cast to.</typeparam>
        /// <param name="capability">The capability id.</param>
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
                    ProviderId = candidate.Id,
                    Detail = $"Provider \"{candidate.Id}\" superseded by \"{winner.Id}\" ({reason}).",
                });
            }

            return new List<ProviderRegistration> { winner };
        }

        /// <summary>
        /// Precedence for an exclusive capability with &gt;=2 candidates:
        ///  1. <c>preferences[capability]</c> naming a registered provider id
        ///     wins outright (preference beats default). A preference naming
        ///     an unregistered id is ignored.
        ///  2. Else a single <c>IsDefault</c> provider wins. Multiple
        ///     <c>IsDefault</c> providers is itself ambiguous.
        ///  3. Else the single provider with the unique highest
        ///     <see cref="ProviderRegistration.Priority"/> (default 0) wins:
        ///     a clean supersede.
        ///  4. Else: two or more tied top candidates with no
        ///     default/preference to break the tie, fail loud with
        ///     <see cref="AmbiguousResolutionError"/> rather than silently
        ///     picking by registration order. <see cref="SelectIsolated"/>
        ///     catches it, so the loud failure costs this capability alone.
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
                // A preference naming no registered provider falls through to default/priority.
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
        ///
        /// <para>A factory that throws does not take the capability, or the rest
        /// of the resolution, down with it. Winning an election is not the same
        /// as being able to run: a provider compiled against an older contract
        /// fails its vtable setup at instantiation, long after selection chose
        /// it. So each factory runs in isolation: a thrower is recorded as
        /// <c>factory-failed</c> and contributes nothing, and an exclusive
        /// capability whose sole winner failed falls through to vanilla exactly
        /// as if the provider had never registered.</para>
        /// </summary>
        private List<object?> ActivateSelection(
            CapabilitySelection selection,
            ProviderContext ctx,
            List<ResolutionNotice> notices)
        {
            if (selection.IsUnresolved)
            {
                return new List<object?>();
            }
            if (selection.Providers.Count == 0)
            {
                return ActivateVanilla(selection.Descriptor, ctx, notices);
            }

            var instances = new List<object?>();
            foreach (var provider in selection.Providers)
            {
                try
                {
                    var instance = provider.Factory(ctx);
                    if (instance == null)
                    {
                        /* A decline, not a failure: its notice kind is distinct from
                           factory-failed because a consumer reads that one as "we are blind". */
                        notices.Add(new ResolutionNotice
                        {
                            Capability = selection.Descriptor.Id,
                            Kind = "provider-declined",
                            ProviderId = provider.Id,
                            Detail =
                                $"Provider \"{provider.Id}\" for capability \"{selection.Descriptor.Id}\" " +
                                "declined to serve this capability on this install.",
                        });
                        continue;
                    }
                    instances.Add(instance);
                }
                catch (Exception error)
                {
                    notices.Add(new ResolutionNotice
                    {
                        Capability = selection.Descriptor.Id,
                        Kind = "factory-failed",
                        ProviderId = provider.Id,
                        Detail =
                            $"Provider \"{provider.Id}\" for capability \"{selection.Descriptor.Id}\" " +
                            $"threw during activation: {error.Message}",
                    });
                }
            }

            if (instances.Count == 0)
            {
                return ActivateVanilla(
                    selection.Descriptor, ctx, notices,
                    "Every selected provider failed to activate or declined");
            }
            return instances;
        }

        private List<object?> ActivateVanilla(
            CapabilityDescriptor descriptor,
            ProviderContext ctx,
            List<ResolutionNotice> notices,
            string reason = "No provider registered")
        {
            if (descriptor.Vanilla == null)
            {
                return new List<object?>();
            }
            notices.Add(new ResolutionNotice
            {
                Capability = descriptor.Id,
                Kind = "vanilla-fallback",
                Detail = $"{reason} for capability \"{descriptor.Id}\"; activated vanilla fallback.",
            });
            return new List<object?> { VanillaInstance(descriptor.Id, ctx) };
        }

        /// <summary>
        /// Build (or hand back) this resolution's vanilla instance for
        /// <paramref name="capability"/>, independent of who won its election.
        /// See <see cref="ProviderContext.Vanilla{T}"/> for why a provider asks
        /// for one.
        ///
        /// <para>The re-entry guard is not defensive padding. A vanilla factory
        /// that asks for its own capability's vanilla is asking to be built out of
        /// itself, and left unguarded that recurses until the stack goes, at KSP
        /// startup, inside a factory, where the resulting trace names none of
        /// this.</para>
        /// </summary>
        private object? VanillaInstance(string capability, ProviderContext ctx)
        {
            AssertKnownCapability(capability);
            if (_vanillaInstances.TryGetValue(capability, out var existing))
            {
                return existing;
            }

            var descriptor = _capabilities[capability];
            if (descriptor.Vanilla == null)
            {
                throw new InvalidOperationException(
                    $"Capability \"{capability}\" declares no vanilla, so there is no " +
                    "always-present implementation to fall back on.");
            }
            if (!_vanillaInFlight.Add(capability))
            {
                throw new InvalidOperationException(
                    $"The vanilla factory for capability \"{capability}\" asked for its own " +
                    "vanilla, which cannot terminate.");
            }

            try
            {
                var instance = descriptor.Vanilla(ctx);
                _vanillaInstances[capability] = instance;
                return instance;
            }
            finally
            {
                _vanillaInFlight.Remove(capability);
            }
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
        /// decided during the selection phase of <see cref="Resolve"/>,
        /// before any factory has run. Empty <see cref="Providers"/> means
        /// "no provider survived selection"; activation then falls back to
        /// the capability's vanilla factory (if any) or resolves to zero
        /// active instances.
        /// </summary>
        private sealed class CapabilitySelection
        {
            public CapabilityDescriptor Descriptor { get; }
            public List<ProviderRegistration> Providers { get; }

            /// <summary>
            /// Selection failed for this capability, so activation must leave it
            /// with no instance rather than treat the empty provider list as "fall
            /// back to vanilla".
            /// </summary>
            public bool IsUnresolved { get; }

            public CapabilitySelection(CapabilityDescriptor descriptor, List<ProviderRegistration> providers)
                : this(descriptor, providers, false)
            {
            }

            private CapabilitySelection(CapabilityDescriptor descriptor, List<ProviderRegistration> providers, bool isUnresolved)
            {
                Descriptor = descriptor;
                Providers = providers;
                IsUnresolved = isUnresolved;
            }

            public static CapabilitySelection Unresolved(CapabilityDescriptor descriptor) =>
                new CapabilitySelection(descriptor, new List<ProviderRegistration>(), true);
        }
    }
}
