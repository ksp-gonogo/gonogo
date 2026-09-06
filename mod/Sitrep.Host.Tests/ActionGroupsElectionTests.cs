using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.ActionGroups;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The action-groups election driven through the REAL <see cref="ChannelEngine"/>
    /// and its two-pass uplink discovery, the twin of
    /// <see cref="CommsElectionTests"/> for the capability comms' shape was copied
    /// into.
    ///
    /// <para>These cases used to live in the Tests project of the Uplink that
    /// provides this capability, which is how that project came to reference
    /// <c>Sitrep.Host</c> and, behind it, three more unpublished assemblies. The
    /// engine, the discovery pass and the capability declaration are all core's, and
    /// they were being asserted from the one place that may not name them. Nothing
    /// about them belonged to the provider either: the "provider uplink" in those
    /// tests was already a hand-written double of the same shape rather than the real
    /// one, so moving them here loses no coverage and the Uplink's own suite keeps
    /// the half that is genuinely about the Uplink.</para>
    /// </summary>
    public class ActionGroupsElectionTests
    {
        private const string ProviderId = "provider-under-test";
        private const double ProviderPriority = 100.0;

        private sealed class FakeBackend : IActionGroupsBackend
        {
            public FakeBackend(string id) => ProviderId = id;
            public string ProviderId { get; }
            public IList<ActionGroupState>? Groups() => new List<ActionGroupState>();
            public bool SetGroup(int index, bool state) => true;
        }

        /// <summary>
        /// An uplink that OWNS the capability, declaring it in the capability pass
        /// (<see cref="IUplinkCapabilityDeclarer"/>): the shape <c>VesselUplink</c> uses.
        /// </summary>
        private sealed class CapabilityOwningUplink : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "vessel", Version = "1.0.0" };
            public void DeclareCapabilities(Kernel kernel) =>
                ActionGroupsElection.RegisterCapability(kernel, _ => new FakeBackend("stock"));
            public void Register(IUplinkHost host) { }
        }

        /// <summary>
        /// A provider-only uplink taking the same Register-time gate a mod-specific
        /// backend takes: probe, then register a provider only when the mod is there.
        /// </summary>
        private sealed class ProviderOnlyUplink : ISitrepUplink
        {
            private readonly bool _modPresent;

            public ProviderOnlyUplink(bool modPresent) => _modPresent = modPresent;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } =
                new UplinkManifest { Id = "actionGroupsProvider", Version = "1.0.0" };

            public void Register(IUplinkHost host)
            {
                if (!_modPresent)
                {
                    host.SetAvailability(Availability.Unavailable("backing mod not loaded"));
                    return;
                }
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = ActionGroupsCapability.Id,
                    Id = ProviderId,
                    Priority = ProviderPriority,
                    Factory = _ => new FakeBackend(ProviderId),
                });
            }
        }

        private static ChannelEngine EngineWith(params ISitrepUplink[] inDiscoveryOrder)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var discovered = new List<UplinkDiscovery.DiscoveredUplink>();
            foreach (var uplink in inDiscoveryOrder)
            {
                discovered.Add(new UplinkDiscovery.DiscoveredUplink(
                    uplink, ContractVersion.Major, ContractVersion.Minor));
            }
            engine.RegisterDiscoveredUplinks(discovered);
            engine.Start();
            engine.ResolveCapabilities();
            return engine;
        }

        /// <summary>
        /// The adversarial ordering the two-pass registration exists for: the
        /// provider uplink is discovered BEFORE the capability owner.
        /// <c>RegisterDiscoveredUplinks</c> declares every capability first, so the
        /// provider still wins whatever order the assembly scan hands them over in.
        ///
        /// <para>Get this wrong and the provider's <c>RegisterProvider</c> throws
        /// against a capability that does not exist yet, the uplink goes inert, and
        /// stock keeps answering: which looks exactly like a correct install to
        /// everyone except the player who has the mod.</para>
        /// </summary>
        [Fact]
        public void ProviderDiscoveredBeforeCapability_ProviderStillWins()
        {
            using var engine = EngineWith(
                new ProviderOnlyUplink(modPresent: true),
                new CapabilityOwningUplink());

            Assert.True(engine.AvailabilityOf("actionGroupsProvider").IsAvailable);

            var elected = ActionGroupsElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.Equal(ProviderId, elected!.ProviderId);
        }

        /// <summary>
        /// The inert path from the engine's side: a provider uplink whose probe says
        /// the mod is absent registers nothing and declares itself unavailable, and
        /// the capability falls back to its vanilla rather than to a hole.
        /// </summary>
        [Fact]
        public void ProbeUnavailable_ProviderGoesInert_VanillaStillWins()
        {
            using var engine = EngineWith(
                new CapabilityOwningUplink(),
                new ProviderOnlyUplink(modPresent: false));

            Assert.False(engine.AvailabilityOf("actionGroupsProvider").IsAvailable);

            var elected = ActionGroupsElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.Equal("stock", elected!.ProviderId);
        }

        /// <summary>
        /// The capability is not <see cref="CapabilityDescriptor.SpineCritical"/>: an
        /// install where nothing declared it resolves to null rather than throwing,
        /// and the rest of <c>vessel.control</c> is still perfectly good telemetry.
        /// </summary>
        [Fact]
        public void UnregisteredCapabilityResolvesToNullRatherThanThrowing()
        {
            var kernel = new Kernel();
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            Assert.Null(ActionGroupsElection.Elected(kernel));
        }
    }
}
