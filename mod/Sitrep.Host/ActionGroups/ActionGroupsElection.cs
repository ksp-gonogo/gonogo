using System;
using Sitrep.Contract;

namespace Sitrep.Host.ActionGroups
{
    /// <summary>
    /// The action-groups backend election: a deliberate, line-for-line mirror
    /// of <see cref="Sitrep.Host.Comms.CommsElection"/>, expressed entirely in
    /// terms of the existing <see cref="Kernel"/> with no new mechanism:
    ///
    /// <list type="bullet">
    /// <item><b>The stock backend is the capability's <c>Vanilla</c>
    /// factory</b>: the structural "action groups are never unsatisfiable"
    /// guarantee. It activates whenever no higher provider is registered,
    /// which is every stock install.</item>
    /// <item><b>A future AGX uplink registers a provider</b>, but ONLY when
    /// the AGX assembly is actually loaded (the same reflection-probe gate
    /// <c>GonogoRealAntennasUplink</c> uses). Registering the provider IS the
    /// gate: an exclusive capability with one registered provider selects it;
    /// with zero it falls back to Vanilla. So AGX present ⇒ AGX wins; AGX
    /// absent ⇒ stock: no version-string gymnastics.</item>
    /// </list>
    ///
    /// <para>The <c>vessel.control</c> channel is declared and sourced ONCE by
    /// the vessel uplink, which resolves the elected backend at capture time
    /// via <c>Kernel.Query&lt;IActionGroupsBackend&gt;("actionGroups")</c>:
    /// the shared-namespace-single-declaration rule. An AGX uplink would
    /// declare NO channel of its own for this and ship NO client code, exactly
    /// as the RealAntennas uplink ships none for <c>comms.*</c>.</para>
    /// </summary>
    public static class ActionGroupsElection
    {
        /// <summary>
        /// The exclusive capability id every action-groups backend competes for,
        /// which is <see cref="ActionGroupsCapability.Id"/> and not a second
        /// spelling of it. It is declared in the contract because a provider has
        /// to name it too, and a provider cannot reference this assembly.
        /// </summary>
        public const string CapabilityId = ActionGroupsCapability.Id;



        /// <summary>
        /// Registers the exclusive <c>"actionGroups"</c> capability with the
        /// stock backend as its always-present
        /// <see cref="CapabilityDescriptor.Vanilla"/> factory. Called from the
        /// vessel uplink's <c>DeclareCapabilities</c> (the pre-Register
        /// discovery pass), so the capability exists before ANY uplink's
        /// <c>Register</c> runs, a future AGX uplink's provider registration
        /// can then never race ahead of this declaration regardless of
        /// assembly-scan order. Same two-pass fix as comms.
        ///
        /// <para>Not <see cref="CapabilityDescriptor.SpineCritical"/>: an
        /// action-group-less install must not halt the whole spine, the rest
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

        // A provider registers itself through the kernel's generic
        // RegisterProvider, naming its own id and priority. Core deliberately
        // offers no per-mod registrar: a named one puts a specific third-party
        // mod in core's API surface, and every caller that used the two removed
        // here was a test.

        /// <summary>
        /// Resolve the elected backend after resolution has run. Returns null
        /// if the capability was never registered or resolved to no instance
        /// (defensive: a correctly bootstrapped engine always has at least the
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
