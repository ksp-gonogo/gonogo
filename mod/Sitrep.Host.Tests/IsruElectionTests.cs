using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Isru;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The ISRU-backend election, driven through the REAL <see cref="Kernel"/>:
    /// the same cases <see cref="ScienceElectionTests"/> covers, because ISRU is
    /// the same kind of capability. Provider absent ⇒ the stock reader; provider
    /// present ⇒ the provider wins; and the elected instance is genuinely
    /// queryable as an <see cref="IIsruBackend"/>.
    ///
    /// <para>The adversarial case is the one only a two-pass registration gets
    /// right: a provider uplink discovered BEFORE the capability owner. On a
    /// stock-only dev box that ordering never bites, and with a modelling mod
    /// installed it would silently hand the channels back to stock.</para>
    ///
    /// <para>The vanilla factory is a fake here rather than
    /// <c>Gonogo.KSP.StockIsruBackend</c>: that reader walks live PartModules, and
    /// this assembly has no KSP. Passing the factory IN is exactly what makes that
    /// possible.</para>
    /// </summary>
    public class IsruElectionTests
    {
        private const double ProviderPriority = 1.0;

        /// <summary>Stands in for the KSP-side stock reader, which this assembly cannot construct.</summary>
        private sealed class FakeBackend : IIsruBackend
        {
            public FakeBackend(string id) => ProviderId = id;
            public string ProviderId { get; }
            public IReadOnlyList<IsruDrillEntry> Drills() => new List<IsruDrillEntry>();
            public IReadOnlyList<IsruConverterEntry> Converters() => new List<IsruConverterEntry>();
        }

        private static Kernel ResolvedKernel(bool providerPresent)
        {
            var kernel = new Kernel();
            IsruElection.RegisterCapability(kernel, _ => new FakeBackend("stock"));
            if (providerPresent)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = IsruElection.CapabilityId,
                    Id = "fake-isru-mod",
                    Priority = ProviderPriority,
                    Factory = _ => new FakeBackend("fake-isru-mod"),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        // An uplink that OWNS the "isru" capability, declaring it in the two-pass
        // capability pass rather than in Register: the shape Gonogo.KSP.IsruCoreUplink uses.
        private sealed class CapabilityOwningUplink : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "isru", Version = "1.0.0" };
            public void DeclareCapabilities(Kernel kernel) =>
                IsruElection.RegisterCapability(kernel, _ => new FakeBackend("stock"));
            public void Register(IUplinkHost host) { }
        }

        // A provider-only uplink (the shape a modelling mod's uplink has): registers an "isru"
        // PROVIDER in Register and declares no capability of its own.
        private sealed class ProviderOnlyUplink : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "fake-isru-mod", Version = "1.0.0" };
            public void Register(IUplinkHost host) =>
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = IsruElection.CapabilityId,
                    Id = "fake-isru-mod",
                    Priority = ProviderPriority,
                    Factory = _ => new FakeBackend("fake-isru-mod"),
                });
        }

        [Fact]
        public void ProviderAbsent_StockVanillaWins()
        {
            var elected = IsruElection.Elected(ResolvedKernel(providerPresent: false));

            Assert.NotNull(elected);
            Assert.Equal("stock", elected!.ProviderId);
        }

        [Fact]
        public void ProviderPresent_ProviderWins()
        {
            var elected = IsruElection.Elected(ResolvedKernel(providerPresent: true));

            Assert.NotNull(elected);
            Assert.Equal("fake-isru-mod", elected!.ProviderId);
        }

        /// <summary>
        /// The adversarial ordering: the PROVIDER uplink is discovered BEFORE the
        /// capability-owning uplink. Single-pass registration would run the
        /// provider's Register while the "isru" capability did not yet exist, the
        /// registration would throw, the provider would be dropped, and stock would
        /// wrongly win with the mod installed.
        /// </summary>
        [Fact]
        public void ProviderDiscoveredBeforeCapability_ProviderStillWins()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");

            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(new ProviderOnlyUplink(), ContractVersion.Major, ContractVersion.Minor),
                new UplinkDiscovery.DiscoveredUplink(new CapabilityOwningUplink(), ContractVersion.Major, ContractVersion.Minor),
            });
            engine.Start();

            engine.ResolveCapabilities();

            var elected = IsruElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.Equal("fake-isru-mod", elected!.ProviderId);
        }

        /// <summary>
        /// ISRU is not SpineCritical: an unresolved/unregistered capability is a
        /// null, never a throw, so the registrar simply publishes nothing rather
        /// than taking the uplink down.
        /// </summary>
        [Fact]
        public void UnregisteredCapabilityResolvesToNullRatherThanThrowing()
        {
            var kernel = new Kernel();
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            Assert.Null(IsruElection.Elected(kernel));
        }
    }
}
