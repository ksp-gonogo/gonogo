using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// Raised during <see cref="Kernel.Resolve"/>'s selection when an EXCLUSIVE
    /// capability has two or more equally-ranked provider candidates and there
    /// is no user preference or unique <c>IsDefault</c>/highest-priority
    /// provider to break the tie.
    ///
    /// <para>The kernel refuses to pick a winner by anything arbitrary, such as
    /// registration order. This does not escape <see cref="Kernel.Resolve"/>:
    /// the kernel turns it into one "ambiguous" notice per tied provider and
    /// leaves only that capability unresolved.</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class AmbiguousResolutionError : Exception
    {
        /// <summary>The id of the exclusive capability that could not be resolved.</summary>
        public string Capability { get; }

        /// <summary>The ids of the tied providers.</summary>
        public IReadOnlyList<string> ProviderIds { get; }

        /// <summary>An ambiguous resolution of <paramref name="capability"/> between <paramref name="providerIds"/>.</summary>
        /// <param name="capability">The capability id.</param>
        /// <param name="providerIds">The tied provider ids.</param>
        public AmbiguousResolutionError(string capability, IReadOnlyList<string> providerIds)
            : base(
                $"Ambiguous exclusive resolution for capability \"{capability}\": " +
                $"providers [{string.Join(", ", providerIds)}] are tied with no user " +
                "preference or unique default/highest-priority provider to break " +
                "the tie.")
        {
            Capability = capability;
            ProviderIds = providerIds;
        }
    }

    /// <summary>
    /// Thrown by <see cref="Kernel.Resolve"/> when a <c>SpineCritical</c>
    /// capability has no compatible provider (every registered provider was
    /// excluded by version gating, or none were registered at all) AND no
    /// <c>Vanilla</c> fallback.
    ///
    /// <para>Gonogo cannot start without a spine-critical capability, so the
    /// kernel stops rather than continue without it. A capability that is not
    /// spine-critical in the same situation simply resolves to zero active
    /// instances.</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class SpineCapabilityUnsatisfiedError : Exception
    {
        /// <summary>The id of the spine-critical capability with no provider.</summary>
        public string Capability { get; }

        /// <summary>No provider for <paramref name="capability"/>.</summary>
        /// <param name="capability">The capability id.</param>
        public SpineCapabilityUnsatisfiedError(string capability)
            : base(
                $"Spine-critical capability \"{capability}\" has no compatible provider " +
                "and no vanilla fallback; the kernel cannot start.")
        {
            Capability = capability;
        }
    }

    /// <summary>
    /// Thrown by <see cref="Kernel.Resolve"/> (from
    /// <see cref="Broker.TopoSortActivationOrder"/>) when two or more
    /// capabilities' selected providers depend on each other, directly or
    /// transitively, so there is no dependency-first activation order.
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class DependencyCycleError : Exception
    {
        /// <summary>
        /// The capability ids that form the cycle, in dependency order: each
        /// depends on the next, and the last depends back on the first. A
        /// capability outside the cycle that merely depends on one inside it is
        /// not listed.
        /// </summary>
        public IReadOnlyList<string> Cycle { get; }

        /// <summary>A dependency cycle through <paramref name="cycle"/>.</summary>
        /// <param name="cycle">The capability ids in the cycle, in dependency order.</param>
        public DependencyCycleError(IReadOnlyList<string> cycle)
            : base(
                $"Dependency cycle detected among capabilities: {string.Join(" -> ", cycle)}. " +
                "The kernel cannot determine a dependency-first activation order.")
        {
            Cycle = cycle;
        }
    }
}
