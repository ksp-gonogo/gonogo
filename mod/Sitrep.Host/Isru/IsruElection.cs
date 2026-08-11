using System;
using Sitrep.Contract;

namespace Sitrep.Host.Isru
{
    /// <summary>
    /// The ISRU-backend election, expressed entirely in terms of the existing
    /// <see cref="Kernel"/>: the same shape as
    /// <see cref="Reliability.ReliabilityElection"/> and
    /// <see cref="Science.ScienceElection"/>. ONE EXCLUSIVE capability
    /// <c>"isru"</c> whose active instance is an <see cref="IIsruBackend"/>:
    ///
    /// <list type="bullet">
    /// <item><b>The stock backend is the capability's Vanilla factory</b>: stock
    /// KSP genuinely models ISRU, so this is a real reader rather than the
    /// no-op fallback reliability needs. It activates whenever no modelling mod
    /// registered a provider, which is every stock install.</item>
    /// <item><b>A modelling mod registers as a provider</b> from its own uplink's
    /// Register (host.Kernel.RegisterProvider), ONLY when its reflection probe
    /// confirms the mod is loaded: registering IS the gate. A provider registers
    /// above vanilla, so it wins when installed; absent, stock wins.</item>
    /// </list>
    ///
    /// <para>The vanilla factory is passed IN rather than constructed here,
    /// exactly as <see cref="ActionGroups.ActionGroupsElection"/> does, because
    /// reading <c>ModuleResourceHarvester</c>/<c>ModuleResourceConverter</c> needs
    /// KSP and this assembly stays KSP-free (a test can then elect a fake vanilla
    /// backend with no scene at all).</para>
    ///
    /// <para><b>Why elect at all, when a mod that replaces stock ISRU also deletes
    /// the stock modules?</b> Because that deletion would make the stock reader
    /// report an empty vessel, which is indistinguishable from a vessel with no
    /// drills. The election makes the resolution explicit and Kernel-driven, gives
    /// a third modelling mod a real priority-ordered path in, covers a partial
    /// install where some parts keep stock modules, and is the one seam a client
    /// can query (<c>resolutionNotices</c>) to learn which backend actually
    /// answered.</para>
    ///
    /// <para>The two <c>isru.*</c> channels are declared and sourced ONCE by
    /// <c>Gonogo.KSP.IsruCoreUplink</c>, which resolves the elected backend via
    /// <c>Kernel.Query&lt;IIsruBackend&gt;("isru")</c> at capture time: no provider
    /// declares those channels itself (the same
    /// shared-namespace-single-declaration rule comms follows).</para>
    /// </summary>
    public static class IsruElection
    {
        /// <summary>The exclusive capability id every ISRU backend competes for.</summary>
        public const string CapabilityId = "isru";

        /// <summary>
        /// Registers the exclusive <c>"isru"</c> capability with the stock backend
        /// as its always-present <see cref="CapabilityDescriptor.Vanilla"/>
        /// factory. Called once at bootstrap (before <see cref="Kernel.Resolve"/>),
        /// from IsruCoreUplink.DeclareCapabilities. Not SpineCritical: a vessel
        /// with no resource ops still flies.
        /// </summary>
        /// <param name="stockVanillaFactory">
        /// Builds the stock reader. Passed in rather than constructed here so this
        /// assembly stays KSP-free.
        /// </param>
        public static void RegisterCapability(
            Kernel kernel,
            Func<ProviderContext, IIsruBackend> stockVanillaFactory)
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
        /// Resolve the elected backend after resolution has run. Returns null if
        /// the capability was never registered/resolved (defensive, a correctly
        /// bootstrapped engine always has at least the stock vanilla backend).
        /// </summary>
        public static IIsruBackend? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<IIsruBackend>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
