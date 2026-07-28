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
    /// <item><b>A future Principia uplink registers a provider</b>, but ONLY
    /// when the Principia assembly is actually loaded (the same reflection-probe
    /// gate the reflection-isolated comms provider uplink uses). Registering the
    /// provider IS the gate: an exclusive capability with one registered
    /// provider selects it; with zero it falls back to Vanilla. Principia
    /// present ⇒ Principia wins; Principia absent ⇒ stock Kepler.</item>
    /// </list>
    ///
    /// <para>The <c>vessel.target</c> channel is declared and sourced ONCE by
    /// the vessel uplink, which resolves the elected solver at capture time via
    /// <c>Kernel.Query&lt;ITargetApproachSolver&gt;("targetApproach")</c>. A
    /// Principia uplink would declare NO channel of its own and ship NO client
    /// code, exactly as the elected comms provider uplink ships none for
    /// <c>comms.*</c>.</para>
    /// </summary>
    public static class TargetApproachElection
    {
        /// <summary>The exclusive capability id every closest-approach backend competes for.</summary>
        public const string CapabilityId = "targetApproach";

        /// <summary>Provider id a future Principia (n-body) backend registers under.</summary>
        public const string PrincipiaProviderId = "principia";

        /// <summary>Default priority for the Principia provider (any positive value beats the vanilla fallback structurally; priority only matters if a second provider ever appears).</summary>
        public const double PrincipiaPriority = 100.0;

        /// <summary>
        /// Registers the exclusive <c>"targetApproach"</c> capability with the
        /// stock Kepler backend as its always-present
        /// <see cref="CapabilityDescriptor.Vanilla"/> factory. Called from the
        /// vessel uplink's <c>DeclareCapabilities</c> (the pre-Register
        /// discovery pass), so the capability exists before ANY uplink's
        /// <c>Register</c> runs, a future Principia uplink's provider
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
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = ctx => stockVanillaFactory(ctx),
            });
        }

        /// <summary>
        /// Registers a Principia n-body backend as a higher-priority provider.
        /// Call this ONLY when a Principia reflection probe confirms Principia
        /// is loaded, registering it is itself the election gate. Must be
        /// called after <see cref="RegisterCapability"/> and before
        /// <see cref="Kernel.Resolve"/>.
        ///
        /// <para>Nothing calls this yet: the Principia backend is a later,
        /// out-of-scope phase (a separate reflection-isolated uplink assembly,
        /// like the reflection-isolated comms provider uplink). It exists now so that phase is
        /// a pure ADD (one uplink, one probe, one factory) with no change to
        /// this file, the contract, the channel, or any client code.</para>
        /// </summary>
        public static void RegisterPrincipiaProvider(
            Kernel kernel,
            Func<ProviderContext, ITargetApproachSolver> principiaFactory,
            double priority = PrincipiaPriority)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (principiaFactory == null) throw new ArgumentNullException(nameof(principiaFactory));

            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = CapabilityId,
                Id = PrincipiaProviderId,
                Priority = priority,
                Factory = ctx => principiaFactory(ctx),
            });
        }

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
                return kernel.Query<ITargetApproachSolver>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
