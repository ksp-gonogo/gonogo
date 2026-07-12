using System;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The comms backend election (comms-uplink-design.md §2), expressed
    /// entirely in terms of the existing <see cref="Kernel"/> — no new
    /// contract mechanism (§2.3, §5). One EXCLUSIVE capability <c>"comms"</c>
    /// whose active instance is an <see cref="ICommsBackend"/>:
    ///
    /// <list type="bullet">
    /// <item><b>CommNet is the capability's <c>Vanilla</c> factory</b> — the
    /// structural "comms is never unsatisfiable" guarantee (§2.2 recommends
    /// exactly this). It activates whenever no higher provider is registered.</item>
    /// <item><b>RealAntennas registers as a provider</b> — but ONLY when the RA
    /// assembly is actually loaded (the reflection probe, §4.2). Registering the
    /// provider IS the gate: an exclusive capability with one registered
    /// provider selects that provider (Kernel.SelectExclusive: candidates.Count
    /// == 1 ⇒ that provider); with zero registered providers it falls back to
    /// Vanilla. So RA present ⇒ RA wins; RA absent ⇒ CommNet vanilla — no
    /// version-string gymnastics needed.</item>
    /// </list>
    ///
    /// <para>Shared <c>comms.*</c> channels are declared and sourced ONCE by
    /// the core comms registration, which resolves the elected backend via
    /// <c>Kernel.Query&lt;ICommsBackend&gt;("comms")</c> at map time — neither
    /// CommNet nor RA declares those channels itself (§2.2, the
    /// shared-namespace-multi-provider rule §5). RA-only channels
    /// (linkQuality/dataRate/linkMargin) are declared in the RA uplink's own
    /// manifest and bypass the election entirely.</para>
    /// </summary>
    public static class CommsElection
    {
        /// <summary>The exclusive capability id both backends compete for.</summary>
        public const string CapabilityId = "comms";

        /// <summary>Provider id RealAntennas registers under.</summary>
        public const string RealAntennasProviderId = "realantennas";

        /// <summary>Default priority for the RA provider (any positive value beats the vanilla fallback structurally; priority only matters if a second provider ever appears).</summary>
        public const double RealAntennasPriority = 100.0;

        /// <summary>
        /// Registers the exclusive <c>"comms"</c> capability with CommNet as
        /// its always-present <see cref="CapabilityDescriptor.Vanilla"/>
        /// factory. Idempotent-safe to call once at bootstrap (before
        /// <see cref="Kernel.Resolve"/>). Not <see cref="CapabilityDescriptor.SpineCritical"/>:
        /// a comms-less install (no vanilla would be pathological, but defence
        /// in depth) must not halt the whole spine.
        /// </summary>
        public static void RegisterCapability(
            Kernel kernel,
            Func<ProviderContext, ICommsBackend> commNetVanillaFactory)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (commNetVanillaFactory == null) throw new ArgumentNullException(nameof(commNetVanillaFactory));

            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = ctx => commNetVanillaFactory(ctx),
            });
        }

        /// <summary>
        /// Registers RealAntennas as a higher-priority <c>"comms"</c> provider.
        /// Call this ONLY when the RA reflection probe confirmed RA is loaded
        /// (§4.2) — registering it is itself the election gate. Must be called
        /// after <see cref="RegisterCapability"/> and before
        /// <see cref="Kernel.Resolve"/>.
        /// </summary>
        public static void RegisterRealAntennasProvider(
            Kernel kernel,
            Func<ProviderContext, ICommsBackend> realAntennasFactory,
            double priority = RealAntennasPriority)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (realAntennasFactory == null) throw new ArgumentNullException(nameof(realAntennasFactory));

            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = CapabilityId,
                Id = RealAntennasProviderId,
                Priority = priority,
                Factory = ctx => realAntennasFactory(ctx),
            });
        }

        /// <summary>
        /// Resolve the elected backend after resolution has run. Returns null
        /// if the capability was never registered or resolved to no instance
        /// (defensive — a correctly bootstrapped engine always has at least the
        /// vanilla CommNet backend).
        /// </summary>
        public static ICommsBackend? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<ICommsBackend>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
