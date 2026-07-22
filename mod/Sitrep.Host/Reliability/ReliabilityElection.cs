using System;
using Sitrep.Contract;

namespace Sitrep.Host.Reliability
{
    /// <summary>
    /// The reliability-backend election, expressed entirely in terms of the
    /// existing <see cref="Kernel"/> — the exact same shape as CommsElection
    /// (mod/Sitrep.Host/Comms/CommsElection.cs). ONE EXCLUSIVE capability
    /// <c>"reliability"</c> whose active instance is an <see cref="IReliabilityBackend"/>:
    ///
    /// <list type="bullet">
    /// <item><b><see cref="NoneReliabilityBackend"/> is the capability's Vanilla
    /// factory</b> — the structural "reliability is never unsatisfiable"
    /// guarantee. It activates (reporting Unmodeled) whenever no modelling mod
    /// registered a provider.</item>
    /// <item><b>Kerbalism / TestFlight register as providers</b> from their own
    /// uplinks' Register (host.Kernel.RegisterProvider), ONLY when their
    /// reflection probe confirms the mod is loaded — registering IS the gate.
    /// Kerbalism registers Priority 1 (reports Unmodeled when Features.Reliability
    /// off); TestFlight registers Priority 10 (engine-authoritative). Both present
    /// ⇒ TestFlight wins by priority; TestFlight only ⇒ TestFlight; Kerbalism only
    /// ⇒ Kerbalism; neither ⇒ NoneReliabilityBackend vanilla.</item>
    /// </list>
    ///
    /// <para>The two <c>reliability.*</c> channels are declared and sourced ONCE by
    /// <c>Gonogo.KSP.ReliabilityCoreUplink</c>, which resolves the elected backend
    /// via <c>Kernel.Query&lt;IReliabilityBackend&gt;("reliability")</c> at capture
    /// time — no provider declares those channels itself (the same
    /// shared-namespace-single-declaration rule comms follows).</para>
    /// </summary>
    public static class ReliabilityElection
    {
        /// <summary>The exclusive capability id every reliability backend competes for.</summary>
        public const string CapabilityId = "reliability";

        /// <summary>
        /// Registers the exclusive <c>"reliability"</c> capability with
        /// <see cref="NoneReliabilityBackend"/> as its always-present Vanilla
        /// factory. Called once at bootstrap (before <see cref="Kernel.Resolve"/>),
        /// from ReliabilityCoreUplink.DeclareCapabilities. Not SpineCritical.
        /// </summary>
        public static void RegisterCapability(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = _ => new NoneReliabilityBackend(),
            });
        }

        /// <summary>
        /// Resolve the elected backend after resolution has run. Returns null if
        /// the capability was never registered/resolved (defensive — a correctly
        /// bootstrapped engine always has at least the None vanilla backend).
        /// </summary>
        public static IReliabilityBackend? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<IReliabilityBackend>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
