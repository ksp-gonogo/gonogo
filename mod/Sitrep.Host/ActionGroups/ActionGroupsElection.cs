using System;
using Sitrep.Contract;

namespace Sitrep.Host.ActionGroups
{
    /// <summary>
    /// The action-groups backend election — a deliberate, line-for-line mirror
    /// of <see cref="Sitrep.Host.Comms.CommsElection"/>, expressed entirely in
    /// terms of the existing <see cref="Kernel"/> with no new mechanism:
    ///
    /// <list type="bullet">
    /// <item><b>The stock backend is the capability's <c>Vanilla</c>
    /// factory</b> — the structural "action groups are never unsatisfiable"
    /// guarantee. It activates whenever no higher provider is registered,
    /// which is every stock install.</item>
    /// <item><b>A future AGX uplink registers a provider</b> — but ONLY when
    /// the AGX assembly is actually loaded (the same reflection-probe gate
    /// <c>GonogoRealAntennasUplink</c> uses). Registering the provider IS the
    /// gate: an exclusive capability with one registered provider selects it;
    /// with zero it falls back to Vanilla. So AGX present ⇒ AGX wins; AGX
    /// absent ⇒ stock — no version-string gymnastics.</item>
    /// </list>
    ///
    /// <para>The <c>vessel.control</c> channel is declared and sourced ONCE by
    /// the vessel uplink, which resolves the elected backend at capture time
    /// via <c>Kernel.Query&lt;IActionGroupsBackend&gt;("actionGroups")</c> —
    /// the shared-namespace-single-declaration rule. An AGX uplink would
    /// declare NO channel of its own for this and ship NO client code, exactly
    /// as the RealAntennas uplink ships none for <c>comms.*</c>.</para>
    /// </summary>
    public static class ActionGroupsElection
    {
        /// <summary>The exclusive capability id every action-groups backend competes for.</summary>
        public const string CapabilityId = "actionGroups";

        /// <summary>Provider id a future Action Groups Extended backend registers under.</summary>
        public const string ActionGroupsExtendedProviderId = "actionGroupsExtended";

        /// <summary>Default priority for the AGX provider (any positive value beats the vanilla fallback structurally; priority only matters if a second provider ever appears).</summary>
        public const double ActionGroupsExtendedPriority = 100.0;

        /// <summary>
        /// Registers the exclusive <c>"actionGroups"</c> capability with the
        /// stock backend as its always-present
        /// <see cref="CapabilityDescriptor.Vanilla"/> factory. Called from the
        /// vessel uplink's <c>DeclareCapabilities</c> (the pre-Register
        /// discovery pass), so the capability exists before ANY uplink's
        /// <c>Register</c> runs — a future AGX uplink's provider registration
        /// can then never race ahead of this declaration regardless of
        /// assembly-scan order. Same two-pass fix as comms.
        ///
        /// <para>Not <see cref="CapabilityDescriptor.SpineCritical"/>: an
        /// action-group-less install must not halt the whole spine — the rest
        /// of <c>vessel.control</c> (SAS/RCS/throttle/...) is still perfectly
        /// good telemetry without it.</para>
        /// </summary>
        public static void RegisterCapability(
            Kernel kernel,
            Func<ProviderContext, IActionGroupsBackend> stockVanillaFactory)
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
        /// Registers Action Groups Extended as a higher-priority provider. Call
        /// this ONLY when an AGX reflection probe confirms AGX is loaded —
        /// registering it is itself the election gate. Must be called after
        /// <see cref="RegisterCapability"/> and before <see cref="Kernel.Resolve"/>.
        ///
        /// <para>Nothing calls this yet — the AGX backend is a later phase.
        /// It exists now so that phase is a pure ADD (one uplink assembly, one
        /// probe, one factory) with no change to this file, the contract, the
        /// channel, or any client code.</para>
        /// </summary>
        public static void RegisterActionGroupsExtendedProvider(
            Kernel kernel,
            Func<ProviderContext, IActionGroupsBackend> agxFactory,
            double priority = ActionGroupsExtendedPriority)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (agxFactory == null) throw new ArgumentNullException(nameof(agxFactory));

            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = CapabilityId,
                Id = ActionGroupsExtendedProviderId,
                Priority = priority,
                Factory = ctx => agxFactory(ctx),
            });
        }

        /// <summary>
        /// Resolve the elected backend after resolution has run. Returns null
        /// if the capability was never registered or resolved to no instance
        /// (defensive — a correctly bootstrapped engine always has at least the
        /// stock backend).
        /// </summary>
        public static IActionGroupsBackend? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<IActionGroupsBackend>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
