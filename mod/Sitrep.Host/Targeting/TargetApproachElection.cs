using System;
using Sitrep.Contract;

namespace Sitrep.Host.Targeting
{
    /// <summary>
    /// The closest-approach backend election: a deliberate, line-for-line
    /// mirror of <see cref="Sitrep.Host.ActionGroups.ActionGroupsElection"/>
    /// (itself a mirror of <see cref="Sitrep.Host.Comms.CommsElection"/>),
    /// expressed entirely in terms of the existing <see cref="Kernel"/> with no
    /// new mechanism:
    ///
    /// <list type="bullet">
    /// <item><b>The stock Kepler backend is the capability's <c>Vanilla</c>
    /// factory</b>: always present, so closest approach is never
    /// unsatisfiable on a stock install.</item>
    /// <item><b>An n-body uplink registers a provider</b>, but ONLY
    /// when the mod supplying it is actually loaded (the same reflection-probe
    /// gate the reflection-isolated comms provider uplink uses). Registering the
    /// provider IS the gate: an exclusive capability with one registered
    /// provider selects it; with zero it falls back to Vanilla. Such a provider
    /// present ⇒ it wins; absent ⇒ stock Kepler.</item>
    /// </list>
    ///
    /// <para>The <c>vessel.target</c> channel is declared and sourced ONCE by
    /// the vessel uplink, which resolves the elected solver at capture time via
    /// <c>Kernel.Query&lt;ITargetApproachSolver&gt;("targetApproach")</c>. A
    /// Such an uplink would declare NO channel of its own and ship NO client
    /// code, exactly as the elected comms provider uplink ships none for
    /// <c>comms.*</c>.</para>
    ///
    /// <para>The capability id itself is NOT here. It is
    /// <see cref="TargetApproachCapability.CapabilityId"/>, in the contract,
    /// because a backend author has to name it to register and this assembly is
    /// not something they can reference.</para>
    /// </summary>
    public static class TargetApproachElection
    {
        /// <summary>
        /// Registers the exclusive <c>"targetApproach"</c> capability with the
        /// stock Kepler backend as its always-present
        /// <see cref="CapabilityDescriptor.Vanilla"/> factory. Called from the
        /// vessel uplink's <c>DeclareCapabilities</c> (the pre-Register
        /// discovery pass), so the capability exists before ANY uplink's
        /// <c>Register</c> runs, a later uplink's provider
        /// registration can then never race ahead of this declaration
        /// regardless of assembly-scan order.
        ///
        /// <para>Not <see cref="CapabilityDescriptor.SpineCritical"/>: a
        /// closest-approach-less install must not halt the spine, the rest of
        /// <c>vessel.target</c> (name/distance/orbit/...) is still good
        /// telemetry without it.</para>
        /// </summary>
        public static void RegisterCapability(
            Kernel kernel,
            Func<ProviderContext, ITargetApproachSolver> stockVanillaFactory)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (stockVanillaFactory == null) throw new ArgumentNullException(nameof(stockVanillaFactory));

            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = TargetApproachCapability.CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = ctx => stockVanillaFactory(ctx),
            });
        }

        // A provider registers itself through the kernel's generic
        // RegisterProvider, naming its own id and priority. Core deliberately
        // offers no per-mod registrar: a named one puts a specific third-party
        // mod in core's API surface, and every caller that used the two removed
        // here was a test.

        /// <summary>
        /// Resolve the elected solver after resolution has run. Returns null if
        /// the capability was never registered or resolved to no instance
        /// (defensive: a correctly bootstrapped engine always has at least the
        /// stock Kepler backend).
        /// </summary>
        public static ITargetApproachSolver? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<ITargetApproachSolver>(TargetApproachCapability.CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
