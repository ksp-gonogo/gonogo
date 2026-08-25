using System;
using Sitrep.Contract;

namespace Sitrep.Host.Economy
{
    /// <summary>
    /// The economy-backend election, the same shape as
    /// <see cref="Isru.IsruElection"/> and
    /// <see cref="Reliability.ReliabilityElection"/>. ONE EXCLUSIVE capability
    /// <c>"economy"</c> whose active instance is an <see cref="IEconomyBackend"/>.
    ///
    /// <list type="bullet">
    /// <item><b>The stock backend is the capability's Vanilla</b>, and it
    /// is a real reader rather than the no-op fallback reliability needs. Stock
    /// career genuinely has no reputation decay, no subsidy and no ongoing cost,
    /// and saying so is a truthful answer.</item>
    /// <item><b>A career-overhaul mod registers as a provider</b> from its own
    /// uplink's Register, ONLY when its presence probe confirms the mod is
    /// loaded: registering IS the gate.</item>
    /// </list>
    ///
    /// <para><b>Why elect rather than join client-side.</b> The obvious
    /// alternative is for a client to read reputation from one channel and the
    /// overhaul's own topic from another and put them together. That works for
    /// exactly one overhaul, and it makes every consumer learn a vendor's topic
    /// names. A per-day upkeep and a reputation-derived subsidy are not one mod's
    /// idea, they are career-overhaul-shaped ideas: electing means the NEXT mod
    /// that models an ongoing cost has a registered seam rather than a second
    /// parallel topic, and the client's readout does not care which one won.</para>
    ///
    /// <para>The fields are declared and sourced ONCE, by the uplink that already
    /// owns <c>career.status</c>, which resolves the elected backend via
    /// <c>Kernel.Query&lt;IEconomyBackend&gt;("economy")</c> at capture time. No
    /// provider declares a channel of its own; the same
    /// shared-namespace-single-declaration rule comms, ISRU and science
    /// follow.</para>
    /// </summary>
    public static class EconomyElection
    {
        /// <summary>The exclusive capability id every economy backend competes for.</summary>
        public const string CapabilityId = "economy";

        /// <summary>
        /// Registers the exclusive <c>"economy"</c> capability with
        /// <see cref="StockEconomyBackend"/> as its always-present
        /// <see cref="CapabilityDescriptor.Vanilla"/>. Called once at bootstrap,
        /// before <see cref="Kernel.Resolve"/>, from the career uplink's
        /// capability-declaration pass. Not SpineCritical: a career whose money
        /// nobody interprets still flies.
        /// </summary>
        /// <remarks>
        /// Takes NO vanilla factory, which is the one place this election differs
        /// in shape from the ISRU and action-group ones beside it. Those take
        /// theirs as a parameter because reading a stock harvester or a stock
        /// action group needs KSP and this assembly has none. Stock's answer about
        /// money needs nothing at all: it has no decay, no subsidy and no ongoing
        /// cost, so the vanilla backend is a handful of zeros and belongs here,
        /// where it is also headlessly testable.
        /// </remarks>
        public static void RegisterCapability(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));

            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = _ => new StockEconomyBackend(),
            });
        }

        /// <summary>
        /// Resolve the elected backend after resolution has run. Null when the
        /// capability was never registered or resolved, which a correctly
        /// bootstrapped engine never is: it always has at least the stock backend.
        /// </summary>
        public static IEconomyBackend? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<IEconomyBackend>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
