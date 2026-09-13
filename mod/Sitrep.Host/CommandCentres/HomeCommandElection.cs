using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// The home-command election, the same shape as
    /// <see cref="Comms.CommsElection"/>. ONE EXCLUSIVE capability
    /// <c>"homeCommand"</c> whose active instance is an
    /// <see cref="IHomeCommandProvider"/>: the logic that decides which command
    /// centre holds the career ledger.
    ///
    /// <list type="bullet">
    /// <item><b><see cref="StockHomeCommandProvider"/> is the capability's
    /// Vanilla</b>: the sole <c>isKSC</c> home, or not identified. Every install
    /// has it.</item>
    /// <item><b>A mod with its own idea of home registers as a provider</b> from
    /// its own uplink's Register, only when its presence probe confirms the mod is
    /// loaded. Any registered provider beats the vanilla; how two of them must
    /// register against each other is set out on
    /// <see cref="HomeCommandCapability"/>.</item>
    /// </list>
    ///
    /// <para>The elected claimant is asked on the main thread, in
    /// <c>ChannelEngine</c>'s command-centre capture, and its answer is read from
    /// the snapshot that capture publishes.</para>
    /// </summary>
    public static class HomeCommandElection
    {
        /// <summary>The exclusive capability id, aliased from the contract's own declaration.</summary>
        public const string CapabilityId = HomeCommandCapability.Id;

        /// <summary>
        /// Registers the exclusive <c>"homeCommand"</c> capability with
        /// <see cref="StockHomeCommandProvider"/> as its always-present Vanilla.
        /// Called once at bootstrap, before <see cref="Kernel.Resolve"/>, from a
        /// core uplink's capability-declaration pass. Not SpineCritical: a spine
        /// that cannot say who is home still streams telemetry.
        /// </summary>
        /// <param name="stockHomes">
        /// Reads every CommNet home in the scene. Passed in so this assembly stays
        /// KSP-free and a test can elect the stock claimant over fixed homes.
        /// </param>
        public static void RegisterCapability(Kernel kernel, Func<IReadOnlyList<HomeNodeFacts>> stockHomes)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (stockHomes == null) throw new ArgumentNullException(nameof(stockHomes));

            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = _ => new StockHomeCommandProvider(stockHomes),
            });
        }

        /// <summary>
        /// Resolve the elected claimant after resolution has run. Null when the
        /// capability was never registered or resolved, which a correctly
        /// bootstrapped engine never is: it always has at least the stock claimant.
        /// </summary>
        public static IHomeCommandProvider? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<IHomeCommandProvider>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
