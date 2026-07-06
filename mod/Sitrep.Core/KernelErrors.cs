using System;
using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// C# port of the error classes in <c>mod/sitrep-kernel/src/errors.ts</c>.
    /// Kept in one file, mirroring the TS side, so later kernel work can add
    /// its own alongside these three.
    /// </summary>

    /// <summary>
    /// Thrown by <see cref="Kernel.Resolve"/> when an EXCLUSIVE capability has
    /// two or more equally-ranked provider candidates and there is no user
    /// preference or unique <c>IsDefault</c>/highest-priority provider to
    /// break the tie.
    ///
    /// This is a fail-loud condition: the kernel refuses to silently pick a
    /// winner (e.g. by registration order) when the tie is genuinely
    /// ambiguous, since that non-determinism is exactly what the
    /// exclusive-provider model exists to prevent.
    /// </summary>
    public sealed class AmbiguousResolutionError : Exception
    {
        public string Capability { get; }
        public IReadOnlyList<string> ProviderIds { get; }

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
    /// The spine cannot boot without this capability, so the kernel refuses
    /// to silently continue with the capability absent — unlike a
    /// non-spine-critical capability in the same situation, which simply
    /// resolves to zero active instances.
    /// </summary>
    public sealed class SpineCapabilityUnsatisfiedError : Exception
    {
        public string Capability { get; }

        public SpineCapabilityUnsatisfiedError(string capability)
            : base(
                $"Spine-critical capability \"{capability}\" has no compatible provider " +
                "and no vanilla fallback; the kernel cannot start.")
        {
            Capability = capability;
        }
    }

    /// <summary>
    /// Thrown by <see cref="Kernel.Resolve"/> (via the dependency broker's
    /// topo-sort, <see cref="Broker.TopoSortActivationOrder"/>) when two or
    /// more capabilities' *selected* providers depend on each other, directly
    /// or transitively, so there is no valid dependency-first activation
    /// order.
    ///
    /// <see cref="Cycle"/> lists the capability ids that form the cycle, in
    /// dependency order (each depends on the next, and the last depends back
    /// on the first) — it is a diagnostic aid, not necessarily every
    /// capability affected by the cycle (a capability outside the cycle that
    /// merely depends on a cyclic one is not included).
    /// </summary>
    public sealed class DependencyCycleError : Exception
    {
        public IReadOnlyList<string> Cycle { get; }

        public DependencyCycleError(IReadOnlyList<string> cycle)
            : base(
                $"Dependency cycle detected among capabilities: {string.Join(" -> ", cycle)}. " +
                "The kernel cannot determine a dependency-first activation order.")
        {
            Cycle = cycle;
        }
    }
}
