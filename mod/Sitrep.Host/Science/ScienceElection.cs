using System;
using Sitrep.Contract;

namespace Sitrep.Host.Science
{
    /// <summary>
    /// The science-backend election, expressed entirely in terms of the existing
    /// <see cref="Kernel"/>: the same shape as
    /// <see cref="Reliability.ReliabilityElection"/> and CommsElection
    /// (mod/Sitrep.Host/Comms/CommsElection.cs). ONE EXCLUSIVE capability
    /// <c>"science"</c> whose active instance is an <see cref="IScienceBackend"/>:
    ///
    /// <list type="bullet">
    /// <item><b><see cref="StockScienceBackend"/> is the capability's Vanilla
    /// factory</b>: stock KSP science, the structural "science is never
    /// unsatisfiable" guarantee. It activates whenever no science-modelling mod
    /// registered a provider, which is every stock install.</item>
    /// <item><b>A modelling mod registers as a provider</b> from its own uplink's
    /// Register (host.Kernel.RegisterProvider), ONLY when its reflection probe
    /// confirms the mod is loaded: registering IS the gate. Kerbalism registers
    /// above vanilla, so it wins when installed; absent, stock wins and the wire
    /// is exactly what it was before the election existed.</item>
    /// </list>
    ///
    /// <para>The five <c>science.*</c> channels and two
    /// <c>science.experiment.*</c> commands are declared and sourced ONCE by
    /// <c>Gonogo.KSP.ScienceCoreUplink</c>, which resolves the elected backend via
    /// <c>Kernel.Query&lt;IScienceBackend&gt;("science")</c> at map/dispatch time:
    /// no provider declares those channels itself (the same
    /// shared-namespace-single-declaration rule comms follows).</para>
    ///
    /// <para><c>deployed.bases</c> is deliberately NOT part of this capability:
    /// Breaking Ground deployed science lives on the <c>deployed.*</c> prefix
    /// owned by the DLC-gated <c>Gonogo.KSP.BreakingGroundUplink</c> alongside
    /// <c>robotics.*</c>, and it has no equivalent in any science-modelling mod
    /// surveyed (a provider would leave it null). Electing it would drag the
    /// Serenity presence gate into the science election for nothing.</para>
    /// </summary>
    public static class ScienceElection
    {
        /// <summary>The exclusive capability id every science backend competes for.</summary>
        public const string CapabilityId = "science";

        /// <summary>
        /// Registers the exclusive <c>"science"</c> capability with
        /// <see cref="StockScienceBackend"/> as its always-present Vanilla
        /// factory. Called once at bootstrap (before <see cref="Kernel.Resolve"/>),
        /// from ScienceCoreUplink.DeclareCapabilities. Not SpineCritical: a
        /// science-less spine still flies a rocket.
        /// </summary>
        /// <param name="actuator">
        /// The KSP-actuation seam the vanilla backend's two commands go through:
        /// passed in rather than constructed here so this assembly stays KSP-free
        /// and a test can elect a vanilla backend over a fake actuator.
        /// </param>
        public static void RegisterCapability(Kernel kernel, IScienceActuator actuator)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (actuator == null) throw new ArgumentNullException(nameof(actuator));
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = _ => new StockScienceBackend(actuator),
            });
        }

        /// <summary>
        /// Resolve the elected backend after resolution has run. Returns null if
        /// the capability was never registered/resolved (defensive, a correctly
        /// bootstrapped engine always has at least the stock vanilla backend).
        /// </summary>
        public static IScienceBackend? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<IScienceBackend>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
